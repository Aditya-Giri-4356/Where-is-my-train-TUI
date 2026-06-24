#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────
// mobile-tui.js — Zero-dependency terminal UI for iSH & Termux
// Uses ONLY Node.js built-in modules. No npm install required.
// Talks to server.mobile.js on localhost:3456 for all data.
// ─────────────────────────────────────────────────────────────────

const http = require('http');
const readline = require('readline');

const BRIDGE = 'http://127.0.0.1:3456';

// ─── ANSI Escape Helpers ────────────────────────────────────────
const ESC = '\x1b[';
const ansi = {
  clear: () => process.stdout.write(`${ESC}2J${ESC}H`),
  moveTo: (r, c) => process.stdout.write(`${ESC}${r};${c}H`),
  hideCursor: () => process.stdout.write(`${ESC}?25l`),
  showCursor: () => process.stdout.write(`${ESC}?25h`),
  bold: (s) => `${ESC}1m${s}${ESC}0m`,
  dim: (s) => `${ESC}2m${s}${ESC}0m`,
  italic: (s) => `${ESC}3m${s}${ESC}0m`,
  underline: (s) => `${ESC}4m${s}${ESC}0m`,
  // Colors
  red: (s) => `${ESC}31m${s}${ESC}0m`,
  green: (s) => `${ESC}32m${s}${ESC}0m`,
  yellow: (s) => `${ESC}33m${s}${ESC}0m`,
  blue: (s) => `${ESC}34m${s}${ESC}0m`,
  magenta: (s) => `${ESC}35m${s}${ESC}0m`,
  cyan: (s) => `${ESC}36m${s}${ESC}0m`,
  white: (s) => `${ESC}37m${s}${ESC}0m`,
  // Bright colors
  brightRed: (s) => `${ESC}91m${s}${ESC}0m`,
  brightGreen: (s) => `${ESC}92m${s}${ESC}0m`,
  brightYellow: (s) => `${ESC}93m${s}${ESC}0m`,
  brightBlue: (s) => `${ESC}94m${s}${ESC}0m`,
  brightCyan: (s) => `${ESC}96m${s}${ESC}0m`,
  // Background
  bgBlue: (s) => `${ESC}44m${ESC}97m${s}${ESC}0m`,
  bgGreen: (s) => `${ESC}42m${ESC}97m${s}${ESC}0m`,
  bgRed: (s) => `${ESC}41m${ESC}97m${s}${ESC}0m`,
  bgYellow: (s) => `${ESC}43m${ESC}30m${s}${ESC}0m`,
  bgCyan: (s) => `${ESC}46m${ESC}30m${s}${ESC}0m`,
  bgMagenta: (s) => `${ESC}45m${ESC}97m${s}${ESC}0m`,
  bgWhite: (s) => `${ESC}47m${ESC}30m${s}${ESC}0m`,
  // Inverse (highlight)
  inverse: (s) => `${ESC}7m${s}${ESC}0m`,
};

// ─── HTTP Fetch (built-in) ──────────────────────────────────────
function fetchJson(urlPath) {
  return new Promise((resolve, reject) => {
    const url = `${BRIDGE}${urlPath}`;
    http.get(url, { timeout: 25000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(new Error('timeout')); });
  });
}

// ─── Terminal Size ──────────────────────────────────────────────
function getSize() {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

// ─── Pad/Truncate ───────────────────────────────────────────────
function pad(str, len) {
  str = String(str || '');
  if (str.length > len) return str.slice(0, len - 1) + '…';
  return str + ' '.repeat(Math.max(0, len - str.length));
}
function center(str, len) {
  str = String(str || '');
  if (str.length >= len) return str.slice(0, len);
  const left = Math.floor((len - str.length) / 2);
  return ' '.repeat(left) + str + ' '.repeat(len - str.length - left);
}
function hr(len, ch) {
  return (ch || '─').repeat(len);
}

// ─── App State ──────────────────────────────────────────────────
const state = {
  screen: 'home', // 'home' | 'picker' | 'trains' | 'tracking'
  pickerField: 'from', // 'from' | 'to'

  fromCode: '',
  fromName: '',
  toCode: '',
  toName: '',

  // Picker
  pickerQuery: '',
  pickerResults: [],
  pickerSelected: 0,
  pickerLoading: false,

  // Train list
  trains: [],
  trainSelected: 0,
  trainScroll: 0,
  trainLoading: false,
  trainError: null,

  // Tracking
  trackData: null,
  trackTrainNo: '',
  trackLoading: false,
  trackError: null,
  trackScroll: 0,

  // Status
  bridgeOk: false,
  statusMsg: 'Starting...',

  // Debounce
  _searchTimeout: null,
};

// ─── Popular stations (offline fallback) ────────────────────────
const POPULAR = [
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
  { code: 'TPJ', name: 'TIRUCHIRAPPALLI JN' },
  { code: 'TJ', name: 'THANJAVUR JN' },
  { code: 'BPL', name: 'BHOPAL JN' },
  { code: 'CNB', name: 'KANPUR CENTRAL' },
  { code: 'PUNE', name: 'PUNE JN' },
];

// ─── API Calls ──────────────────────────────────────────────────
async function checkBridge() {
  try {
    const res = await fetchJson('/api/health');
    state.bridgeOk = res && res.success;
    state.statusMsg = state.bridgeOk ? 'Bridge connected ✓' : 'Bridge error';
  } catch {
    state.bridgeOk = false;
    state.statusMsg = '⚠ Bridge not running — start: node bridge/server.mobile.js &';
  }
}

async function searchStations(query) {
  if (!query || query.length < 2) {
    state.pickerResults = POPULAR;
    return;
  }
  state.pickerLoading = true;
  render();
  try {
    const res = await fetchJson(`/api/stations/search/${encodeURIComponent(query)}`);
    if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
      state.pickerResults = res.data;
    } else {
      // Local fallback filter
      state.pickerResults = POPULAR.filter(s =>
        s.code.toLowerCase().includes(query.toLowerCase()) ||
        s.name.toLowerCase().includes(query.toLowerCase())
      );
      if (state.pickerResults.length === 0 && query.length <= 6) {
        state.pickerResults = [{ code: query.toUpperCase(), name: `${query.toUpperCase()} (Custom)` }];
      }
    }
  } catch {
    state.pickerResults = POPULAR.filter(s =>
      s.code.toLowerCase().includes(query.toLowerCase()) ||
      s.name.toLowerCase().includes(query.toLowerCase())
    );
  }
  state.pickerLoading = false;
  state.pickerSelected = 0;
}

async function searchTrains() {
  if (!state.fromCode || !state.toCode) {
    state.statusMsg = 'Select both FROM and TO stations';
    return;
  }
  state.trainLoading = true;
  state.trainError = null;
  state.statusMsg = `Searching trains ${state.fromCode} → ${state.toCode}...`;
  state.screen = 'trains';
  render();
  try {
    const res = await fetchJson(`/api/search/${encodeURIComponent(state.fromCode)}/${encodeURIComponent(state.toCode)}`);
    if (res && res.success && Array.isArray(res.data)) {
      state.trains = res.data;
      if (state.trains.length === 0) {
        state.trainError = 'No direct trains found';
      }
      state.statusMsg = `Found ${state.trains.length} trains`;
    } else {
      state.trains = [];
      state.trainError = res?.error || 'Search failed';
    }
  } catch (e) {
    state.trains = [];
    state.trainError = e.message;
    state.statusMsg = 'Search failed: ' + e.message;
  }
  state.trainLoading = false;
  state.trainSelected = 0;
  state.trainScroll = 0;
  render();
}

async function trackTrain(trainNo) {
  state.trackTrainNo = trainNo;
  state.trackLoading = true;
  state.trackError = null;
  state.trackData = null;
  state.trackScroll = 0;
  state.screen = 'tracking';
  state.statusMsg = `Tracking train ${trainNo}...`;
  render();
  try {
    const res = await fetchJson(`/api/track/${trainNo}`);
    if (res && res.success && res.data) {
      state.trackData = res.data;
      state.statusMsg = `Tracking: ${res.data.train_name || trainNo}`;
    } else {
      state.trackError = res?.error || 'Tracking failed';
      state.statusMsg = 'Tracking failed';
    }
  } catch (e) {
    state.trackError = e.message;
    state.statusMsg = 'Tracking error: ' + e.message;
  }
  state.trackLoading = false;
  render();
}

// ─── Render Functions ───────────────────────────────────────────
function render() {
  const { cols, rows } = getSize();
  ansi.clear();
  ansi.hideCursor();

  switch (state.screen) {
    case 'home': renderHome(cols, rows); break;
    case 'picker': renderPicker(cols, rows); break;
    case 'trains': renderTrains(cols, rows); break;
    case 'tracking': renderTracking(cols, rows); break;
  }

  // Status bar at bottom
  ansi.moveTo(rows, 1);
  const statusLine = ` ${state.statusMsg}`;
  process.stdout.write(ansi.bgBlue(pad(statusLine, cols)));
}

function renderHome(cols, rows) {
  const w = Math.min(cols, 60);
  const startCol = Math.max(1, Math.floor((cols - w) / 2) + 1);
  let row = 2;

  // Title
  ansi.moveTo(row++, startCol);
  process.stdout.write(ansi.bold(ansi.brightCyan(center('🚂 WHERE IS MY TRAIN', w))));
  row++;
  ansi.moveTo(row++, startCol);
  process.stdout.write(ansi.dim(center('Indian Railways • Mobile TUI', w)));
  row++;
  ansi.moveTo(row++, startCol);
  process.stdout.write(ansi.dim(hr(w, '─')));
  row++;

  // FROM station
  ansi.moveTo(row++, startCol);
  const fromLabel = state.fromCode
    ? `${state.fromCode} — ${state.fromName}`
    : '(tap to select)';
  process.stdout.write(
    ansi.bold(ansi.yellow(' FROM: ')) +
    (state.fromCode ? ansi.brightGreen(fromLabel) : ansi.dim(fromLabel))
  );
  ansi.moveTo(row++, startCol);
  process.stdout.write(ansi.dim(`   Press ${ansi.bold(ansi.white('[F]'))} to pick FROM station`));
  row++;

  // TO station
  ansi.moveTo(row++, startCol);
  const toLabel = state.toCode
    ? `${state.toCode} — ${state.toName}`
    : '(tap to select)';
  process.stdout.write(
    ansi.bold(ansi.yellow(' TO:   ')) +
    (state.toCode ? ansi.brightGreen(toLabel) : ansi.dim(toLabel))
  );
  ansi.moveTo(row++, startCol);
  process.stdout.write(ansi.dim(`   Press ${ansi.bold(ansi.white('[T]'))} to pick TO station`));
  row++;

  ansi.moveTo(row++, startCol);
  process.stdout.write(ansi.dim(hr(w, '─')));
  row++;

  // Search button
  ansi.moveTo(row++, startCol);
  if (state.fromCode && state.toCode) {
    process.stdout.write(ansi.bgGreen(center(' ⏎  SEARCH TRAINS  [Enter] ', w)));
  } else {
    process.stdout.write(ansi.dim(center('Select both stations to search', w)));
  }
  row++;

  // Direct track
  ansi.moveTo(row++, startCol);
  process.stdout.write(ansi.dim(hr(w, '─')));
  row++;
  ansi.moveTo(row++, startCol);
  process.stdout.write(ansi.dim(center('Or press [D] to directly track a train by number', w)));

  row += 2;
  ansi.moveTo(row++, startCol);
  process.stdout.write(ansi.dim(center('[Q] Quit', w)));

  // Bridge status
  row++;
  ansi.moveTo(row++, startCol);
  if (state.bridgeOk) {
    process.stdout.write(ansi.dim(center('● Bridge: Connected', w)));
  } else {
    process.stdout.write(ansi.brightRed(center('○ Bridge: Not Connected', w)));
  }
}

function renderPicker(cols, rows) {
  const w = Math.min(cols, 60);
  const startCol = Math.max(1, Math.floor((cols - w) / 2) + 1);
  let row = 2;

  // Title
  ansi.moveTo(row++, startCol);
  const fieldLabel = state.pickerField === 'from' ? 'FROM' : 'TO';
  process.stdout.write(ansi.bold(ansi.brightCyan(center(`Select ${fieldLabel} Station`, w))));
  row++;

  // Search box
  ansi.moveTo(row++, startCol);
  const cursor = state.pickerLoading ? '⟳' : '▸';
  process.stdout.write(
    ansi.bold(` ${cursor} Search: `) +
    ansi.underline(pad(state.pickerQuery || '', w - 12))
  );
  row++;

  ansi.moveTo(row++, startCol);
  process.stdout.write(ansi.dim(hr(w, '─')));

  // Results list
  const maxVisible = rows - row - 3;
  const results = state.pickerResults;

  if (results.length === 0) {
    ansi.moveTo(row++, startCol);
    process.stdout.write(ansi.dim(center('Type to search stations...', w)));
  } else {
    // Scroll window
    let scrollStart = 0;
    if (state.pickerSelected >= scrollStart + maxVisible) {
      scrollStart = state.pickerSelected - maxVisible + 1;
    }

    for (let i = scrollStart; i < Math.min(results.length, scrollStart + maxVisible); i++) {
      ansi.moveTo(row++, startCol);
      const stn = results[i];
      const line = ` ${pad(stn.code, 6)} ${stn.name}`;
      if (i === state.pickerSelected) {
        process.stdout.write(ansi.inverse(pad(line, w)));
      } else {
        process.stdout.write(ansi.cyan(pad(stn.code, 7)) + ansi.white(pad(stn.name, w - 7)));
      }
    }
  }

  // Footer
  ansi.moveTo(rows - 1, startCol);
  process.stdout.write(ansi.dim(center('[↑↓] Navigate  [Enter] Select  [Esc] Back', w)));
}

function renderTrains(cols, rows) {
  const w = Math.min(cols, 70);
  const startCol = Math.max(1, Math.floor((cols - w) / 2) + 1);
  let row = 2;

  // Title
  ansi.moveTo(row++, startCol);
  process.stdout.write(ansi.bold(ansi.brightCyan(
    center(`Trains: ${state.fromCode} → ${state.toCode}`, w)
  )));
  row++;

  if (state.trainLoading) {
    ansi.moveTo(row++, startCol);
    process.stdout.write(ansi.yellow(center('⟳ Searching NTES...', w)));
    return;
  }

  if (state.trainError) {
    ansi.moveTo(row++, startCol);
    process.stdout.write(ansi.brightRed(center(state.trainError, w)));
    row++;
    ansi.moveTo(row++, startCol);
    process.stdout.write(ansi.dim(center('[Esc] Go back', w)));
    return;
  }

  // Header
  ansi.moveTo(row++, startCol);
  process.stdout.write(ansi.bold(ansi.bgCyan(
    pad(' No.', 7) + pad('Train Name', w - 27) + pad('Dep', 7) + pad('Arr', 7) + pad('Dur', 6)
  )));

  // Train list
  const maxVisible = rows - row - 3;
  const trains = state.trains;

  let scrollStart = state.trainScroll;
  if (state.trainSelected >= scrollStart + maxVisible) {
    scrollStart = state.trainSelected - maxVisible + 1;
    state.trainScroll = scrollStart;
  }
  if (state.trainSelected < scrollStart) {
    scrollStart = state.trainSelected;
    state.trainScroll = scrollStart;
  }

  for (let i = scrollStart; i < Math.min(trains.length, scrollStart + maxVisible); i++) {
    ansi.moveTo(row++, startCol);
    const t = trains[i];
    const line =
      pad(t.train_no, 7) +
      pad(t.train_name, w - 27) +
      pad(t.from_time || '--', 7) +
      pad(t.to_time || '--', 7) +
      pad(t.travel_time || '--', 6);

    if (i === state.trainSelected) {
      process.stdout.write(ansi.inverse(pad(line, w)));
    } else {
      process.stdout.write(
        ansi.brightYellow(pad(t.train_no, 7)) +
        ansi.white(pad(t.train_name, w - 27)) +
        ansi.green(pad(t.from_time || '--', 7)) +
        ansi.cyan(pad(t.to_time || '--', 7)) +
        ansi.dim(pad(t.travel_time || '--', 6))
      );
    }
  }

  // Scroll indicator
  if (trains.length > maxVisible) {
    ansi.moveTo(rows - 2, startCol);
    process.stdout.write(ansi.dim(center(
      `${scrollStart + 1}-${Math.min(trains.length, scrollStart + maxVisible)} of ${trains.length}`, w
    )));
  }

  // Footer
  ansi.moveTo(rows - 1, startCol);
  process.stdout.write(ansi.dim(center('[↑↓] Navigate  [Enter] Track  [Esc] Back', w)));
}

function renderTracking(cols, rows) {
  const w = Math.min(cols, 70);
  const startCol = Math.max(1, Math.floor((cols - w) / 2) + 1);
  let row = 2;

  // Title
  ansi.moveTo(row++, startCol);
  const titleText = state.trackData
    ? state.trackData.train_name || `Train ${state.trackTrainNo}`
    : `Train ${state.trackTrainNo}`;
  process.stdout.write(ansi.bold(ansi.brightCyan(center(`🚂 ${titleText}`, w))));
  row++;

  if (state.trackLoading) {
    ansi.moveTo(row++, startCol);
    process.stdout.write(ansi.yellow(center('⟳ Fetching live status from NTES...', w)));
    return;
  }

  if (state.trackError) {
    ansi.moveTo(row++, startCol);
    process.stdout.write(ansi.brightRed(center(`Error: ${state.trackError}`, w)));
    row++;
    ansi.moveTo(row++, startCol);
    process.stdout.write(ansi.dim(center('[R] Retry  [Esc] Back', w)));
    return;
  }

  if (!state.trackData) return;

  const data = state.trackData;

  // Current position
  if (data.current_station) {
    ansi.moveTo(row++, startCol);
    process.stdout.write(
      ansi.bold(ansi.green(' 📍 Position: ')) +
      ansi.brightGreen(data.current_station)
    );
  }
  if (data.current_delay) {
    ansi.moveTo(row++, startCol);
    const delayColor = data.current_delay.includes('0 min') ? ansi.green : ansi.brightRed;
    process.stdout.write(
      ansi.bold(' ⏱  Delay:    ') + delayColor(data.current_delay)
    );
  }
  row++;

  // Station table header
  ansi.moveTo(row++, startCol);
  process.stdout.write(ansi.dim(hr(w, '─')));
  ansi.moveTo(row++, startCol);
  process.stdout.write(ansi.bold(
    pad(' ●', 4) +
    pad('Station', w - 30) +
    pad('Sch Arr', 9) +
    pad('Act Arr', 9) +
    pad('Delay', 8)
  ));
  ansi.moveTo(row++, startCol);
  process.stdout.write(ansi.dim(hr(w, '─')));

  // Station list
  const stations = data.stations || [];
  const maxVisible = rows - row - 3;

  let scrollStart = state.trackScroll;
  if (scrollStart > Math.max(0, stations.length - maxVisible)) {
    scrollStart = Math.max(0, stations.length - maxVisible);
    state.trackScroll = scrollStart;
  }

  for (let i = scrollStart; i < Math.min(stations.length, scrollStart + maxVisible); i++) {
    ansi.moveTo(row++, startCol);
    const s = stations[i];

    // Status indicator
    let indicator, lineColor;
    if (s.status === 'current') {
      indicator = ansi.brightGreen('▶ ');
      lineColor = ansi.brightGreen;
    } else if (s.status === 'passed') {
      indicator = ansi.dim('● ');
      lineColor = ansi.dim;
    } else {
      indicator = ansi.blue('○ ');
      lineColor = ansi.white;
    }

    // Station name (with code)
    const stnLabel = s.station_code
      ? `${s.station_name} (${s.station_code})`
      : s.station_name;

    // Delay text
    let delayText = '--';
    let delayColor = ansi.dim;
    if (s.delay_minutes !== null && s.delay_minutes !== undefined) {
      if (s.delay_minutes === 0) {
        delayText = 'On Time';
        delayColor = ansi.green;
      } else if (s.delay_minutes > 0) {
        delayText = `+${s.delay_minutes}m`;
        delayColor = ansi.brightRed;
      } else {
        delayText = `${s.delay_minutes}m`;
        delayColor = ansi.green;
      }
    }

    process.stdout.write(
      '  ' + indicator +
      lineColor(pad(stnLabel, w - 30)) +
      lineColor(pad(s.scheduled_arrival || '--', 9)) +
      lineColor(pad(s.actual_arrival || '--', 9)) +
      delayColor(pad(delayText, 8))
    );
  }

  // Scroll indicator
  if (stations.length > maxVisible) {
    ansi.moveTo(rows - 2, startCol);
    process.stdout.write(ansi.dim(center(
      `${scrollStart + 1}-${Math.min(stations.length, scrollStart + maxVisible)} of ${stations.length} stations`, w
    )));
  }

  // Footer
  ansi.moveTo(rows - 1, startCol);
  process.stdout.write(ansi.dim(center('[↑↓] Scroll  [R] Refresh  [Esc] Back', w)));
}

// ─── Direct Track Input Mode ────────────────────────────────────
let directTrackMode = false;
let directTrackInput = '';

function renderDirectTrackPrompt(cols, rows) {
  const w = Math.min(cols, 50);
  const startCol = Math.max(1, Math.floor((cols - w) / 2) + 1);
  const midRow = Math.floor(rows / 2);

  ansi.clear();
  ansi.moveTo(midRow - 2, startCol);
  process.stdout.write(ansi.bold(ansi.brightCyan(center('Direct Train Track', w))));
  ansi.moveTo(midRow, startCol);
  process.stdout.write(ansi.bold(' Enter train number: ') + ansi.underline(pad(directTrackInput, 10)));
  ansi.moveTo(midRow + 2, startCol);
  process.stdout.write(ansi.dim(center('[Enter] Track  [Esc] Cancel', w)));
  ansi.showCursor();
}

// ─── Key Handler ────────────────────────────────────────────────
function handleKey(key) {
  // Direct track mode
  if (directTrackMode) {
    if (key === '\x1b' || key === '\x1b[D') { // Escape
      directTrackMode = false;
      directTrackInput = '';
      render();
      return;
    }
    if (key === '\r') { // Enter
      if (directTrackInput.length >= 4) {
        directTrackMode = false;
        trackTrain(directTrackInput);
        directTrackInput = '';
      }
      return;
    }
    if (key === '\x7f' || key === '\b') { // Backspace
      directTrackInput = directTrackInput.slice(0, -1);
      renderDirectTrackPrompt(getSize().cols, getSize().rows);
      return;
    }
    if (/^\d$/.test(key) && directTrackInput.length < 6) {
      directTrackInput += key;
      renderDirectTrackPrompt(getSize().cols, getSize().rows);
      return;
    }
    return;
  }

  switch (state.screen) {
    case 'home':
      handleHomeKey(key);
      break;
    case 'picker':
      handlePickerKey(key);
      break;
    case 'trains':
      handleTrainsKey(key);
      break;
    case 'tracking':
      handleTrackingKey(key);
      break;
  }
}

function handleHomeKey(key) {
  const k = key.toLowerCase();
  if (k === 'q' || key === '\x03') { // q or Ctrl+C
    cleanup();
    process.exit(0);
  }
  if (k === 'f') {
    state.screen = 'picker';
    state.pickerField = 'from';
    state.pickerQuery = '';
    state.pickerResults = POPULAR;
    state.pickerSelected = 0;
    render();
  }
  if (k === 't') {
    state.screen = 'picker';
    state.pickerField = 'to';
    state.pickerQuery = '';
    state.pickerResults = POPULAR;
    state.pickerSelected = 0;
    render();
  }
  if (key === '\r') { // Enter — search trains
    searchTrains();
  }
  if (k === 'd') {
    directTrackMode = true;
    directTrackInput = '';
    renderDirectTrackPrompt(getSize().cols, getSize().rows);
  }
}

function handlePickerKey(key) {
  if (key === '\x1b' || key === '\x1b[D') { // Escape
    state.screen = 'home';
    render();
    return;
  }
  if (key === '\x1b[A') { // Up
    if (state.pickerSelected > 0) state.pickerSelected--;
    render();
    return;
  }
  if (key === '\x1b[B') { // Down
    if (state.pickerSelected < state.pickerResults.length - 1) state.pickerSelected++;
    render();
    return;
  }
  if (key === '\r') { // Enter — select station
    const selected = state.pickerResults[state.pickerSelected];
    if (selected) {
      if (state.pickerField === 'from') {
        state.fromCode = selected.code;
        state.fromName = selected.name;
      } else {
        state.toCode = selected.code;
        state.toName = selected.name;
      }
      state.screen = 'home';
      state.statusMsg = `Selected: ${selected.code} — ${selected.name}`;
    }
    render();
    return;
  }
  if (key === '\x7f' || key === '\b') { // Backspace
    state.pickerQuery = state.pickerQuery.slice(0, -1);
    debouncedSearch();
    render();
    return;
  }
  // Printable character
  if (key.length === 1 && key.charCodeAt(0) >= 32) {
    state.pickerQuery += key;
    debouncedSearch();
    render();
    return;
  }
}

function debouncedSearch() {
  if (state._searchTimeout) clearTimeout(state._searchTimeout);
  state._searchTimeout = setTimeout(async () => {
    await searchStations(state.pickerQuery);
    render();
  }, 300);
}

function handleTrainsKey(key) {
  if (key === '\x1b' || key === '\x1b[D') { // Escape
    state.screen = 'home';
    render();
    return;
  }
  if (key === '\x1b[A') { // Up
    if (state.trainSelected > 0) state.trainSelected--;
    render();
    return;
  }
  if (key === '\x1b[B') { // Down
    if (state.trainSelected < state.trains.length - 1) state.trainSelected++;
    render();
    return;
  }
  if (key === '\r') { // Enter — track selected train
    const t = state.trains[state.trainSelected];
    if (t && t.train_no) {
      trackTrain(t.train_no);
    }
    return;
  }
}

function handleTrackingKey(key) {
  if (key === '\x1b' || key === '\x1b[D') { // Escape
    state.screen = state.trains.length > 0 ? 'trains' : 'home';
    render();
    return;
  }
  if (key === '\x1b[A') { // Up
    if (state.trackScroll > 0) state.trackScroll--;
    render();
    return;
  }
  if (key === '\x1b[B') { // Down
    state.trackScroll++;
    render();
    return;
  }
  if (key.toLowerCase() === 'r') { // Refresh
    trackTrain(state.trackTrainNo);
    return;
  }
}

// ─── Cleanup ────────────────────────────────────────────────────
function cleanup() {
  ansi.showCursor();
  ansi.clear();
  ansi.moveTo(1, 1);
  process.stdout.write('Goodbye! 🚂\n');
}

// ─── Main ───────────────────────────────────────────────────────
async function main() {
  // Handle terminal resize
  process.stdout.on('resize', () => render());

  // Setup raw input
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  // Parse key sequences
  process.stdin.on('data', (data) => {
    // Arrow keys come as escape sequences
    if (data === '\x1b[A' || data === '\x1b[B' ||
        data === '\x1b[C' || data === '\x1b[D') {
      handleKey(data);
      return;
    }
    // Other escape
    if (data === '\x1b') {
      handleKey('\x1b');
      return;
    }
    // Handle each character
    for (const ch of data) {
      handleKey(ch);
    }
  });

  // Check bridge
  await checkBridge();

  // Initial render
  render();
}

main().catch((err) => {
  cleanup();
  console.error('Fatal error:', err);
  process.exit(1);
});
