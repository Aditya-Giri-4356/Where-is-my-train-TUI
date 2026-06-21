const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

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

// ─── Track a train (live status) ────────────────────────────────
const RAIL_API = 'https://indianrailapi.com/api/v2';

app.get('/api/track/:trainNo/:date?', async (req, res) => {
  try {
    const fetch = (await import('node-fetch')).default || require('node-fetch');
    const r = await fetch(
      `${RAIL_API}/livetrainstatus/apikey/irctc_0f2c8577ff37e464bed3408790ba7cac0fe16e353cfc4e34/trainnumber/${req.params.trainNo}/`
    );
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error(`[TRACK ERROR] ${req.params.trainNo}:`, err.message);
    res.json({ success: false, error: err.message });
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
