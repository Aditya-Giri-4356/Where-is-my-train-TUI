#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────
// server.mobile.js — Zero-dependency bridge for iSH & Termux
// Uses ONLY Node.js built-in modules (http, https, url).
// No express, cors, cheerio, puppeteer, or npm install required.
// ─────────────────────────────────────────────────────────────────

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = process.env.BRIDGE_PORT || 3456;

// ─── Simple Cache ───────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) {
    console.log(`[CACHE HIT] ${key}`);
    return entry.data;
  }
  return null;
}

function setCached(key, data) {
  cache.set(key, { ts: Date.now(), data });
}

// ─── HTTPS fetch helper (Node built-in) ────────────────────────
function fetchHttps(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const reqOpts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko)',
        ...(opts.headers || {}),
      },
    };

    const req = https.request(reqOpts, (res) => {
      const chunks = [];
      const cookies = res.headers['set-cookie'] || [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
          cookies: cookies.map(c => c.split(';')[0]).join('; '),
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

// ─── Simple HTML text extractor (replaces cheerio) ─────────────
function stripTags(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function extractBetween(html, startTag, endTag) {
  const parts = [];
  let idx = 0;
  while (true) {
    const s = html.indexOf(startTag, idx);
    if (s === -1) break;
    const e = html.indexOf(endTag, s + startTag.length);
    if (e === -1) break;
    parts.push(html.substring(s + startTag.length, e));
    idx = e + endTag.length;
  }
  return parts;
}

// ─── Minimal JSON response helper ──────────────────────────────
function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

// ─── Route: /api/health ─────────────────────────────────────────
function handleHealth(req, res) {
  sendJson(res, 200, { success: true, configured: true, timestamp: new Date().toISOString() });
}

// ─── Route: /api/track/:trainNo ─────────────────────────────────
async function handleTrack(req, res, trainNo) {
  const cacheKey = `track:${trainNo}`;
  const cached = getCached(cacheKey);
  if (cached) return sendJson(res, 200, { success: true, data: cached });

  try {
    // Step 1: Hit NTES homepage to get session cookies
    console.log(`[TRACK] Fetching live status for ${trainNo}...`);
    const homeRes = await fetchHttps('https://enquiry.indianrail.gov.in/mntes/');
    const sessionCookies = homeRes.cookies;

    // Step 2: Hit the NTES XHR endpoint directly with the session cookies
    const trackRes = await fetchHttps(
      `https://enquiry.indianrail.gov.in/mntes/q?opt=TrainSearch&subOpt=liveRun&trainNo=${trainNo}&startDay=1`,
      {
        headers: {
          'Cookie': sessionCookies,
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://enquiry.indianrail.gov.in/mntes/',
        },
      }
    );

    const html = trackRes.body;

    // Step 3: Try JSON parse first (NTES sometimes returns pure JSON)
    try {
      const jsonData = JSON.parse(html);
      setCached(cacheKey, jsonData);
      return sendJson(res, 200, { success: true, data: jsonData });
    } catch (_) {
      // Not JSON — parse as HTML
    }

    // Step 4: Parse the HTML table using regex/string ops
    const stations = [];
    let currentStation = null;
    let currentDelay = null;
    let trainName = `Train ${trainNo}`;

    // Try to extract train name
    const nameMatch = html.match(new RegExp(trainNo + '\\s+([A-Z0-9 \\-\\.]+)'));
    if (nameMatch) trainName = (trainNo + ' ' + nameMatch[1]).trim().slice(0, 50);

    // Try to extract current position
    const posMatch = html.match(/Current Position[\s:]+([A-Z\s]+(?:JN|JUNCTION)?)/i);
    if (posMatch) currentStation = posMatch[1].trim();

    const delayMatch = html.match(/(\d+)\s*min(?:utes?)?\s*(?:late|delay)/i);
    if (delayMatch) currentDelay = delayMatch[1] + ' min late';

    // Extract table rows from w3-table-all
    const tableMatch = html.match(/<table[^>]*class="[^"]*w3-table-all[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
    if (tableMatch) {
      const tableHtml = tableMatch[1];
      const rows = extractBetween(tableHtml, '<tr', '</tr>');

      for (let i = 1; i < rows.length; i++) { // skip header
        const cells = extractBetween(rows[i], '<td', '</td>');
        if (cells.length < 5) continue;

        const stationHtml = cells[2] || '';
        const stationText = stripTags(stationHtml);

        // Parse station name and code
        const dashIdx = stationText.indexOf(' - ');
        let stnName = dashIdx > -1 ? stationText.slice(0, dashIdx).trim() : stationText.split(/\s{2,}/)[0].trim();
        let stnCode = '';
        if (dashIdx > -1) {
          const afterDash = stationText.slice(dashIdx + 3).trim();
          const cm = afterDash.match(/^([A-Z0-9]{2,5})/);
          stnCode = cm ? cm[1] : '';
        }
        const isStopping = !stationHtml.includes('Non-Stopping');

        if (!stnName || stnName === 'SRC' || stnName === 'DST' || stnName.length < 2) continue;

        // Extract times from cell HTML (separated by <br>)
        const parseTimes = (cellHtml) => {
          const cleaned = (cellHtml || '').replace(/<br\s*\/?>/gi, '|');
          const text = stripTags(cleaned);
          return text.split('|').map(s => s.trim()).filter(Boolean);
        };

        const schedParts = parseTimes(cells[3]);
        const actualParts = parseTimes(cells[4]);

        // Status from SVG color
        const svgHtml = cells[1] || '';
        let status = 'upcoming';
        if (svgHtml.includes('orange')) status = 'passed';
        if (svgHtml.includes('green')) status = 'current';

        // Delay calculation
        let delayMins = null;
        const schArr = schedParts[0] || '--';
        const actArr = actualParts[0] || '--';
        if (actArr !== '--' && schArr !== '--') {
          const parseTime = (t) => {
            const m = t.match(/(\d+):(\d+)/);
            return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
          };
          const schM = parseTime(schArr);
          const actM = parseTime(actArr);
          if (schM !== null && actM !== null) {
            let diff = actM - schM;
            if (diff < -720) diff += 1440;
            delayMins = diff;
          }
        }

        stations.push({
          station_name: stnName,
          station_code: stnCode,
          scheduled_arrival: schArr,
          scheduled_departure: schedParts[1] || '--',
          actual_arrival: actArr,
          actual_departure: actualParts[1] || '--',
          delay_minutes: delayMins,
          is_stopping: isStopping,
          status,
        });
      }
    }

    // Also try div.stopRow layout
    if (stations.length === 0) {
      const divRows = extractBetween(html, '<div class="stopRow', '</div><!-- end stopRow');
      // Simpler fallback — just look for patterns
      const rowRegex = /<div[^>]*class="stopRow[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="stopRow|$)/gi;
      let rowMatch;
      while ((rowMatch = rowRegex.exec(html)) !== null) {
        const rowHtml = rowMatch[1];
        const boldTexts = extractBetween(rowHtml, '<b>', '</b>');
        if (boldTexts.length < 1) continue;

        const stnName = stripTags(boldTexts[0]);
        const stnCode = boldTexts.length > 1 ? stripTags(boldTexts[1]).split(/\s/)[0] : '';
        if (!stnName || stnName.length < 2) continue;

        let status = 'upcoming';
        const rl = rowHtml.toLowerCase();
        if (rl.includes('track_red') || rl.includes('track_orange')) status = 'passed';
        else if (rl.includes('track_green') || rl.includes('blink')) status = 'current';

        stations.push({
          station_name: stnName,
          station_code: stnCode,
          scheduled_arrival: '--',
          scheduled_departure: '--',
          actual_arrival: '--',
          actual_departure: '--',
          delay_minutes: null,
          is_stopping: true,
          status,
        });
      }
    }

    // Determine current station
    if (!currentStation) {
      const cur = stations.find(s => s.status === 'current');
      const lastPassed = [...stations].reverse().find(s => s.status === 'passed');
      if (cur) currentStation = `${cur.station_name} (${cur.station_code})`;
      else if (lastPassed) currentStation = `After ${lastPassed.station_name} (${lastPassed.station_code})`;
    }

    const data = { train_name: trainName, current_station: currentStation, current_delay: currentDelay, stations };
    if (stations.length > 0) setCached(cacheKey, data);
    sendJson(res, 200, { success: true, data });

  } catch (err) {
    console.error(`[TRACK ERROR] ${trainNo}:`, err.message);
    sendJson(res, 200, {
      success: false,
      error: 'Live tracking unavailable',
      data: {
        train_name: `Train ${trainNo}`,
        current_station: null,
        current_delay: null,
        stations: [],
        note: 'NTES is unreachable or train is not running today',
      },
    });
  }
}

// ─── Route: /api/train/:trainNo (schedule/route) ────────────────
async function handleTrainInfo(req, res, trainNo) {
  const cacheKey = `schedule:${trainNo}`;
  const cached = getCached(cacheKey);
  if (cached) return sendJson(res, 200, { success: true, data: cached });

  // On mobile, we can't scrape NTES Train Schedule (needs Puppeteer).
  // Return a placeholder so the TUI doesn't crash.
  sendJson(res, 200, {
    success: true,
    data: {
      train_info: {
        train_no: trainNo,
        train_name: 'Unknown Train',
        from_stn_name: 'N/A',
        from_stn_code: 'N/A',
        to_stn_name: 'N/A',
        to_stn_code: 'N/A',
        from_time: '--',
        to_time: '--',
        travel_time: '--',
        running_days: '-------',
        type: 'EXP',
      },
      route: [],
    },
  });
}

// ─── Route: /api/stations/search/:query ─────────────────────────
async function handleStationSearch(req, res, query) {
  const cacheKey = `stn:${query.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return sendJson(res, 200, { success: true, data: cached });

  try {
    // Use NTES autocomplete XHR
    const homeRes = await fetchHttps('https://enquiry.indianrail.gov.in/mntes/');
    const cookies = homeRes.cookies;

    const searchRes = await fetchHttps(
      `https://enquiry.indianrail.gov.in/mntes/q?opt=StnAutoComplete&subOpt=fuz&q=${encodeURIComponent(query)}`,
      {
        headers: {
          'Cookie': cookies,
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://enquiry.indianrail.gov.in/mntes/',
        },
      }
    );

    // NTES returns lines like "NDLS - NEW DELHI" or JSON array
    const body = searchRes.body.trim();
    let stations = [];

    try {
      // Try JSON first
      const json = JSON.parse(body);
      if (Array.isArray(json)) {
        stations = json.map(item => {
          if (typeof item === 'string') {
            const m = item.match(/^([A-Z0-9]+)\s*-\s*(.+)/);
            return m ? { code: m[1].trim(), name: m[2].trim() } : { code: item, name: item };
          }
          return { code: item.code || item.stnCode || '', name: item.name || item.stnName || '' };
        });
      }
    } catch (_) {
      // Plain text — one station per line
      stations = body.split('\n').filter(Boolean).map(line => {
        const m = line.match(/^([A-Z0-9]+)\s*-\s*(.+)/);
        return m ? { code: m[1].trim(), name: m[2].trim() } : { code: line.trim(), name: line.trim() };
      });
    }

    if (stations.length > 0) setCached(cacheKey, stations);
    sendJson(res, 200, { success: true, data: stations });
  } catch (err) {
    console.error(`[STN SEARCH ERROR] ${query}:`, err.message);
    // Fallback: return popular stations matching query
    const fallback = POPULAR_STATIONS.filter(s =>
      s.code.toLowerCase().includes(query.toLowerCase()) ||
      s.name.toLowerCase().includes(query.toLowerCase())
    );
    sendJson(res, 200, { success: true, data: fallback });
  }
}

// ─── Route: /api/search/:from/:to (trains between stations) ────
async function handleSearch(req, res, from, to) {
  const cacheKey = `search:${from}:${to}`;
  const cached = getCached(cacheKey);
  if (cached) return sendJson(res, 200, { success: true, data: cached });

  try {
    // Use NTES "Trains Between Stations" XHR
    const homeRes = await fetchHttps('https://enquiry.indianrail.gov.in/mntes/');
    const cookies = homeRes.cookies;

    const searchRes = await fetchHttps(
      `https://enquiry.indianrail.gov.in/mntes/q?opt=TbsLive&subOpt=fbs&stnFrom=${encodeURIComponent(from)}&stnTo=${encodeURIComponent(to)}`,
      {
        headers: {
          'Cookie': cookies,
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://enquiry.indianrail.gov.in/mntes/',
        },
      }
    );

    const html = searchRes.body;
    let trains = [];

    // Try JSON parse first
    try {
      const json = JSON.parse(html);
      if (Array.isArray(json)) {
        trains = json.map(t => ({
          train_no: t.trainNo || t.train_no || t.number || '',
          train_name: t.trainName || t.train_name || t.name || '',
          from_time: t.depTime || t.from_time || '--',
          to_time: t.arrTime || t.to_time || '--',
          travel_time: t.travelTime || t.duration || '--',
          running_days: t.runDays || t.running_days || '--',
        }));
      }
    } catch (_) {
      // Parse HTML table
      const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
      if (tableMatch) {
        const rows = extractBetween(tableMatch[1], '<tr', '</tr>');
        for (let i = 1; i < rows.length; i++) {
          const cells = extractBetween(rows[i], '<td', '</td>');
          if (cells.length < 4) continue;
          const trainText = stripTags(cells[0] || '');
          const noMatch = trainText.match(/(\d{5})/);
          if (!noMatch) continue;
          trains.push({
            train_no: noMatch[1],
            train_name: trainText.replace(noMatch[1], '').trim().replace(/^[-\s]+/, ''),
            from_time: stripTags(cells[1] || '') || '--',
            to_time: stripTags(cells[2] || '') || '--',
            travel_time: stripTags(cells[3] || '') || '--',
            running_days: stripTags(cells[4] || '') || '--',
          });
        }
      }
    }

    if (trains.length > 0) setCached(cacheKey, trains);
    sendJson(res, 200, { success: true, data: trains });
  } catch (err) {
    console.error(`[SEARCH ERROR] ${from}->${to}:`, err.message);
    sendJson(res, 200, { success: true, data: [] });
  }
}

// ─── Popular stations fallback ──────────────────────────────────
const POPULAR_STATIONS = [
  { code: 'NDLS', name: 'NEW DELHI' },
  { code: 'MAS', name: 'MGR CHENNAI CTL' },
  { code: 'CSTM', name: 'CSMT MUMBAI' },
  { code: 'HWH', name: 'HOWRAH JN' },
  { code: 'SBC', name: 'KSR BENGALURU' },
  { code: 'SC', name: 'SECUNDERABAD JN' },
  { code: 'LKO', name: 'LUCKNOW NR' },
  { code: 'JP', name: 'JAIPUR' },
  { code: 'ADI', name: 'AHMEDABAD JN' },
  { code: 'PNBE', name: 'PATNA JN' },
  { code: 'BPL', name: 'BHOPAL JN' },
  { code: 'TPJ', name: 'TIRUCHIRAPPALLI JN' },
  { code: 'TJ', name: 'THANJAVUR JN' },
  { code: 'CNB', name: 'KANPUR CENTRAL' },
  { code: 'AGC', name: 'AGRA CANTT' },
  { code: 'BBS', name: 'BHUBANESWAR' },
  { code: 'GHY', name: 'GUWAHATI' },
  { code: 'CDG', name: 'CHANDIGARH' },
  { code: 'PUNE', name: 'PUNE JN' },
  { code: 'NGP', name: 'NAGPUR' },
];

// ─── HTTP Router ────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  try {
    // /api/health
    if (path === '/api/health') {
      return handleHealth(req, res);
    }

    // /api/stations/search/:query
    const stnMatch = path.match(/^\/api\/stations\/search\/(.+)$/);
    if (stnMatch) {
      return await handleStationSearch(req, res, decodeURIComponent(stnMatch[1]));
    }

    // /api/stations/popular
    if (path === '/api/stations/popular') {
      return sendJson(res, 200, { success: true, data: POPULAR_STATIONS });
    }

    // /api/track/:trainNo or /api/track/:trainNo/:date
    const trackMatch = path.match(/^\/api\/track\/(\d{4,6})(?:\/.*)?$/);
    if (trackMatch) {
      return await handleTrack(req, res, trackMatch[1]);
    }

    // /api/train/:trainNo
    const trainMatch = path.match(/^\/api\/train\/(\d{4,6})$/);
    if (trainMatch) {
      return await handleTrainInfo(req, res, trainMatch[1]);
    }

    // /api/search/:from/:to
    const searchMatch = path.match(/^\/api\/search\/([^/]+)\/([^/]+)$/);
    if (searchMatch) {
      return await handleSearch(req, res, decodeURIComponent(searchMatch[1]), decodeURIComponent(searchMatch[2]));
    }

    // 404
    sendJson(res, 404, { success: false, error: 'Not found' });
  } catch (err) {
    console.error('[SERVER ERROR]', err.message);
    sendJson(res, 500, { success: false, error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🚂 Mobile Bridge running on http://127.0.0.1:${PORT} (zero dependencies)`);
});
