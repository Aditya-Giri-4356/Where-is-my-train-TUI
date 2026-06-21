const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const IS_MOBILE = process.env.MOBILE_MODE === '1' || 
                  process.platform === 'android' ||
                  (!require('fs').existsSync('/usr/bin/chromium') &&
                   !require('fs').existsSync('/usr/bin/google-chrome') &&
                   !require('fs').existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));

console.log(`[INIT] Mode: ${IS_MOBILE ? 'MOBILE (fetch)' : 'DESKTOP (puppeteer)'}`);

const app = express();
app.use(cors());

app.use(express.json());

const PORT = process.env.BRIDGE_PORT || 3456;

// ─── Cache System ────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[CACHE HIT] Key: ${key}`);
    return cached.data;
  }
  return null;
}

function setCached(key, data) {
  cache.set(key, {
    timestamp: Date.now(),
    data
  });
}

// ─── Rate Limiting Queue ─────────────────────────────────────────
let queue = Promise.resolve();
function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue = queue.then(async () => {
      try {
        const result = await fn();
        resolve(result);
      } catch (err) {
        reject(err);
      }
      // Wait 2 seconds between scrapes
      await new Promise(r => setTimeout(r, 2000));
    });
  });
}

// Helper to launch Puppeteer
async function executeScrape(taskFn) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    // Only block images to avoid breaking layout-dependent JS scripts
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.resourceType() === 'image') {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    return await taskFn(page);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Date helper: DD-MM-YYYY to DD-MMM-YYYY (e.g. 19-06-2026 to 19-Jun-2026)
function convertDateFormat(dateStr) {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIdx = parseInt(parts[1], 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return dateStr;
  return `${parts[0]}-${months[monthIdx]}-${parts[2]}`;
}

// ─── Health check ───────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    configured: true,
    timestamp: new Date().toISOString(),
  });
});

// ─── Search trains between stations ─────────────────────────────
// GET /api/search/:from/:to
app.get('/api/search/:from/:to', async (req, res) => {
  const { from, to } = req.params;
  const cacheKey = `search:${from}:${to}`;
  
  const cached = getCached(cacheKey);
  if (cached) {
    return res.json({ success: true, data: cached });
  }

  enqueue(() => executeScrape(async (page) => {
    console.log(`[SCRAPE] Searching trains from ${from} to ${to}...`);
    await page.goto('https://enquiry.indianrail.gov.in/mntes/', { waitUntil: 'networkidle2' });

    // Wait for default landing page element to load
    await page.waitForSelector('#trainNo', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));

    // Click "Trains B/w Stations" sidebar link in-browser
    const clicked = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const target = links.find(l => l.innerText.includes("Trains B/w Stations"));
      if (target) {
        target.click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      throw new Error("Could not find 'Trains B/w Stations' link in sidebar");
    }

    await page.waitForSelector('#jFromStationInput', { timeout: 15000 });

    // Enter From station
    await page.click('#jFromStationInput');
    await page.evaluate(() => {
      const el = document.querySelector('#jFromStationInput');
      if (el) { el.select(); }
    });
    await page.type('#jFromStationInput', from, { delay: 100 });
    await page.waitForSelector('.tt-suggestion', { timeout: 10000 });
    await page.evaluate(() => {
      const sug = document.querySelector('.tt-suggestion');
      if (sug) sug.click();
    });

    // Enter To station
    await page.click('#jToStationInput');
    await page.evaluate(() => {
      const el = document.querySelector('#jToStationInput');
      if (el) { el.select(); }
    });
    await page.type('#jToStationInput', to, { delay: 100 });
    await new Promise(r => setTimeout(r, 600));
    await page.waitForSelector('.tt-suggestion', { timeout: 10000 });
    await page.evaluate(() => {
      const sug = document.querySelector('.tt-suggestion');
      if (sug) sug.click();
    });

    // Search
    await page.evaluate(() => {
      const btn = document.querySelector('form[name="frmTBS"] input[value="Get Trains"]');
      if (btn) btn.click();
    });

    // Wait for results or empty message
    await page.waitForFunction(() => {
      return document.querySelector('.train-card') || 
             (document.body.innerText && document.body.innerText.includes("No Trains found"));
    }, { timeout: 15000 });

    // Parse results
    const trains = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.train-card'));
      return cards.map(card => {
        const nameEl = card.querySelector('b');
        const descEl = card.querySelector('.card-desc-txt');
        const timeEls = card.querySelectorAll('.card-time-txt');
        const stnEls = card.querySelectorAll('.card-stn-txt');

        const fullName = nameEl ? nameEl.innerText.trim() : '';
        const numMatch = fullName.match(/^(\d{5})/);
        const trainNo = numMatch ? numMatch[1] : '';
        const trainName = trainNo ? fullName.substring(5).trim() : fullName;

        const desc = descEl ? descEl.innerText.trim() : '';
        const [runningDays, trainType] = desc.split('|').map(s => s.trim());

        const fromTime = timeEls[0] ? timeEls[0].innerText.replace(/[\(\)]/g, '').trim() : '';
        const toTime = timeEls[1] ? timeEls[1].innerText.replace(/[\(\)]/g, '').trim() : '';

        const fromStnFull = stnEls[0] ? stnEls[0].innerText.trim() : '';
        const fromParts = fromStnFull.split('/');
        const fromStnCode = fromParts[0] ? fromParts[0].trim() : '';
        const fromStnName = fromParts[1] ? fromParts[1].trim() : fromStnFull;

        const travelTimeText = stnEls[1] ? stnEls[1].innerText.trim() : '';
        const travelTime = travelTimeText.replace(/--/g, '').replace('Hrs.', '').trim();

        const toStnFull = stnEls[2] ? stnEls[2].innerText.trim() : '';
        const toParts = toStnFull.split('/');
        const toStnCode = toParts[0] ? toParts[0].trim() : '';
        const toStnName = toParts[1] ? toParts[1].trim() : toStnFull;

        return {
          train_no: trainNo,
          train_name: trainName,
          from_stn_name: fromStnName,
          from_stn_code: fromStnCode,
          to_stn_name: toStnName,
          to_stn_code: toStnCode,
          from_time: fromTime,
          to_time: toTime,
          travel_time: travelTime,
          running_days: runningDays,
          distance: null
        };
      });
    });

    return trains;
  }))
  .then(trains => {
    setCached(cacheKey, trains);
    res.json({ success: true, data: trains });
  })
  .catch(err => {
    console.error(err);
    res.json({ success: false, error: err.message });
  });
});

// ─── Track a train (live status) — Puppeteer with session cookies ───
app.get('/api/track/:trainNo/:date?', async (req, res) => {
  const { trainNo } = req.params;
  const cacheKey = `track:${trainNo}`;

  const cached = getCached(cacheKey);
  if (cached) return res.json({ success: true, data: cached });

  if (IS_MOBILE) {
    // ── Mobile path: raw HTTP fetch + cheerio parse ──────────────
    try {
      const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
      const cheerio = require('cheerio');

      // Step 1: Get session cookies from NTES homepage
      const homeRes = await fetch('https://enquiry.indianrail.gov.in/mntes/', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36' }
      });
      const cookies = homeRes.headers.get('set-cookie') || '';

      // Step 2: Fetch train status directly
      const trackRes = await fetch(
        `https://enquiry.indianrail.gov.in/mntes/q?opt=TrainSearch&subOpt=liveRun&trainNo=${trainNo}&startDay=1`,
        {
          headers: {
            'Cookie': cookies,
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': 'https://enquiry.indianrail.gov.in/mntes/',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
          }
        }
      );
      const html = await trackRes.text();

      // Step 3: Parse with cheerio
      const $ = cheerio.load(html);
      const stations = [];
      let currentStation = null;

      $('table.w3-table-all tbody tr').slice(1).each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length < 3) return;

        const stationCell = $(cells[2]);
        const stationHtml = stationCell.html() || '';
        const stationText = stationCell.text().trim();

        const dashIdx = stationText.indexOf(' - ');
        const stationName = dashIdx > -1 ? stationText.slice(0, dashIdx).trim() : stationText.split('\n')[0].trim();
        const afterDash = dashIdx > -1 ? stationText.slice(dashIdx + 3) : '';
        const codeMatch = afterDash.match(/^([A-Z]{2,5})/);
        const stationCode = codeMatch ? codeMatch[1] : '';
        const isStopping = !stationHtml.includes('Non-Stopping');

        const getTimeParts = (cell) => {
          const raw = $(cell).html()?.replace(/<br\s*\/?>/gi, '\n') || '';
          return cheerio.load(raw).text().split('\n').map(s => s.trim()).filter(Boolean);
        };

        const schedParts = getTimeParts(cells[3]);
        const actualParts = getTimeParts(cells[4]);

        const svgStyle = $(cells[1]).find('svg').attr('style') || '';
        let status = 'upcoming';
        if (svgStyle.includes('orange')) status = 'passed';
        if (svgStyle.includes('green'))  status = 'current';
        if (status === 'current') currentStation = `At ${stationName} (${stationCode})`;

        if (!stationName || stationName === 'SRC' || stationName === 'DST') return;

        stations.push({
          station_name: stationName,
          station_code: stationCode,
          scheduled_arrival: schedParts[0] || '--',
          scheduled_departure: schedParts[1] || '--',
          actual_arrival: actualParts[0] || '--',
          actual_departure: actualParts[1] || '--',
          delay_minutes: null,
          is_stopping: isStopping,
          status
        });
      });

      if (!currentStation) {
        const lastPassed = [...stations].reverse().find(s => s.status === 'passed');
        if (lastPassed) currentStation = `After ${lastPassed.station_name} (${lastPassed.station_code})`;
      }

      const data = { train_name: `Train ${trainNo}`, current_station: currentStation, current_delay: null, stations };
      if (stations.length > 0) setCached(cacheKey, data);
      return res.json({ success: true, data });

    } catch (err) {
      console.error('[MOBILE TRACK ERROR]', err.message);
      return res.json({ success: false, error: err.message, data: { train_name: `Train ${trainNo}`, current_station: null, current_delay: null, stations: [] } });
    }

  } else {
    // ── Desktop path: existing Puppeteer scraper ─────────────────
    const SCRAPE_TIMEOUT = 25000; // 25 seconds max

    Promise.race([
      enqueue(() => executeScrape(async (page) => {
        console.log(`[TRACK] Fetching live status for ${trainNo}...`);

        // Step 1: Land on NTES to get session cookies
        await page.goto('https://enquiry.indianrail.gov.in/mntes/', {
          waitUntil: 'networkidle2',
          timeout: 20000
        });

        // Step 1b: Dismiss the "X" overlay modal that NTES shows on first load
        try {
          await page.waitForSelector('button', { timeout: 5000 });
          const dismissed = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const closeBtn = buttons.find(b => b.innerText.trim() === 'X' || b.innerText.includes('X'));
            if (closeBtn) { closeBtn.click(); return true; }
            return false;
          });
          if (dismissed) {
            console.log('[TRACK] Dismissed NTES overlay');
            await new Promise(r => setTimeout(r, 800));
          }
        } catch (_) {
          console.log('[TRACK] No overlay found, continuing');
        }

        // Step 1c: Click "Spot Your Train" link to pre-navigate to the right section
        await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a'));
          const spot = links.find(l => l.innerText.includes('Spot Your Train'));
          if (spot) spot.click();
        });
        await new Promise(r => setTimeout(r, 1000));

        // Step 1d: Type into #trainNo
        try {
          await page.waitForSelector('#trainNo', { timeout: 5000 });
          await page.type('#trainNo', trainNo, { delay: 100 });
          await new Promise(r => setTimeout(r, 500));
          // Press Enter to submit the autocomplete/form
          await page.keyboard.press('Enter');
        } catch (e) {
          console.log('[TRACK] Failed to type into #trainNo:', e.message);
        }

        // Step 6: Check if table already loaded (NTES auto-loads after autocomplete)
        await new Promise(r => setTimeout(r, 3000));
        const tableAlreadyLoaded = await page.evaluate(() =>
          !!document.querySelector('table.w3-table-all')
        );
        console.log(`[TRACK] Table auto-loaded: ${tableAlreadyLoaded}`);

        if (!tableAlreadyLoaded) {
          // Only try date selection + submit if table didn't auto-load
          await page.evaluate(() => {
            const select = document.querySelector('select[name="jDate"], select#jDate');
            if (select && select.options.length > 0) {
              select.selectedIndex = 0;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            // Click date links if present
            const dateLinks = document.querySelectorAll('a[onclick*="date"], a[onclick*="Date"]');
            if (dateLinks.length > 0) dateLinks[0].click();
          });
          await new Promise(r => setTimeout(r, 1000));

          // Try clicking any submit-like button
          await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
              .find(el => {
                const t = (el.innerText || el.value || '').toLowerCase();
                return t.includes('get') || t.includes('status') || t.includes('search');
              });
            if (btn) btn.click();
          });
          await new Promise(r => setTimeout(r, 4000));
        }

        // Step 7: Wait for table — no fallback Enter (it clears the page)
        const finalTableExists = await page.evaluate(() =>
          !!document.querySelector('table.w3-table-all, div.stopRow')
        );
        if (!finalTableExists) {
          console.log('[TRACK] Table still not found — train may not be running today');
        }

        // Step 2: Fire XHR manually from within the page context to carry session cookies
        const capturedData = await page.evaluate(async (tn) => {
          try {
            const fetchRes = await fetch(`https://enquiry.indianrail.gov.in/mntes/q?opt=TrainSearch&subOpt=liveRun&trainNo=${tn}&startDay=1`, {
              headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://enquiry.indianrail.gov.in/mntes/'
              },
              credentials: 'include'
            });
            const text = await fetchRes.text();
            if (text.startsWith('{') || text.startsWith('[')) {
              return JSON.parse(text);
            }
            return null;
          } catch (e) {
            return null;
          }
        }, trainNo);

        // Step 3: If XHR was captured, use it; otherwise scrape the DOM
        if (capturedData) return capturedData;

        // Step 10: DOM fallback — precise parser for w3-table-all structure
        console.log('[TRACK] XHR not JSON, falling back to DOM scrape');
        const domData = await page.evaluate((tn) => {

          // ── Train name & current position header ──────────────────────
          let trainName = `Train ${tn}`;
          let currentStation = null;
          let currentDelay = null;

          // NTES renders "16848 SCT-MV EXP" in a heading above the table
          const allText = document.body.innerText;
          const nameMatch = allText.match(new RegExp(tn + '\\s+([A-Z0-9 \\-\\.]+)'));
          if (nameMatch) trainName = (tn + ' ' + nameMatch[1]).trim().slice(0, 50);

          // "Current Position" appears in the body text near the station name
          const currentMatch = allText.match(/Current Position[:\s]+([A-Z\s]+(?:JN|JUNCTION|ROAD|HALT)?)/i);
          if (currentMatch) currentStation = currentMatch[1].trim();

          const delayMatch = allText.match(/(\d+)\s*min(?:utes?)?\s*(?:late|delay)/i);
          if (delayMatch) currentDelay = delayMatch[1] + ' min late';

          // ── Station rows from w3-table-all or div.stopRow ────────────────
          const table = document.querySelector('table.w3-table-all');
          const divRows = Array.from(document.querySelectorAll('div.stopRow'));
          
          if (!table && divRows.length === 0) {
            return { train_name: trainName, current_station: currentStation, current_delay: currentDelay, stations: [], debugText: allText.slice(0, 400) };
          }

          let stations = [];

          if (table) {
            const rows = Array.from(table.querySelectorAll('tbody tr')).slice(1); // skip header
            stations = rows.map(row => {
              const cells = row.querySelectorAll('td');
              // Skip header-like rows (SRC/DST markers, "Yet to start" rows)
              if (cells.length < 3) return null;
              const rowText = (cells[2]?.innerText || '').trim();
              if (rowText === '' || rowText === 'SRC' || rowText === 'DST') return null;

              // td[2]: "STATION NAME - CODE<br><b>Non-Stopping</b>" or "Stoppage"
              const stationCell = cells[2];
              const stationRaw = stationCell.innerHTML || '';
              const stationText = stationCell.innerText || '';

              // Extract code using raw HTML to avoid innerText merging the code with "Non-Stopping" or "Stoppage"
              const dashIdxHTML = stationRaw.indexOf(' - ');
              let stationName = stationText.includes(' - ') ? stationText.slice(0, stationText.indexOf(' - ')).trim() : stationText.split('\n')[0].trim();
              let stationCode = '';
              if (dashIdxHTML > -1) {
                const rightHtml = stationRaw.slice(dashIdxHTML + 3);
                const rawCode = rightHtml.split(/<br/i)[0].replace(/<[^>]*>?/gm, '').trim();
                const codeMatch = rawCode.match(/^([A-Z0-9]{2,5})/);
                stationCode = codeMatch ? codeMatch[1] : rawCode;
              }
              const isStopping = !stationRaw.includes('Non-Stopping');

              // td[3]: Sch Arr / Sch Dep separated by <br>
              const getTimeParts = (cell) => {
                // Replace <br> tags with a newline BEFORE reading text, so times don't merge
                const raw = (cell.innerHTML || '').replace(/<br\s*\/?>/gi, '\n');
                const tmp = document.createElement('div');
                tmp.innerHTML = raw;
                return (tmp.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
              };
              const schedParts = getTimeParts(cells[3]);
              const schArr = schedParts[0] || '--';
              const schDep = schedParts[1] || '--';

              // td[4]: Actual Arr / Actual Dep
              const actualParts = getTimeParts(cells[4]);
              const actArr = actualParts[0] || '--';
              const actDep = actualParts[1] || '--';

              // SVG circle color: orange = passed, green = current, gray = upcoming
              const svg = cells[1] ? cells[1].querySelector('svg') : null;
              const svgStyle = svg ? (svg.getAttribute('style') || '') : '';
              let status = 'upcoming';
              if (svgStyle.includes('orange')) status = 'passed';
              if (svgStyle.includes('green'))  status = 'current';

              // Compute delay: if actual arr exists and differs from scheduled
              let delayMins = null;
              if (actArr !== '--' && schArr !== '--') {
                const parseTime = t => {
                  const m = t.match(/(\d+):(\d+)/);
                  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
                };
                const schM = parseTime(schArr);
                const actM = parseTime(actArr);
                if (schM !== null && actM !== null) {
                  let diff = actM - schM;
                  if (diff < -720) diff += 1440; // midnight crossover
                  delayMins = diff;
                }
              }

              return {
                station_name: stationName,
                station_code: stationCode,
                scheduled_arrival: schArr,
                scheduled_departure: schDep,
                actual_arrival: actArr,
                actual_departure: actDep,
                delay_minutes: delayMins,
                is_stopping: isStopping,
                status, // 'passed' | 'current' | 'upcoming'
              };
            }).filter(r => r && r.station_name.length > 1);
          } else if (divRows.length > 0) {
            stations = divRows.map(row => {
              const stationElem = row.querySelector('div[style*="float:left;flex:1;"] b');
              let stationName = stationElem ? stationElem.innerText.trim() : '';
              if (!stationName) return null;
              
              const codeElem = row.querySelector('div[style*="float:left;padding: 0px;"] b');
              let stationCode = '';
              if (codeElem) {
                 stationCode = codeElem.innerText.split(' ')[0].trim();
              }

              const arrDiv = row.querySelector('div[style*="width:100px"][style*="float:left"]');
              const depDiv = row.querySelector('div[style*="width:100px"][style*="float:right"]');
              
              const arrParts = arrDiv ? Array.from(arrDiv.querySelectorAll('span')).map(s => s.innerText.trim()).filter(Boolean) : [];
              const depParts = depDiv ? Array.from(depDiv.querySelectorAll('span')).map(s => s.innerText.trim()).filter(Boolean) : [];

              const schArr = (arrParts[0] && arrParts[0] !== 'SRC' && arrParts[0] !== 'DST') ? arrParts[0] : '--';
              let actArr = '--';
              if (arrParts[1] && arrParts[1] !== 'SRC' && arrParts[1] !== 'DST') {
                actArr = arrParts[1].split('\n')[0].replace('*', '').trim();
              }

              const schDep = (depParts[0] && depParts[0] !== 'SRC' && depParts[0] !== 'DST') ? depParts[0] : '--';
              let actDep = '--';
              if (depParts[1] && depParts[1] !== 'SRC' && depParts[1] !== 'DST') {
                actDep = depParts[1].split('\n')[0].replace('*', '').trim();
              }

              let status = 'upcoming';
              const imgHtml = row.innerHTML.toLowerCase();
              if (imgHtml.includes('track_red') || imgHtml.includes('track_orange')) status = 'passed';
              else if (imgHtml.includes('track_green') || imgHtml.includes('blink')) status = 'current';
              else if (actDep !== '--' && schDep !== '--') status = 'passed';
              else if (actArr !== '--' && schArr !== '--') status = 'passed'; // fallback if no images match

              let delayMins = null;
              if (actArr !== '--' && schArr !== '--') {
                const parseTime = t => {
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

              return {
                station_name: stationName,
                station_code: stationCode,
                scheduled_arrival: schArr,
                scheduled_departure: schDep,
                actual_arrival: actArr,
                actual_departure: actDep,
                delay_minutes: delayMins,
                is_stopping: true,
                status
              };
            }).filter(r => r && r.station_name.length > 1);
          }

          // Pick current station from first 'current' status row, or last 'passed' row
          if (!currentStation) {
            const cur = stations.find(s => s.status === 'current');
            const lastPassed = [...stations].reverse().find(s => s.status === 'passed');
            if (cur) currentStation = `${cur.station_name} (${cur.station_code})`;
            else if (lastPassed) currentStation = `After ${lastPassed.station_name} (${lastPassed.station_code})`;
          }

          return { train_name: trainName, current_station: currentStation, current_delay: currentDelay, stations };
        }, trainNo);

        return domData;
      })),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Scrape timeout after 25s')), SCRAPE_TIMEOUT)
      )
    ])
    .then(data => {
      setCached(cacheKey, data);
      res.json({ success: true, data });
    })
    .catch(err => {
      console.error(`[TRACK ERROR] ${trainNo}:`, err.message);
      res.json({
        success: false,
        error: 'Live tracking unavailable',
        data: {
          train_name: `Train ${trainNo}`,
          current_station: null,
          stations: [],
          note: 'NTES is unreachable or train is not running today'
        }
      });
    });
  }
});

// ─── Train information + route ──────────────────────────────────
// GET /api/train/:trainNo
app.get('/api/train/:trainNo', async (req, res) => {
  const { trainNo } = req.params;
  const cacheKey = `schedule:${trainNo}`;

  const cached = getCached(cacheKey);
  if (cached) {
    return res.json({ success: true, data: cached });
  }

  enqueue(() => executeScrape(async (page) => {
    console.log(`[SCRAPE] Fetching schedule/route for train ${trainNo}...`);
    await page.goto('https://enquiry.indianrail.gov.in/mntes/', { waitUntil: 'networkidle2' });

    await page.waitForSelector('#trainNo', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));

    // Click "Train Schedule" link in-browser
    const clicked = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const target = links.find(l => l.innerText.includes("Train Schedule"));
      if (target) {
        target.click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      throw new Error("Could not find 'Train Schedule' link in sidebar");
    }

    await page.waitForSelector('#trainNo', { timeout: 15000 });
    await page.click('#trainNo');
    await page.evaluate(() => {
      const el = document.querySelector('#trainNo');
      if (el) { el.select(); }
    });
    await page.type('#trainNo', trainNo, { delay: 100 });
    try {
      await page.waitForSelector('.tt-suggestion', { timeout: 4000 });
      await page.evaluate(() => {
        const sug = document.querySelector('.tt-suggestion');
        if (sug) sug.click();
      });
    } catch (e) {
      console.log(`[SCRAPE] .tt-suggestion timeout for ${trainNo}, pressing Enter fallback.`);
      await page.keyboard.press('Enter');
    }

    // Wait for table-row
    await page.waitForSelector('.table-row', { timeout: 15000 });

    const trainHeader = await page.evaluate(() => {
      const el = document.querySelector('.row');
      return el ? el.innerText.trim() : '';
    });

    const route = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.table-row'));
      return rows.map(row => {
        const text = (row.innerText || row.textContent || '').trim().replace(/\s+/g, ' ');
        const tokens = text.split(/\s+/);
        if (tokens.length < 7) return null;

        const day = tokens[tokens.length - 1];
        const distance = tokens[tokens.length - 2];
        const halt = tokens[tokens.length - 3];
        const departure = tokens[tokens.length - 4];
        const arrival = tokens[tokens.length - 5];
        const stnCodeRaw = tokens[tokens.length - 6];
        const stnCode = stnCodeRaw ? stnCodeRaw.replace(/[\(\)]/g, '') : '';
        const stnName = tokens.slice(1, tokens.length - 6).join(' ');

        return {
          stnCode,
          stnName,
          arrival: arrival === 'SRC' ? null : arrival,
          departure: departure === 'DST' ? null : departure,
          halt: halt === '--' ? null : halt,
          distance,
          day
        };
      }).filter(Boolean);
    });

    if (route.length === 0) {
      throw new Error(`Failed to parse schedule route for train ${trainNo}`);
    }

    const firstStn = route[0];
    const lastStn = route[route.length - 1];

    const trainName = trainHeader.includes(trainNo) 
      ? trainHeader.substring(trainNo.length).trim() 
      : trainHeader;

    const train_info = {
      train_no: trainNo,
      train_name: trainName,
      from_stn_name: firstStn.stnName,
      from_stn_code: firstStn.stnCode,
      to_stn_name: lastStn.stnName,
      to_stn_code: lastStn.stnCode,
      from_time: firstStn.departure,
      to_time: lastStn.arrival,
      travel_time: null,
      running_days: null,
      type: null
    };

    return {
      train_info,
      route
    };
  }))
  .then(data => {
    setCached(cacheKey, data);
    res.json({ success: true, data });
  })
  .catch(err => {
    console.error(`[TRAIN INFO ERROR] ${trainNo}:`, err.message);
    res.json({
      success: true,
      data: {
        train_info: {
          train_no: trainNo,
          train_name: "Unknown Train",
          from_stn_name: "N/A",
          from_stn_code: "N/A",
          to_stn_name: "N/A",
          to_stn_code: "N/A",
          from_time: "--",
          to_time: "--",
          travel_time: "--",
          running_days: "-------",
          type: "EXP"
        },
        route: []
      }
    });
  });
});

// ─── Start server ───────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚂 Scraping Bridge running on http://127.0.0.1:${PORT}`);
});
