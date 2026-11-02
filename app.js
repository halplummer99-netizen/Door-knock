'use strict';

/* ============================================================
   Door Knock: plan a route, log every door, export a CSV.
   Everything is stored on the phone in IndexedDB.
   ============================================================ */

// The dashboard relies on these exact columns in this exact order.
const CSV_COLUMNS = [
  'run_id', 'run_date', 'stop_order', 'address', 'postcode', 'lat', 'lng', 'outcome',
  'contact_name', 'contact_phone', 'situation', 'timescale', 'notes', 'hot_lead', 'follow_up_date',
  'neighbours_leafleted_count', 'neighbours_leafleted_numbers', 'logged_at'
];

const OUTCOMES = [
  { k: 'answered', label: 'Answered', short: 'Answered' },
  { k: 'no_answer_leaflet', label: 'No answer – leaflet & comp slip left', short: 'Leafleted' },
  { k: 'no_cold_callers', label: 'No cold callers sign', short: 'No cold callers' },
  { k: 'other', label: 'Other', short: 'Other' }
];
const SITUATIONS = [
  ['thinking_of_selling', 'Thinking of selling'],
  ['not_now', 'Not now'],
  ['just_sold', 'Just sold'],
  ['renting', 'Renting']
];
const TIMESCALES = ['0-3 months', '3-6 months', '6-12 months', '12+ months', 'Unknown'];
const DEFAULT_SETTINGS = { apiKey: '', start: 'CM3 5ZF', end: 'CM3 5ZF', chunk: 9 };
const MAX_STOPS = 25; // Routes API limit for optimizeWaypointOrder
const PC_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/gi;

const S = { settings: { ...DEFAULT_SETTINGS }, run: null, view: 'setup', viewRun: null, mapsAuthFailed: false };
const $ = (sel) => document.querySelector(sel);
const app = $('#app');

/* ---------------- IndexedDB ---------------- */
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('doorknock', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('runs')) db.createObjectStore('runs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  },
  async tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  },
  get(store, key) { return this.tx(store, 'readonly', (s) => s.get(key)); },
  put(store, value, key) { return this.tx(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key))); },
  del(store, key) { return this.tx(store, 'readwrite', (s) => s.delete(key)); },
  all(store) { return this.tx(store, 'readonly', (s) => s.getAll()); }
};

let saveTimer = null;
function saveRun(run = S.run) {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!run) return Promise.resolve();
  run.updated = Date.now();
  // Structured clone of a plain object: safe to keep mutating S.run afterwards.
  return DB.put('runs', run).then(() => flashSaved()).catch((e) => toast('Could not save: ' + e.message));
}
function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveRun(), 300);
}
function flushSave() { if (saveTimer) saveRun(); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
window.addEventListener('pagehide', flushSave);

/* ---------------- Helpers ---------------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const uid = () => Math.random().toString(36).slice(2, 10);
const pad = (n) => String(n).padStart(2, '0');
function localDate(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function nowIso(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
function prettyDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function normPc(pc) {
  const m = String(pc || '').toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  return m ? `${m[1]} ${m[2]}` : String(pc || '').toUpperCase().trim();
}

// "12 High Street, Rayleigh SS6 7AB" -> { address: "12 High Street, Rayleigh", postcode: "SS6 7AB" }
function parseAddressLine(raw) {
  raw = raw.trim().replace(/[,\s]+$/, '');
  const matches = [...raw.matchAll(PC_RE)];
  if (!matches.length) return { raw, address: raw, postcode: '' };
  const m = matches[matches.length - 1];
  const postcode = normPc(m[1] + m[2]);
  const address = (raw.slice(0, m.index) + raw.slice(m.index + m[0].length)).replace(/[,\s]+$/, '').replace(/^[,\s]+/, '').replace(/,\s*,/g, ',');
  return { raw, address: address || raw, postcode };
}
function hasPostcode(s) { PC_RE.lastIndex = 0; const r = PC_RE.test(s); PC_RE.lastIndex = 0; return r; }

let toastTimer = null;
function toast(msg, action, ms = 3500) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : '');
  el.hidden = false;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : ms);
}
let savedTimer = null;
function flashSaved() {
  const el = $('#saved');
  if (!el) return;
  el.textContent = 'Saved on phone ✓';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { el.textContent = ''; }, 1500);
}
function setStatus(text) { $('#tb-status').textContent = text || ''; }

function emptyLog() {
  return {
    outcome: '', contact_name: '', contact_phone: '', situation: '', timescale: '', notes: '',
    hot_lead: false, follow_up_date: '', nb_count: 0, nb_numbers: '', logged_at: ''
  };
}
function makeStop(line) {
  const p = parseAddressLine(line);
  return { uid: uid(), raw: p.raw, address: p.address, postcode: p.postcode, lat: null, lng: null, geo: 'pending', note: '', formatted: '', log: emptyLog() };
}
function newRun(lines, start, end) {
  const d = new Date();
  return {
    id: `DK-${localDate(d).replace(/-/g, '')}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
    created: Date.now(),
    run_date: localDate(d),
    status: 'planning',
    start: { label: start, lat: null, lng: null },
    end: { label: end, lat: null, lng: null },
    stops: lines.map(makeStop),
    idx: 0,
    route: null,
    optNote: ''
  };
}

/* ---------------- CSV ---------------- */
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

// Accepts "address, postcode" run lists, or the SPRIFT lists (first_line, street, postcode).
function csvToLines(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const hdr = rows[0].map((x) => x.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  let ai = hdr.findIndex((h) => ['address', 'full_address', 'address_line', 'property_address'].includes(h));
  const fi = hdr.indexOf('first_line');
  const si = hdr.indexOf('street');
  let pi = hdr.findIndex((h) => ['postcode', 'post_code', 'postal_code'].includes(h));
  const isHeader = ai >= 0 || fi >= 0 || pi >= 0;
  const data = isHeader ? rows.slice(1) : rows;
  if (!isHeader) { ai = 0; pi = rows[0].length > 1 ? 1 : -1; }
  const out = [];
  for (const r of data) {
    let a = ai >= 0 ? (r[ai] || '').trim() : '';
    if (!a && (fi >= 0 || si >= 0)) {
      const f = fi >= 0 ? (r[fi] || '').trim() : '';
      const s = si >= 0 ? (r[si] || '').trim() : '';
      if (!s || f.toLowerCase().includes(s.toLowerCase())) a = f;
      else if (/^\d+[a-z]?$/i.test(f)) a = `${f} ${s}`;
      else a = [f, s].filter(Boolean).join(', ');
    }
    const pc = pi >= 0 ? (r[pi] || '').trim() : '';
    if (!a && !pc) continue;
    out.push(pc && !hasPostcode(a) ? `${a}, ${pc}` : a);
  }
  return out;
}

// Shared text (WhatsApp, Notes, Maps…): drop links, and join multi-line addresses
// so each one ends at its postcode.
function sharedTextToLines(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/https?:\/\/\S+/gi, '').trim().replace(/^[-•*\d]+[.)]\s+/, ''))
    .filter((l) => l && !/[:?!]$/.test(l)); // "Here are the doors:" etc.
  if (!lines.some(hasPostcode)) return lines;
  const out = [];
  let buf = [];
  for (const l of lines) {
    buf.push(l.replace(/[,\s]+$/, ''));
    if (hasPostcode(l)) {
      // An address starts at its house/flat number; anything before that stands alone.
      const first = buf.findIndex((x) => /^(\d|flat|apartment|apt|unit)/i.test(x));
      if (first > 0) out.push(...buf.splice(0, first));
      out.push(buf.join(', '));
      buf = [];
    }
  }
  if (buf.length) out.push(...buf);
  return out;
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function runRows(run) {
  return run.stops.map((s, i) => {
    const L = s.log;
    return [
      run.id, run.run_date, i + 1, s.address, s.postcode,
      s.lat == null ? '' : s.lat.toFixed(6), s.lng == null ? '' : s.lng.toFixed(6),
      L.outcome || 'not_logged', L.contact_name, L.contact_phone, L.situation, L.timescale, L.notes,
      L.hot_lead ? 'TRUE' : 'FALSE', L.follow_up_date, L.nb_count || 0, L.nb_numbers, L.logged_at
    ];
  });
}
function buildCsv(runs) {
  const rows = [CSV_COLUMNS, ...runs.flatMap(runRows)];
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
async function exportCsv(runs, filename, mode) {
  const csv = buildCsv(runs);
  const file = new File([csv], filename, { type: 'text/csv' });
  if (mode === 'share' && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast('CSV saved to Downloads');
}

/* ---------------- Google: Maps JS (geocoding) + Routes API ---------------- */
let mapsPromise = null;
function loadMaps() {
  if (window.google && google.maps && google.maps.importLibrary) return Promise.resolve();
  if (mapsPromise) return mapsPromise;
  if (!S.settings.apiKey) return Promise.reject(new Error('Add your Google Maps API key in Settings first.'));
  if (!navigator.onLine) return Promise.reject(new Error('No signal. Planning a route needs internet.'));
  mapsPromise = new Promise((resolve, reject) => {
    window.__dkMapsReady = resolve;
    window.gm_authFailure = () => {
      S.mapsAuthFailed = true;
      toast('Google rejected the API key. Check Settings and the key restrictions.', null, 8000);
    };
    const s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(S.settings.apiKey) +
      '&v=weekly&loading=async&callback=__dkMapsReady&region=GB&language=en-GB';
    s.async = true;
    s.onerror = () => { mapsPromise = null; s.remove(); reject(new Error('Could not load Google Maps. Check your signal.')); };
    document.head.appendChild(s);
  });
  return mapsPromise;
}

const ADDRESS_TYPES = ['street_address', 'premise', 'subpremise', 'establishment', 'point_of_interest'];
async function geocode(query, expectedPc) {
  const cacheKey = 'g:' + query.toLowerCase().replace(/\s+/g, ' ').trim();
  const cached = await DB.get('kv', cacheKey);
  if (cached) return cached;
  await loadMaps();
  if (S.mapsAuthFailed) throw new Error('Google rejected the API key. Check Settings.');
  const { Geocoder } = await google.maps.importLibrary('geocoding');
  let resp;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      resp = await new Geocoder().geocode({ address: query, region: 'gb', componentRestrictions: { country: 'GB' } });
      break;
    } catch (e) {
      const code = e.code || String(e.message || e);
      if (/ZERO_RESULTS/.test(code)) return { geo: 'fail', note: 'Google couldn’t find this address' };
      if (/REQUEST_DENIED/.test(code)) throw new Error('Google refused the request. Google says: ' + (e.message || code));
      if (/OVER_QUERY_LIMIT/.test(code) && attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      return { geo: 'fail', note: 'Lookup failed (' + code + ')' };
    }
  }
  const r = resp && resp.results && resp.results[0];
  if (!r) return { geo: 'fail', note: 'Google couldn’t find this address' };
  const pcComp = r.address_components.find((c) => c.types.includes('postal_code'));
  const gotPc = pcComp ? normPc(pcComp.long_name) : '';
  let geo = 'ok', note = '';
  if (expectedPc && gotPc && gotPc !== normPc(expectedPc)) { geo = 'check'; note = `Google matched ${gotPc}, not ${normPc(expectedPc)}`; }
  else if (!r.types.some((t) => ADDRESS_TYPES.includes(t))) { geo = 'check'; note = 'Only matched to the street/postcode, pin may be off'; }
  else if (r.partial_match) { geo = 'check'; note = 'Partial match, check the address'; }
  const out = { geo, note, lat: r.geometry.location.lat(), lng: r.geometry.location.lng(), formatted: r.formatted_address };
  DB.put('kv', out, cacheKey).catch(() => {});
  return out;
}

async function geocodeStop(stop) {
  const res = await geocode(stop.raw + ', UK', stop.postcode);
  Object.assign(stop, { lat: null, lng: null, formatted: '', ...res });
}
async function geocodeEnd(point) {
  if (point.lat != null && point.geoLabel === point.label) return;
  const res = await geocode(point.label + ', UK', '');
  point.geoLabel = point.label;
  if (res.geo !== 'fail') { point.lat = res.lat; point.lng = res.lng; } else { point.lat = point.lng = null; }
}

function waypoint(p) {
  return p.lat != null
    ? { location: { latLng: { latitude: p.lat, longitude: p.lng } } }
    : { address: (p.label || p.raw) + ', UK' };
}

async function optimiseRoute(run) {
  run.optNote = '';
  const located = run.stops.filter((s) => s.lat != null);
  const missing = run.stops.filter((s) => s.lat == null);
  if (located.length < 2) { run.route = null; return; }
  if (located.length > MAX_STOPS) { run.optNote = `Google can only optimise ${MAX_STOPS} stops at once.`; return; }
  if (!navigator.onLine) throw new Error('No signal. Optimising needs internet.');
  const json = await computeRoutes({
    origin: waypoint(run.start),
    destination: waypoint(run.end),
    intermediates: located.map(waypoint),
    travelMode: 'DRIVE',
    optimizeWaypointOrder: true,
    regionCode: 'GB',
    units: 'IMPERIAL'
  });
  const route = json.routes && json.routes[0];
  if (!route) throw new Error('Routes API returned no route.');
  const order = route.optimizedIntermediateWaypointIndex;
  const ordered = Array.isArray(order) && order.length === located.length && order[0] !== -1 ? order.map((i) => located[i]) : located;
  run.stops = [...ordered, ...missing];
  run.route = { distanceMeters: route.distanceMeters || 0, duration: route.duration || '' };
}

async function computeRoutes(body) {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    referrerPolicy: 'no-referrer-when-downgrade',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': S.settings.apiKey,
      'X-Goog-FieldMask': 'routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration'
    },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json.error && json.error.message) || `HTTP ${res.status}`;
    throw new Error('Routes API: ' + msg);
  }
  return json;
}

function routeSummary(run) {
  if (!run.route) return '';
  const miles = (run.route.distanceMeters / 1609.344).toFixed(1);
  const secs = parseInt(run.route.duration, 10) || 0;
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
  return `${miles} mi · ${h ? h + ' h ' : ''}${m} min driving`;
}

/* ---------------- Google Maps links ---------------- */
const coord = (p) => (p.lat != null ? `${p.lat.toFixed(6)},${p.lng.toFixed(6)}` : (p.label || p.raw));
function mapsLegs(run) {
  const pts = [run.start, ...run.stops, run.end];
  const per = Math.max(1, Math.min(9, parseInt(S.settings.chunk, 10) || 9));
  const legs = [];
  for (let a = 0; a < pts.length - 1; a += per + 1) {
    const b = Math.min(a + per + 1, pts.length - 1);
    const via = pts.slice(a + 1, b);
    let url = 'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
      '&origin=' + encodeURIComponent(coord(pts[a])) +
      '&destination=' + encodeURIComponent(coord(pts[b]));
    if (via.length) url += '&waypoints=' + via.map((p) => encodeURIComponent(coord(p))).join('%7C');
    const name = (i) => (i === 0 ? 'Start' : i === pts.length - 1 ? 'End' : 'Stop ' + i);
    legs.push({ url, label: `${name(a)} → ${name(b)}` });
  }
  return legs;
}
function navUrl(stop) {
  return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=' + encodeURIComponent(coord(stop));
}
function legsHtml(run) {
  const legs = mapsLegs(run);
  const intro = legs.length > 1
    ? `<p class="hint">Google Maps on a phone takes up to ${esc(S.settings.chunk)} stops per link, so the route is split into ${legs.length} parts. Open the next part when you finish one.</p>`
    : '';
  return intro + `<div class="legs">${legs.map((l, i) =>
    `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener">${legs.length > 1 ? `Part ${i + 1}: ` : 'Open full route: '}${esc(l.label)}</a>`).join('')}</div>`;
}

/* ---------------- Navigation between screens ---------------- */
function go(view, push = true) {
  flushSave();
  S.view = view;
  if (push) history.pushState({ view }, '');
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', (e) => {
  const v = (e.state && e.state.view) || (S.run && S.run.status === 'active' ? 'door' : 'setup');
  S.view = v;
  closeSheet();
  render();
});
$('#tb-home').onclick = () => go(S.run && S.run.status === 'active' ? 'door' : S.run && S.run.status === 'planning' ? 'review' : 'setup');
$('#tb-runs').onclick = () => go('history');
$('#tb-settings').onclick = () => go('settings');

function render() {
  setStatus(S.run && S.run.status === 'active' ? `Run in progress · ${loggedCount(S.run)}/${S.run.stops.length}` : '');
  ({ setup: renderSetup, review: renderReview, door: renderDoor, summary: renderSummary, history: renderHistory, settings: renderSettings }[S.view] || renderSetup)();
}

const loggedCount = (run) => run.stops.filter((s) => s.log.outcome).length;

/* ---------------- Setup ---------------- */
async function renderSetup() {
  const draft = (await DB.get('kv', 'draft')) || {};
  const active = S.run && (S.run.status === 'active' || S.run.status === 'planning') ? S.run : null;
  app.innerHTML = `
    <h2>Plan a run</h2>
    ${active ? `<div class="notice info">You have a run ${active.status === 'active' ? 'in progress' : 'being planned'} (${active.stops.length} stops, ${prettyDate(active.run_date)}).
      <button class="btn pri" id="resume" type="button">${active.status === 'active' ? 'Resume run' : 'Back to route check'}</button></div>` : ''}
    ${!S.settings.apiKey ? `<div class="notice warn">Add your Google Maps API key before planning. <button class="btn" id="to-settings" type="button">Open Settings</button></div>` : ''}
    <label for="addr">Addresses, one per line, with postcode</label>
    <textarea id="addr" spellcheck="false" placeholder="12 High Street, Rayleigh SS6 7AB&#10;4 Rectory Road, Hockley SS5 4AA">${esc(draft.text || '')}</textarea>
    <div class="hint" id="addr-count"></div>
    <div class="stack">
      <button class="btn" id="import" type="button">Import CSV run list</button>
      <input type="file" id="file" accept=".csv,text/csv,text/plain" hidden>
    </div>
    <label for="start">Start point</label>
    <input type="text" id="start" value="${esc(draft.start || S.settings.start)}" autocomplete="off">
    <label for="end">End point</label>
    <input type="text" id="end" value="${esc(draft.end || S.settings.end)}" autocomplete="off">
    <div class="stack">
      <button class="btn pri big" id="plan" type="button">Plan route</button>
      <button class="btn small" id="clear" type="button">Clear addresses</button>
    </div>
    <div id="plan-status" class="notice info" hidden></div>
  `;
  const ta = $('#addr');
  const count = () => {
    const n = ta.value.split(/\r?\n/).filter((l) => l.trim()).length;
    const noPc = ta.value.split(/\r?\n/).filter((l) => l.trim() && !hasPostcode(l)).length;
    $('#addr-count').textContent = n ? `${n} address${n === 1 ? '' : 'es'}${noPc ? ` · ${noPc} without a postcode` : ''}${n > MAX_STOPS ? ` · max ${MAX_STOPS} per run` : ''}` : '';
  };
  const saveDraft = () => DB.put('kv', { text: ta.value, start: $('#start').value, end: $('#end').value }, 'draft');
  count();
  ta.oninput = () => { count(); saveDraft(); };
  $('#start').oninput = saveDraft;
  $('#end').oninput = saveDraft;
  if ($('#resume')) $('#resume').onclick = () => go(active.status === 'active' ? 'door' : 'review');
  if ($('#to-settings')) $('#to-settings').onclick = () => go('settings');
  $('#import').onclick = () => $('#file').click();
  $('#file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const lines = csvToLines(await f.text());
    addLinesToDraft(lines, `Imported ${lines.length} address${lines.length === 1 ? '' : 'es'} from ${f.name}`);
  };
  $('#clear').onclick = () => {
    if (!ta.value.trim()) return;
    const old = ta.value;
    ta.value = ''; count(); saveDraft();
    toast('Addresses cleared', { label: 'Undo', fn: () => { ta.value = old; count(); saveDraft(); } });
  };
  $('#plan').onclick = planRoute;
}

async function addLinesToDraft(lines, message) {
  const draft = (await DB.get('kv', 'draft')) || {};
  const existing = (draft.text || '').trim();
  draft.text = (existing ? existing + '\n' : '') + lines.join('\n');
  await DB.put('kv', draft, 'draft');
  if (S.view === 'setup') renderSetup(); else go('setup');
  toast(lines.length ? message : 'Nothing that looked like an address was found');
}

async function planRoute() {
  const lines = $('#addr').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const start = $('#start').value.trim() || S.settings.start;
  const end = $('#end').value.trim() || S.settings.end;
  if (!lines.length) return toast('Paste or import some addresses first');
  if (lines.length > MAX_STOPS) return toast(`That's ${lines.length} addresses. Max ${MAX_STOPS} per run, so split it in two.`);
  if (!S.settings.apiKey) return go('settings');

  const btn = $('#plan');
  const status = $('#plan-status');
  const say = (t) => { status.hidden = false; status.className = 'notice info'; status.textContent = t; };
  btn.disabled = true;
  const run = newRun(lines, start, end);
  try {
    say('Loading Google Maps…');
    await loadMaps();
    say('Finding start and end points…');
    await geocodeEnd(run.start);
    await geocodeEnd(run.end);
    for (let i = 0; i < run.stops.length; i++) {
      say(`Finding address ${i + 1} of ${run.stops.length}…`);
      await geocodeStop(run.stops[i]);
    }
    say('Working out the best driving order…');
    try { await optimiseRoute(run); } catch (e) { run.optNote = e.message; }
    S.run = run;
    await saveRun(run);
    await DB.put('kv', run.id, 'currentRunId');
    go('review');
  } catch (e) {
    status.className = 'notice bad';
    status.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- Review route ---------------- */
function renderReview() {
  const run = S.run;
  if (!run) return go('setup', false);
  const fails = run.stops.filter((s) => s.geo === 'fail').length;
  const checks = run.stops.filter((s) => s.geo === 'check').length;
  const startMissing = run.start.lat == null || run.end.lat == null;
  app.innerHTML = `
    <h2>Check your route</h2>
    <p class="meta">${run.stops.length} stops${run.route ? ' · ' + esc(routeSummary(run)) : ''}${run.manual ? ' · your order' : ''}</p>
    ${run.optNote ? `<div class="notice warn">Couldn't optimise the order: ${esc(run.optNote)}</div>` : ''}
    ${fails ? `<div class="notice bad">${fails} address${fails === 1 ? '' : 'es'} couldn't be found. Fix ${fails === 1 ? 'it' : 'them'} below (red), or delete.</div>` : ''}
    ${checks ? `<div class="notice warn">${checks} address${checks === 1 ? '' : 'es'} might be in the wrong spot (orange). Worth a quick check.</div>` : ''}
    ${startMissing ? `<div class="notice warn">Start or end point wasn't found on the map, so it's used as typed.</div>` : ''}
    <p class="hint">Drag ☰ to reorder. Tap ✕ to delete.</p>
    <ol class="stops" id="stops">
      ${run.stops.map((s, i) => `
        <li data-uid="${s.uid}" class="${s.geo === 'fail' ? 'fail' : s.geo === 'check' ? 'check' : ''}">
          <span class="handle" aria-label="Drag to reorder">☰</span>
          <span class="num">${i + 1}</span>
          <div class="stop-body">
            <b>${esc(s.address)}</b>
            <small>${esc(s.postcode || 'no postcode')}${s.formatted && s.geo !== 'ok' ? ' · Google: ' + esc(s.formatted) : ''}</small>
            ${s.geo === 'fail' ? `<span class="flag bad">NOT FOUND</span>` : ''}
            ${s.geo === 'check' ? `<span class="flag warn">${esc(s.note)}</span>` : ''}
            <div class="edit-row" ${s.geo === 'fail' ? '' : 'hidden'}>
              <input type="text" value="${esc(s.raw)}" aria-label="Edit address">
              <button class="btn small" type="button" data-act="retry">Retry</button>
            </div>
            ${s.geo === 'check' ? `<button class="btn small" type="button" data-act="edit" style="margin-top:6px">Edit</button>` : ''}
          </div>
          <button class="icon-btn" type="button" data-act="del" aria-label="Delete stop">✕</button>
        </li>`).join('')}
    </ol>
    <div class="edit-row">
      <input type="text" id="add-addr" placeholder="Add another address with postcode">
      <button class="btn small" type="button" id="add">Add</button>
    </div>
    <div class="stack">
      <button class="btn" id="reopt" type="button">Re-optimise order</button>
    </div>
    <h3 style="margin-top:20px">Google Maps</h3>
    ${legsHtml(run)}
    <div class="stack">
      <button class="btn pri big" id="go" type="button">Start knocking</button>
      <button class="btn small" id="back" type="button">Back to addresses</button>
    </div>
  `;
  const list = $('#stops');
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const li = btn.closest('li');
    const i = run.stops.findIndex((s) => s.uid === li.dataset.uid);
    const stop = run.stops[i];
    if (btn.dataset.act === 'del') {
      run.stops.splice(i, 1);
      await saveRun();
      renderReview();
      toast(`Deleted ${stop.address}`, { label: 'Undo', fn: async () => { run.stops.splice(i, 0, stop); await saveRun(); renderReview(); } });
    } else if (btn.dataset.act === 'edit') {
      li.querySelector('.edit-row').hidden = false;
      btn.hidden = true;
      li.querySelector('.edit-row input').focus();
    } else if (btn.dataset.act === 'retry') {
      const val = li.querySelector('.edit-row input').value.trim();
      if (!val) return;
      btn.disabled = true; btn.textContent = '…';
      try {
        Object.assign(stop, parseAddressLine(val));
        await geocodeStop(stop);
        await saveRun();
        renderReview();
        toast(stop.geo === 'fail' ? 'Still not found. Try adding the town, or check the postcode.' : 'Found it. Tap Re-optimise to fit it into the route.');
      } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = 'Retry'; }
    }
  });
  bindDrag(list);
  $('#add').onclick = async () => {
    const val = $('#add-addr').value.trim();
    if (!val) return;
    if (run.stops.length >= MAX_STOPS) return toast(`Max ${MAX_STOPS} stops per run`);
    const stop = makeStop(val);
    $('#add').disabled = true;
    try { await geocodeStop(stop); } catch (err) { toast(err.message); }
    run.stops.push(stop);
    await saveRun();
    renderReview();
    toast('Added at the end. Tap Re-optimise to fit it in.');
  };
  $('#reopt').onclick = async () => {
    $('#reopt').disabled = true; $('#reopt').textContent = 'Optimising…';
    try {
      await loadMaps();
      await geocodeEnd(run.start); await geocodeEnd(run.end);
      await optimiseRoute(run);
      run.manual = false;
    } catch (e) { run.optNote = e.message; }
    await saveRun();
    renderReview();
  };
  $('#back').onclick = () => go('setup');
  $('#go').onclick = async () => {
    if (!run.stops.length) return toast('No stops in this run');
    const fails = run.stops.filter((s) => s.geo === 'fail').length;
    if (fails && !confirm(`${fails} address${fails === 1 ? '' : 'es'} couldn't be found on the map. ${fails === 1 ? 'It' : 'They'}'ll stay at the end of the run with no pin. Start anyway?`)) return;
    run.status = 'active';
    run.run_date = localDate();
    run.started = Date.now();
    run.idx = 0;
    await saveRun();
    go('door');
  };
}

// Drag-to-reorder with the ☰ handle (works with a thumb).
function bindDrag(list) {
  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.handle');
    if (!handle) return;
    e.preventDefault();
    const li = handle.closest('li');
    li.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    let scroller = null;
    const move = (ev) => {
      const y = ev.clientY;
      let before = null;
      for (const sib of list.children) {
        if (sib === li) continue;
        const r = sib.getBoundingClientRect();
        if (y < r.top + r.height / 2) { before = sib; break; }
      }
      if (before !== li.nextSibling) list.insertBefore(li, before);
      clearInterval(scroller);
      if (y < 90) scroller = setInterval(() => window.scrollBy(0, -12), 16);
      else if (y > window.innerHeight - 90) scroller = setInterval(() => window.scrollBy(0, 12), 16);
    };
    const up = () => {
      clearInterval(scroller);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      li.classList.remove('dragging');
      const order = [...list.children].map((x) => x.dataset.uid);
      const before = S.run.stops.map((s) => s.uid).join();
      S.run.stops.sort((a, b) => order.indexOf(a.uid) - order.indexOf(b.uid));
      if (S.run.stops.map((s) => s.uid).join() !== before) {
        S.run.manual = true;
        S.run.route = null;
        saveRun();
      }
      renderReview();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

/* ---------------- Door card ---------------- */
function renderDoor() {
  const run = S.run;
  if (!run || run.status === 'planning') return go(run ? 'review' : 'setup', false);
  run.idx = Math.max(0, Math.min(run.idx || 0, run.stops.length - 1));
  const i = run.idx;
  const s = run.stops[i];
  const L = s.log;
  const total = run.stops.length;
  const isLast = i === total - 1;
  app.innerHTML = `
    <div class="progress" aria-label="Run progress"><div style="width:${Math.round((loggedCount(run) / total) * 100)}%"></div></div>
    <div class="stopline">Stop ${i + 1} of ${total}<span>${loggedCount(run)} logged</span></div>
    <div class="card" id="card">
      <h2 class="addr">${esc(s.address)}</h2>
      <div class="pc">${esc(s.postcode)}</div>
      ${s.geo === 'fail' ? `<div class="notice bad">No map pin for this one. Navigate will search the address.</div>` : ''}
      ${s.geo === 'check' ? `<div class="notice warn">${esc(s.note)}</div>` : ''}
      <a class="btn" href="${esc(navUrl(s))}" target="_blank" rel="noopener">Navigate here</a>

      <div class="outcomes" role="group" aria-label="Outcome">
        ${OUTCOMES.map((o, n) => `<button type="button" class="outcome${L.outcome === o.k ? ' on' : ''}" data-o="${o.k}"><span class="n"><i>${n + 1}</i></span><span>${esc(o.label)}</span></button>`).join('')}
      </div>

      <div id="ans" ${L.outcome === 'answered' ? '' : 'hidden'}>
        <label for="f-name">Name</label>
        <input type="text" id="f-name" data-f="contact_name" value="${esc(L.contact_name)}" autocomplete="off" autocapitalize="words">
        <label for="f-phone">Phone (optional)</label>
        <input type="tel" id="f-phone" data-f="contact_phone" value="${esc(L.contact_phone)}" autocomplete="off">
        <span class="label">Situation</span>
        <div class="chips" data-chips="situation">
          ${SITUATIONS.map(([k, t]) => `<button type="button" class="chip${L.situation === k ? ' on' : ''}" data-v="${k}">${esc(t)}</button>`).join('')}
        </div>
        <span class="label">Timescale</span>
        <div class="chips" data-chips="timescale">
          ${TIMESCALES.map((t) => `<button type="button" class="chip${L.timescale === t ? ' on' : ''}" data-v="${esc(t)}">${esc(t)}</button>`).join('')}
        </div>
      </div>

      <label for="f-notes" id="notes-label">${L.outcome === 'other' ? 'What happened?' : 'Notes'}</label>
      <textarea id="f-notes" data-f="notes" placeholder="${L.outcome === 'other' ? 'e.g. builders in, owner abroad, do not call…' : ''}">${esc(L.notes)}</textarea>

      <button type="button" class="hot-toggle${L.hot_lead ? ' on' : ''}" id="hot" aria-pressed="${L.hot_lead}">${L.hot_lead ? '🔥 HOT LEAD' : 'Mark as hot lead'}</button>
      <label for="f-fu">Follow-up date (optional)</label>
      <input type="date" id="f-fu" data-f="follow_up_date" value="${esc(L.follow_up_date)}">

      <div class="section">
        <span class="label">Neighbours leafleted</span>
        <div class="counter">
          <button type="button" id="nb-minus" aria-label="One fewer">−</button>
          <output id="nb-count">${L.nb_count || 0}</output>
          <button type="button" id="nb-plus" aria-label="One more">+</button>
        </div>
        <label for="f-nbn">House numbers (optional)</label>
        <input type="text" id="f-nbn" data-f="nb_numbers" value="${esc(L.nb_numbers)}" placeholder="e.g. 10, 14, 16" inputmode="text">
      </div>
      <div class="saved" id="saved"></div>
    </div>
    <div class="bottombar">
      <button class="btn" id="prev" type="button" ${i === 0 ? 'disabled' : ''}>‹ Back</button>
      <button class="btn" id="list" type="button">Stops</button>
      <button class="btn pri" id="next" type="button">${isLast ? 'Finish ✓' : 'Next ›'}</button>
    </div>
  `;

  const touch = () => { L.logged_at = nowIso(); queueSave(); setStatus(`Run in progress · ${loggedCount(run)}/${total}`); };

  app.querySelectorAll('.outcome').forEach((b) => {
    b.onclick = () => {
      L.outcome = L.outcome === b.dataset.o ? '' : b.dataset.o;
      app.querySelectorAll('.outcome').forEach((x) => x.classList.toggle('on', x.dataset.o === L.outcome));
      $('#ans').hidden = L.outcome !== 'answered';
      $('#notes-label').textContent = L.outcome === 'other' ? 'What happened?' : 'Notes';
      $('#f-notes').placeholder = L.outcome === 'other' ? 'e.g. builders in, owner abroad, do not call…' : '';
      if (L.outcome === 'other') $('#f-notes').focus();
      touch();
      $('.progress > div').style.width = Math.round((loggedCount(run) / total) * 100) + '%';
      $('.stopline span').textContent = `${loggedCount(run)} logged`;
    };
  });
  app.querySelectorAll('[data-f]').forEach((el) => {
    el.addEventListener('input', () => { L[el.dataset.f] = el.value; touch(); });
  });
  app.querySelectorAll('[data-chips]').forEach((group) => {
    group.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const f = group.dataset.chips;
      L[f] = L[f] === chip.dataset.v ? '' : chip.dataset.v;
      group.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.v === L[f]));
      touch();
    });
  });
  $('#hot').onclick = () => {
    L.hot_lead = !L.hot_lead;
    $('#hot').classList.toggle('on', L.hot_lead);
    $('#hot').setAttribute('aria-pressed', L.hot_lead);
    $('#hot').textContent = L.hot_lead ? '🔥 HOT LEAD' : 'Mark as hot lead';
    touch();
  };
  const setNb = (n) => { L.nb_count = Math.max(0, n); $('#nb-count').textContent = L.nb_count; touch(); };
  $('#nb-minus').onclick = () => setNb((L.nb_count || 0) - 1);
  $('#nb-plus').onclick = () => setNb((L.nb_count || 0) + 1);

  $('#prev').onclick = () => step(-1);
  $('#next').onclick = () => step(1);
  $('#list').onclick = openStopsSheet;
  bindSwipe($('#card'));
}

function step(dir) {
  const run = S.run;
  const next = run.idx + dir;
  if (next < 0) return;
  if (next >= run.stops.length) {
    saveRun();
    S.viewRun = run;
    return go('summary');
  }
  const card = $('#card');
  run.idx = next;
  saveRun();
  if (card) {
    card.style.transform = `translateX(${dir > 0 ? '' : '-'}40%)`;
    card.style.opacity = '0';
    setTimeout(() => { renderDoor(); window.scrollTo(0, 0); }, 150);
  } else renderDoor();
}

// Swipe right = next door, swipe left = back.
function bindSwipe(card) {
  let x0 = 0, y0 = 0, dx = 0, axis = null, active = false;
  card.addEventListener('touchstart', (e) => {
    if (e.target.closest('input, textarea, select')) { active = false; return; }
    const t = e.touches[0];
    x0 = t.clientX; y0 = t.clientY; dx = 0; axis = null; active = true;
  }, { passive: true });
  card.addEventListener('touchmove', (e) => {
    if (!active) return;
    const t = e.touches[0];
    const mx = t.clientX - x0, my = t.clientY - y0;
    if (!axis && (Math.abs(mx) > 12 || Math.abs(my) > 12)) axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    if (axis === 'x') {
      dx = mx;
      card.classList.add('swiping');
      card.style.transform = `translateX(${dx * 0.6}px)`;
    }
  }, { passive: true });
  const end = () => {
    if (!active) return;
    active = false;
    card.classList.remove('swiping');
    if (axis === 'x' && Math.abs(dx) > 80) {
      if (dx > 0) step(1);
      else if (S.run.idx > 0) step(-1);
      else card.style.transform = '';
    } else card.style.transform = '';
  };
  card.addEventListener('touchend', end);
  card.addEventListener('touchcancel', end);
}

function openStopsSheet() {
  const run = S.run;
  const wrap = document.createElement('div');
  wrap.className = 'sheet-backdrop';
  wrap.id = 'sheet';
  wrap.innerHTML = `
    <div class="sheet" role="dialog" aria-label="All stops">
      <div class="row" style="margin-bottom:12px"><h3 style="margin:0">All stops</h3><button class="btn small" id="sheet-close" type="button" style="flex:none">Close</button></div>
      ${run.stops.map((s, i) => {
        const o = OUTCOMES.find((x) => x.k === s.log.outcome);
        return `<button class="jump${i === run.idx ? ' cur' : ''}" data-i="${i}" type="button">
          <span class="num" style="margin:0">${i + 1}</span><span>${esc(s.address)}</span>
          <span class="st">${s.log.hot_lead ? '🔥 ' : ''}${o ? '✓ ' + esc(o.short) : ''}</span></button>`;
      }).join('')}
      <h3 style="margin-top:16px">Google Maps</h3>
      ${legsHtml(run)}
      <div class="stack"><button class="btn pri" id="sheet-end" type="button">End run &amp; see summary</button></div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.id === 'sheet-close') return closeSheet();
    if (e.target.id === 'sheet-end') { closeSheet(); saveRun(); S.viewRun = run; return go('summary'); }
    const j = e.target.closest('.jump');
    if (j) { run.idx = +j.dataset.i; saveRun(); closeSheet(); renderDoor(); window.scrollTo(0, 0); }
  });
}
function closeSheet() { const s = $('#sheet'); if (s) s.remove(); }

/* ---------------- Summary ---------------- */
function stats(run) {
  const by = (k) => run.stops.filter((s) => s.log.outcome === k).length;
  const nb = run.stops.reduce((n, s) => n + (parseInt(s.log.nb_count, 10) || 0), 0);
  const leafletedDoors = by('no_answer_leaflet');
  return {
    total: run.stops.length,
    logged: loggedCount(run),
    answered: by('answered'),
    leafleted: leafletedDoors,
    ncc: by('no_cold_callers'),
    other: by('other'),
    neighbours: nb,
    leaflets: leafletedDoors + nb,
    hot: run.stops.filter((s) => s.log.hot_lead)
  };
}

async function renderSummary() {
  const run = S.viewRun || S.run;
  if (!run) return go('history', false);
  const st = stats(run);
  const isCurrent = S.run && S.run.id === run.id;
  const followUps = run.stops.filter((s) => s.log.follow_up_date && !s.log.hot_lead);
  const leadHtml = (s) => `
    <div class="lead">
      <b>${esc(s.log.contact_name || 'No name')}</b> · ${esc(s.address)}, ${esc(s.postcode)}<br>
      ${s.log.contact_phone ? `<a href="tel:${esc(s.log.contact_phone.replace(/\s+/g, ''))}">${esc(s.log.contact_phone)}</a><br>` : ''}
      ${s.log.situation ? esc((SITUATIONS.find((x) => x[0] === s.log.situation) || [, ''])[1]) : ''}${s.log.timescale ? ' · ' + esc(s.log.timescale) : ''}
      ${s.log.follow_up_date ? `<br>Follow up: <b>${esc(prettyDate(s.log.follow_up_date))}</b>` : ''}
      ${s.log.notes ? `<br><small>${esc(s.log.notes)}</small>` : ''}
    </div>`;
  app.innerHTML = `
    <h2>Run summary ${run.status === 'done' ? '<span class="badge">Finished</span>' : '<span class="badge live">Open</span>'}</h2>
    <p class="meta">${esc(prettyDate(run.run_date))} · ${esc(run.id)}</p>
    <div class="stats">
      <div class="stat"><b>${st.logged}/${st.total}</b><span>Doors logged</span></div>
      <div class="stat"><b>${st.answered}</b><span>Answered</span></div>
      <div class="stat"><b>${st.leaflets}</b><span>Leaflets (${st.leafleted} door${st.leafleted === 1 ? '' : 's'} + ${st.neighbours} neighbour${st.neighbours === 1 ? '' : 's'})</span></div>
      <div class="stat hot"><b>${st.hot.length}</b><span>Hot leads</span></div>
      <div class="stat"><b>${st.ncc}</b><span>No cold callers</span></div>
      <div class="stat"><b>${st.other}</b><span>Other</span></div>
    </div>
    ${st.hot.length ? `<h3>Hot leads</h3>${st.hot.map(leadHtml).join('')}` : ''}
    ${followUps.length ? `<h3>Follow-ups</h3>${followUps.map(leadHtml).join('')}` : ''}
    <div class="stack">
      <button class="btn pri big" id="share" type="button">Share CSV</button>
      <button class="btn" id="dl" type="button">Download CSV</button>
      ${run.status !== 'done' ? `<button class="btn" id="back-doors" type="button">Back to the doors</button>
        <button class="btn" id="finish" type="button">Finish run</button>` : `<button class="btn" id="reopen" type="button">Reopen run</button>`}
      <button class="btn small danger" id="del" type="button">Delete this run</button>
    </div>
  `;
  const name = `doorknock_${run.id}.csv`;
  $('#share').onclick = () => exportCsv([run], name, 'share');
  $('#dl').onclick = () => exportCsv([run], name, 'download');
  const openRun = async () => {
    run.status = 'active';
    S.run = run;
    await saveRun(run);
    await DB.put('kv', run.id, 'currentRunId');
    go('door');
  };
  if ($('#back-doors')) $('#back-doors').onclick = openRun;
  if ($('#reopen')) $('#reopen').onclick = openRun;
  if ($('#finish')) $('#finish').onclick = async () => {
    run.status = 'done';
    run.finished = Date.now();
    await saveRun(run);
    if (isCurrent) { S.run = null; await DB.del('kv', 'currentRunId'); }
    renderSummary();
    toast('Run finished. Remember to share the CSV.');
  };
  $('#del').onclick = async () => {
    if (!confirm(`Delete the run from ${prettyDate(run.run_date)} (${run.stops.length} stops)? This can't be undone. Export the CSV first if you need it.`)) return;
    await DB.del('runs', run.id);
    if (S.run && S.run.id === run.id) { S.run = null; await DB.del('kv', 'currentRunId'); }
    S.viewRun = null;
    go('history');
  };
}

/* ---------------- Past runs ---------------- */
async function renderHistory() {
  const runs = (await DB.all('runs')).sort((a, b) => b.created - a.created);
  app.innerHTML = `
    <h2>Runs</h2>
    ${runs.length ? '' : '<p class="meta">No runs yet.</p>'}
    ${runs.map((r) => {
      const st = stats(r);
      const badge = r.status === 'done' ? '' : `<span class="badge live">${r.status === 'planning' ? 'Planning' : 'In progress'}</span>`;
      return `<button class="runcard" data-id="${esc(r.id)}" type="button"><b>${esc(prettyDate(r.run_date))}</b>${badge}
        <small>${st.total} stops · ${st.answered} answered · ${st.leaflets} leaflets · ${st.hot.length} hot</small></button>`;
    }).join('')}
    ${runs.length ? `<div class="stack"><button class="btn" id="all" type="button">Share CSV of all runs</button></div>` : ''}
    <div class="stack"><button class="btn pri" id="new" type="button">Plan a new run</button></div>
  `;
  app.querySelectorAll('.runcard').forEach((b) => {
    b.onclick = () => {
      const r = runs.find((x) => x.id === b.dataset.id);
      if (r.status === 'planning') { S.run = r; DB.put('kv', r.id, 'currentRunId'); return go('review'); }
      S.viewRun = S.run && S.run.id === r.id ? S.run : r;
      go('summary');
    };
  });
  if ($('#all')) $('#all').onclick = () => exportCsv(runs.slice().reverse(), `doorknock_all_${localDate()}.csv`, 'share');
  $('#new').onclick = () => go('setup');
}

/* ---------------- Settings ---------------- */
async function renderSettings() {
  const st = S.settings;
  let persisted = null;
  try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (e) { /* ignore */ }
  const host = location.hostname ? `${location.protocol}//${location.host}/*` : 'https://YOUR-NAME.github.io/*';
  app.innerHTML = `
    <h2>Settings</h2>
    <label for="s-key">Google Maps API key</label>
    <div class="row"><input type="password" id="s-key" value="${esc(st.apiKey)}" autocomplete="off" spellcheck="false" style="flex:3">
      <button class="btn small" id="s-show" type="button" style="flex:none">Show</button></div>
    <label for="s-start">Default start point</label>
    <input type="text" id="s-start" value="${esc(st.start)}">
    <label for="s-end">Default end point</label>
    <input type="text" id="s-end" value="${esc(st.end)}">
    <label for="s-chunk">Stops per Google Maps link</label>
    <input type="number" id="s-chunk" min="1" max="9" value="${esc(st.chunk)}">
    <div class="hint">The Google Maps app takes up to 9 stops in one link. Longer routes are split into parts.</div>
    <div class="stack">
      <button class="btn pri big" id="s-save" type="button">Save settings</button>
      <button class="btn" id="s-test" type="button">Test my key</button>
    </div>
    <div id="s-result" class="notice info" hidden></div>
    <p class="hint" style="margin-top:16px">Storage: ${persisted === true ? 'protected ✓ (Android won’t clear it)' : persisted === false ? 'not yet protected. Install the app to your home screen to protect it.' : 'unknown'}</p>

    <details>
      <summary>How to get and lock down your API key</summary>
      <ol>
        <li>On a computer, go to <b>console.cloud.google.com</b> and sign in. Create a project (e.g. “Door Knock”). Google asks you to add a billing card. The free monthly credit covers normal door-knocking use; you can set a budget alert under Billing → Budgets.</li>
        <li>Go to <b>APIs &amp; Services → Library</b> and enable these three: <b>Maps JavaScript API</b>, <b>Geocoding API</b>, <b>Routes API</b>.</li>
        <li>Go to <b>APIs &amp; Services → Credentials → Create credentials → API key</b>. Copy the key.</li>
        <li>Click the key to edit it. Under <b>Application restrictions</b> choose <b>Websites</b> and add <code>${esc(host)}</code></li>
        <li>Under <b>API restrictions</b> choose <b>Restrict key</b> and tick only the three APIs above. Save. It can take 5 minutes to start working.</li>
        <li>Paste the key above, tap Save, then <b>Test my key</b>.</li>
      </ol>
    </details>
    <details>
      <summary>Install on your phone &amp; share into the app</summary>
      <ol>
        <li>Open this site in Chrome on your phone, tap ⋮ → <b>Add to Home screen</b> → <b>Install</b>.</li>
        <li>Once installed, “Door Knock” appears in Android’s share menu. Share a CSV file or some text with addresses and they’re added to the address box.</li>
        <li>Plan the route while you have signal. After that the run works with no signal at all.</li>
      </ol>
    </details>
  `;
  $('#s-show').onclick = () => {
    const k = $('#s-key');
    k.type = k.type === 'password' ? 'text' : 'password';
    $('#s-show').textContent = k.type === 'password' ? 'Show' : 'Hide';
  };
  const read = () => ({
    apiKey: $('#s-key').value.trim(),
    start: $('#s-start').value.trim() || DEFAULT_SETTINGS.start,
    end: $('#s-end').value.trim() || DEFAULT_SETTINGS.end,
    chunk: Math.max(1, Math.min(9, parseInt($('#s-chunk').value, 10) || 9))
  });
  $('#s-save').onclick = async () => {
    const before = S.settings.apiKey;
    S.settings = read();
    await DB.put('kv', S.settings, 'settings');
    if (before && before !== S.settings.apiKey && mapsPromise) {
      toast('Saved. Restarting to use the new key…');
      setTimeout(() => location.reload(), 900);
    } else toast('Settings saved');
  };
  $('#s-test').onclick = async () => {
    const out = $('#s-result');
    const say = (cls, t) => { out.hidden = false; out.className = 'notice ' + cls; out.textContent = t; };
    S.settings = read();
    await DB.put('kv', S.settings, 'settings');
    say('info', 'Testing…');
    // Check each Google service separately, quoting Google's own error text.
    const lines = [];
    let ok = true;
    try {
      await DB.del('kv', 'g:' + (S.settings.start + ', UK').toLowerCase().replace(/\s+/g, ' '));
      const g = await geocode(S.settings.start + ', UK', '');
      if (g.geo === 'fail') throw new Error(g.note);
      lines.push('✓ Address lookup (Maps JavaScript + Geocoding) works');
    } catch (e) {
      ok = false;
      lines.push('✗ Address lookup: ' + e.message);
    }
    if (S.mapsAuthFailed) {
      ok = false;
      lines.push('✗ Google rejected the key when loading Maps JavaScript API (wrong key, website restriction, or billing).');
    }
    try {
      await computeRoutes({ origin: { address: S.settings.start + ', UK' }, destination: { address: S.settings.end + ', UK' }, travelMode: 'DRIVE' });
      lines.push('✓ Route planning (Routes API) works');
    } catch (e) {
      ok = false;
      lines.push('✗ ' + e.message);
    }
    say(ok ? 'info' : 'bad', lines.join('\n'));
    out.style.whiteSpace = 'pre-line';
  };
}

/* ---------------- Share target pickup ---------------- */
async function takeShare() {
  if (!new URLSearchParams(location.search).has('share')) return false;
  history.replaceState(null, '', location.pathname);
  const sh = await DB.get('kv', 'pendingShare');
  if (!sh) return false;
  await DB.del('kv', 'pendingShare');
  const lines = [];
  for (const f of sh.files || []) lines.push(...csvToLines(f.text));
  const text = [sh.title, sh.text].filter(Boolean).join('\n');
  if (text.trim()) {
    const looksCsv = /(^|\n)\s*"?(address|first_line|postcode)"?\s*,/i.test(text);
    lines.push(...(looksCsv ? csvToLines(text) : sharedTextToLines(text)));
  }
  S.view = 'setup';
  history.replaceState({ view: 'setup' }, '');
  await addLinesToDraft(lines, `Added ${lines.length} address${lines.length === 1 ? '' : 'es'} from share`);
  return true;
}

/* ---------------- Start-up ---------------- */
async function init() {
  try {
    S.settings = { ...DEFAULT_SETTINGS, ...((await DB.get('kv', 'settings')) || {}) };
    const curId = await DB.get('kv', 'currentRunId');
    if (curId) S.run = (await DB.get('runs', curId)) || null;
  } catch (e) {
    app.innerHTML = `<div class="notice bad">This phone's storage isn't available (${esc(e.message)}). Private/incognito tabs can't save runs.</div>`;
    return;
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if (await takeShare()) return;
  S.view = !S.settings.apiKey && !S.run ? 'settings'
    : S.run && S.run.status === 'active' ? 'door'
    : S.run && S.run.status === 'planning' ? 'review'
    : 'setup';
  history.replaceState({ view: S.view }, '');
  render();
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.addEventListener('online', () => { if (S.view !== 'door') setStatus(''); });
window.addEventListener('offline', () => toast('No signal. Your doors still save on the phone.'));
init();
