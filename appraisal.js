'use strict';
/* ============================================================
   Market appraisal tab: an evidence pack at the door. (Estate agents give market appraisals, not valuations.)
   Reads the "area pack" built on Hal's PC (home-reports/appraisal-pack/build-pack.js):
   Land Registry sales (also adjusted to today with the UK HPI), EPC sizes and ratings,
   postcode points and Sprift's on-market rows. Everything is worked out here, on the phone,
   so it works with no signal. Loaded before app.js; uses its helpers ($, esc, DB, S, toast, go).
   ============================================================ */

const VAL = { pack: null, homes: null, home: null, query: '', adds: [], whole: '', unit: 'm2', shareTicks: null };
const SQ_M = 10.764;
const YEAR_MS = 365.25 * 86400000;
// What extra space is worth compared with a proper, signed-off extension (Hal can change these).
// Starting points for what each kind of addition is worth, as a share of a signed-off extension's
// rate per sq ft. The lister can override any figure before it goes in the draft.
const SPACE_KINDS = [
  { k: 'ext1', label: 'Single-storey extension', f: 1 },
  { k: 'ext2', label: 'Two-storey extension (both floors)', f: 1, note: 'If it adds a bedroom, buyers may pay more: use Change amount.' },
  { k: 'loft', label: 'Loft conversion, signed off', f: 0.9 },
  { k: 'orangery', label: 'Orangery (solid roof, heated)', f: 0.75 },
  { k: 'garage', label: 'Garage conversion, signed off', f: 0.7 },
  { k: 'cons', label: 'Conservatory (glass or plastic roof)', f: 0.5 },
  { k: 'nosign', label: 'Loft or garage conversion, no sign-off', f: 0.4 },
  { k: 'outb', label: 'Garden room or outbuilding', f: 0.3 }
];
const AGE_BANDS = { A: 'before 1900', B: '1900–1929', C: '1930–1949', D: '1950–1966', E: '1967–1975', F: '1976–1982', G: '1983–1990', H: '1991–1995', I: '1996–2002', J: '2003–2006', K: '2007–2011', L: '2012–2021', M: '2022 or later' };
const TYPE_WORD = { detached: 'detached', semi: 'semi-detached', terraced: 'terraced', flat: 'flat or maisonette', other: 'other' };

const gbp0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const money0 = (n) => (n == null || !isFinite(n) ? '–' : gbp0.format(n));
const k5 = (n) => Math.round(n / 5000) * 5000;
const num0 = (n) => Math.round(n).toLocaleString('en-GB');
const monthYear = (iso) => { if (!iso) return ''; const d = new Date(iso.slice(0, 10) + 'T12:00:00'); return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }); };
const ageWord = (a) => { if (!a) return ''; const s = String(a); return AGE_BANDS[s.toUpperCase()] || s.replace(/^England and Wales:\s*/i, ''); };
const quant = (arr, q) => { const a = [...arr].sort((x, y) => x - y); if (!a.length) return null; const i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); };
function km(a, b) {
  if (!a || !b) return null;
  const R = 6371, dLat = (b[0] - a[0]) * Math.PI / 180, dLng = (b[1] - a[1]) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const miles = (k) => (k == null ? '' : k < 0.16 ? 'next door to ¼ mile' : (k / 1.609).toFixed(1) + ' mi');
const isHouse = (t) => t && t !== 'flat';
const sameKind = (a, b) => (a && b ? a === b : true);
// Drop wild £/sq ft figures (wrong EPC size, a plot sale) before quoting anything.
function trimOutliers(vals) {
  if (vals.length < 4) return vals;
  const q1 = quant(vals, 0.25), q3 = quant(vals, 0.75), iqr = q3 - q1;
  return vals.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
}

/* ---------------- Loading the area pack ---------------- */
async function loadPack() {
  if (VAL.pack) return VAL.pack;
  const p = await DB.get('kv', 'areaPack');
  if (p) setPack(p);
  return VAL.pack;
}
function setPack(p) {
  VAL.pack = p;
  VAL.homes = p.homes.map((h, i) => ({ ...h, i, key: (h.a + ' ' + h.pc + ' ' + (h.pc || '').replace(/\s/g, '')).toLowerCase() }));
  VAL.home = null;
}
function looksLikePack(text) { return /^\s*\{\s*"griffinPack"/.test(text || ''); }
async function savePackText(text) {
  let p;
  try { p = JSON.parse(text); } catch (e) { toast('That file isn\'t an area pack'); return false; }
  if (!p || !p.griffinPack || !Array.isArray(p.homes)) { toast('That file isn\'t an area pack'); return false; }
  await DB.put('kv', p, 'areaPack');
  setPack(p);
  toast(`Area pack loaded: ${num0(p.homes.length)} homes, built ${prettyDate(p.built)}`, null, 6000);
  return true;
}
function packAgeDays(p) { return Math.floor((Date.now() - new Date(p.built).getTime()) / 86400000); }

/* ---------------- Finding a home ---------------- */
function searchHomes(q) {
  const t = q.toLowerCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (!t.length) return [];
  const numTok = /^\d+[a-z]?$/.test(t[0]) ? t[0] : null;
  const out = [];
  for (const h of VAL.homes) {
    if (!t.every((w) => h.key.includes(w))) continue;
    if (numTok && !new RegExp(`(^|[ ,])${numTok}\\b`).test(h.a.toLowerCase())) continue;
    out.push(h);
    if (out.length > 40) break;
  }
  return out.sort((a, b) => a.a.localeCompare(b.a, 'en', { numeric: true })).slice(0, 25);
}

/* ---------------- The evidence ---------------- */
function recentSales(years) {
  const since = new Date(new Date(VAL.pack.built).getTime() - years * YEAR_MS).toISOString().slice(0, 10);
  const out = [];
  for (const h of VAL.homes) for (const s of h.s || []) if (s[0] >= since) out.push({ h, date: s[0], price: s[1], adj: s[2] || s[1], nb: !!s[3] });
  return out;
}
function lastSale(h) { const s = h.s && h.s[h.s.length - 1]; return s ? { date: s[0], price: s[1], adj: s[2], nb: !!s[3] } : null; }
const ppsf = (x) => (x.h.sq ? x.adj / x.h.sq : null);

function comparables(sub) {
  const here = VAL.pack.pts[sub.pc];
  const built = new Date(VAL.pack.built).getTime();
  const cands = [];
  for (const x of recentSales(5)) {
    const h = x.h;
    if (h === sub || !h.sq) continue;
    if (sub.t ? h.t !== sub.t : !isHouse(h.t)) continue;
    const d = km(here, VAL.pack.pts[h.pc]);
    if (d == null || d > 2.4) continue;
    const sameSt = sub.st && h.st === sub.st;
    const sizeDiff = sub.sq ? (h.sq - sub.sq) / sub.sq : 0;
    const yrs = (built - new Date(x.date).getTime()) / YEAR_MS;
    const score = (sameSt ? 3 : 0) - 2 * d - 5 * Math.abs(sizeDiff) - 0.5 * yrs + (sub.ag && h.ag === sub.ag ? 0.5 : 0) - (x.nb ? 1 : 0);
    const why = [];
    if (sameSt) why.push('same street'); else why.push(miles(d));
    if (sub.sq) why.push(Math.abs(sizeDiff) < 0.05 ? 'same size' : `${sizeDiff > 0 ? '+' : ''}${Math.round(sizeDiff * 100)}% size`);
    why.push(yrs < 1 ? `${Math.max(1, Math.round(yrs * 12))} months ago` : `${yrs.toFixed(1)} years ago`);
    if (sub.ag && h.ag === sub.ag) why.push('same era');
    if (x.nb) why.push('new build');
    cands.push({ ...x, d, score, why });
  }
  // One sale per home (its latest), best first.
  const seen = new Set();
  return cands.sort((a, b) => b.score - a.score).filter((c) => (seen.has(c.h) ? false : seen.add(c.h))).slice(0, 6);
}

function streetFigure(sub) {
  if (!sub.st) return null;
  const pick = (years) => recentSales(years).filter((x) => x.h.st === sub.st && x.h.pc.slice(0, 4) === sub.pc.slice(0, 4) && x.h.sq && (isHouse(sub.t) ? isHouse(x.h.t) : x.h.t === 'flat'));
  let years = 5, rows = pick(5);
  if (rows.length < 5) { years = 10; rows = pick(10); }
  const vals = trimOutliers(rows.map(ppsf));
  const all = recentSales(10).filter((x) => x.h.st === sub.st && x.h.pc.slice(0, 4) === sub.pc.slice(0, 4) && sameKind(isHouse(x.h.t), isHouse(sub.t)));
  const ceiling = all.length ? all.reduce((m, x) => (x.adj > m.adj ? x : m)) : null;
  return { years, n: vals.length, med: quant(vals, 0.5), lo: quant(vals, 0.25), hi: quant(vals, 0.75), ok: vals.length >= 5, ceiling, dropped: rows.length - vals.length };
}

// Similar homes within ~½ mile (used when the street has too few sales).
function nearbyFigure(sub) {
  const here = VAL.pack.pts[sub.pc];
  const rows = recentSales(5).filter((x) => x.h.sq && (sub.t ? x.h.t === sub.t : isHouse(x.h.t)) && (km(here, VAL.pack.pts[x.h.pc]) ?? 99) <= 0.8);
  const vals = trimOutliers(rows.map(ppsf));
  return { n: vals.length, med: quant(vals, 0.5), lo: quant(vals, 0.25), hi: quant(vals, 0.75) };
}

// What each EXTRA sq ft is worth here. Across similar homes nearby, price rises with size by a power
// (beta): 1.0 would mean extra space is worth the full average £/sq ft. SS17 data (Nov 2026) gives about
// 0.35-0.45 for semis and terraces and 0.5-0.7 for detached; wrong EPC sizes drag that down, so it's kept
// between 0.5 and 0.9 and applied to the LOCAL £/sq ft (the street's, else the comparables').
function extraSpaceRate(sub, local) {
  const here = VAL.pack.pts[sub.pc];
  let rows = recentSales(5).filter((x) => x.h.sq && (sub.t ? x.h.t === sub.t : isHouse(x.h.t)) && (km(here, VAL.pack.pts[x.h.pc]) ?? 99) <= 1.2);
  if (!local) return { rate: null };
  const fit = (r) => {
    const L = r.map((x) => [Math.log(x.h.sq), Math.log(x.adj)]), n = L.length;
    const mx = L.reduce((t, v) => t + v[0], 0) / n, my = L.reduce((t, v) => t + v[1], 0) / n;
    let sxy = 0, sxx = 0; for (const v of L) { sxy += (v[0] - mx) * (v[1] - my); sxx += (v[0] - mx) ** 2; }
    const b = sxx ? sxy / sxx : 0; return { b, a: my - b * mx };
  };
  let beta = 0.6, rule = true;
  if (rows.length >= 20) {
    let f = fit(rows);
    const res = rows.map((x) => Math.abs(Math.log(x.adj) - (f.a + f.b * Math.log(x.h.sq))));
    const cut = quant(res, 0.9);
    rows = rows.filter((x, i) => res[i] <= cut);
    f = fit(rows);
    beta = f.b; rule = false;
  }
  const used = Math.min(0.9, Math.max(0.5, beta));
  return { rate: used * local, local, beta, used, n: rows.length, rule };
}

function evidenceRange(sub, comps) {
  if (sub.sq && comps.length >= 3) {
    const v = comps.map(ppsf);
    return { lo: k5(sub.sq * quant(v, 0.25)), hi: k5(sub.sq * quant(v, 0.75)), basis: `${sub.sq.toLocaleString('en-GB')} sq ft × £${Math.round(quant(v, 0.25))}–£${Math.round(quant(v, 0.75))} per sq ft from the comparable sales` };
  }
  if (comps.length >= 3) {
    const v = comps.map((c) => c.adj);
    return { lo: k5(quant(v, 0.25)), hi: k5(quant(v, 0.75)), basis: 'comparable sales in today\'s money (no floor area on the EPC register for this home)' };
  }
  return null;
}

function marketNow(sub) {
  const rows = VAL.pack.market || [];
  if (!rows.length) return { rows: [], own: null };
  const here = VAL.pack.pts[sub.pc];
  const keyNum = (a) => (/^(\d+[a-z]?)\b/i.exec(a) || [])[1];
  const own = rows.find((r) => r.pc === sub.pc && keyNum(r.a) && keyNum(r.a) === keyNum(sub.a)) || null;
  const pts = VAL.pack.pts;
  const TYPE_RE = { flat: /flat|maisonette|apartment/i, terraced: /terrace/i, semi: /semi/i, detached: /^detached|bungalow/i };
  const kindOf = (t) => (TYPE_RE.flat.test(t) ? 'flat' : 'house');
  const wantType = (r) => !sub.t || kindOf(r.type || '') === (sub.t === 'flat' ? 'flat' : 'house');
  const exact = (r) => sub.t && TYPE_RE[sub.t] && TYPE_RE[sub.t].test(r.type || '');
  const live = rows.filter((r) => r !== own && !r.withdrawn && !r.fell && r.price && wantType(r));
  const scored = live.map((r) => ({ r, d: km(here, pts[r.pc]) ?? 99, same: sub.st && r.a.toLowerCase().includes(sub.st.toLowerCase()) }))
    .filter((x) => x.same || x.d <= 0.8).sort((a, b) => (b.same - a.same) || (exact(b.r) - exact(a.r)) || a.d - b.d).slice(0, 6);
  return { rows: scored, own };
}
const weeksOn = (iso) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso + 'T12:00:00').getTime()) / (7 * 86400000))) : null);

/* ---------------- Sections (screen + WhatsApp text) ---------------- */
function buildSections(sub) {
  const P = VAL.pack;
  const secs = [];
  const tw = TYPE_WORD[sub.t] || (sub.dw ? sub.dw.toLowerCase() : 'home');
  const last = lastSale(sub);

  // 1. The home
  {
    const bits = [];
    if (sub.dw || sub.t) bits.push(sub.dw || TYPE_WORD[sub.t]);
    if (sub.sq) bits.push(`${sub.sq.toLocaleString('en-GB')} sq ft (${Math.round(sub.m2)} m²) on its EPC (${monthYear(sub.d)})`);
    if (sub.b) bits.push(`energy rating ${sub.b}${sub.p && sub.p !== sub.b ? `, could reach ${sub.p}` : ''}`);
    if (sub.ag) bits.push(`built ${ageWord(sub.ag)}`);
    if (sub.ex) bits.push(`${sub.ex} extension${sub.ex > 1 ? 's' : ''} recorded`);
    if (bits.length) bits[0] = bits[0].charAt(0).toUpperCase() + bits[0].slice(1);
    const html = bits.length ? `<p>${bits.map(esc).join(' · ')}</p>${!sub.sq ? '<p class="hint">No floor area on the EPC register. Measure it to get a £ per sq ft figure.</p>' : sub.d && sub.d < '2015' ? '<p class="hint">The EPC is over 10 years old, so check for extensions since.</p>' : ''}` : '<p class="hint">Nothing on the EPC register for this home.</p>';
    secs.push({ id: 'home', title: 'Your home', html, text: bits.length ? bits.join(' · ') : '', on: true });
  }

  // 2. Its history
  if (sub.s && sub.s.length) {
    const rows = sub.s.map((s) => `${monthYear(s[0])}: ${money0(s[1])}${s[3] ? ' (new build)' : ''}`);
    const story = last && last.adj && last.date < P.hpiLatest ? `Bought ${monthYear(last.date)} for ${money0(last.price)}. ${TYPE_WORD[sub.t] ? 'Local ' + TYPE_WORD[sub.t] : 'Local'} prices have moved since, which on their own would put it around ${money0(last.adj)} today (UK House Price Index, Thurrock).` : '';
    secs.push({ id: 'history', title: 'Sale history', html: `<ul class="val-list">${rows.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>${story ? `<p>${esc(story)}</p>` : ''}`, text: rows.join('\n') + (story ? '\n' + story : ''), on: false });
  }

  // 3. Comparables
  const comps = comparables(sub);
  if (comps.length) {
    const html = `<ul class="val-list comps">${comps.map((c) => `<li><b>${esc(c.h.a)}</b> <small>${esc(c.h.pc)}</small><br>
      Sold ${esc(monthYear(c.date))} for ${money0(c.price)}${c.adj !== c.price ? ` · today ≈ ${money0(c.adj)}` : ''}<br>
      <small>${num0(c.h.sq)} sq ft · £${Math.round(ppsf(c))}/sq ft · ${esc(c.why.join(' · '))}</small></li>`).join('')}</ul>
      <p class="hint">"Today" adds the local price change since each sale (UK House Price Index).</p>`;
    const text = comps.map((c) => `• ${c.h.a}: sold ${monthYear(c.date)} for ${money0(c.price)} (${num0(c.h.sq)} sq ft, £${Math.round(ppsf(c))} per sq ft in today's money)`).join('\n');
    secs.push({ id: 'comps', title: 'Similar homes sold', html, text, on: true });
  }

  // 4. £ per sq ft on the street
  const sf = streetFigure(sub);
  if (sf && sf.ok) {
    const line = `£${Math.round(sf.med)} per sq ft (£${num0(sf.med * SQ_M)} per m²). Middle half £${Math.round(sf.lo)}–£${Math.round(sf.hi)}, from ${sf.n} sales in the last ${sf.years} years, in today's money.`;
    secs.push({ id: 'street', title: `£ per sq ft on ${sub.st}`, html: `<p class="val-big">£${Math.round(sf.med)} <small>per sq ft</small></p><p>${esc(line)}</p>${sf.dropped ? `<p class="hint">${sf.dropped} odd sale${sf.dropped > 1 ? 's' : ''} left out (probably a wrong EPC size).</p>` : ''}`, text: `${sub.st}: ${line}`, on: true });
  } else {
    const nf = nearbyFigure(sub);
    const why = `Only ${sf ? sf.n : 0} sale${sf && sf.n === 1 ? '' : 's'} with a size on ${sub.st || 'this street'} in 10 years, too few to quote.`;
    if (nf.n >= 5) {
      const line = `£${Math.round(nf.med)} per sq ft (£${num0(nf.med * SQ_M)} per m²) for ${TYPE_WORD[sub.t] || 'similar'} homes within half a mile. Middle half £${Math.round(nf.lo)}–£${Math.round(nf.hi)}, from ${nf.n} sales in 5 years, in today's money.`;
      secs.push({ id: 'street', title: '£ per sq ft nearby', html: `<p class="val-big">£${Math.round(nf.med)} <small>per sq ft</small></p><p>${esc(line)}</p><p class="hint">${esc(why)}</p>`, text: line, on: true });
    } else secs.push({ id: 'street', title: '£ per sq ft', html: `<p class="hint">${esc(why)} Not enough similar sales nearby either.</p>`, text: '', on: false });
  }

  // 5. Evidence range
  const rng = evidenceRange(sub, comps);
  VAL.range = rng;
  if (rng) {
    const line = `${money0(rng.lo)} – ${money0(rng.hi)}`;
    secs.push({ id: 'range', title: 'What the evidence says', html: `<p class="val-big">${esc(line)}</p><p class="hint">${esc(rng.basis)}. A starting point before condition, layout, garden and parking.</p>${rng.hi > rng.lo * 1.2 ? '<div class="notice warn">Wide range: the sales here are mixed, so lean on your own judgement and the closest comparables.</div>' : ''}`, text: `Based on the evidence above: ${line}, before condition, layout, garden and parking.`, on: true });
  }

  // 6. Extra space the lister measured and agreed
  const ag = agreedItems();
  if (ag.length) {
    const tot = ag.reduce((t, x) => t + x.fig, 0);
    const lines = ag.map((x) => `${x.kind.label}: ${num0(x.sq)} sq ft (${(x.sq / SQ_M).toFixed(1)} m²) adds about ${money0(x.fig)}`);
    const withIt = rng ? `With it, the evidence points to ${money0(rng.lo + tot)} – ${money0(rng.hi + tot)}.` : '';
    secs.push({ id: 'space', title: 'Extra space measured', html: `<ul class="val-list">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>${withIt ? `<p><b>${esc(withIt)}</b></p>` : ''}`, text: lines.map((l) => '• ' + l).join('\n') + (withIt ? '\n' + withIt : ''), on: true });
  }

  // 7. On the market now (Sprift)
  const mk = marketNow(sub);
  if (mk.own || mk.rows.length) {
    const ownLine = mk.own ? `This home: on with ${mk.own.agent} at ${money0(mk.own.price)} since ${monthYear(mk.own.listed)}${mk.own.reduced ? ` (reduced ${money0(mk.own.reducedBy)} in ${monthYear(mk.own.reduced)})` : ''}${mk.own.withdrawn ? `, withdrawn ${monthYear(mk.own.withdrawn)}` : ''}.` : '';
    const lines = mk.rows.map(({ r }) => `${r.a}: ${money0(r.price)}${r.beds ? `, ${r.beds} bed` : ''} ${(r.type || '').toLowerCase()}, ${weeksOn(r.listed)} week${weeksOn(r.listed) === 1 ? '' : 's'} on${r.reduced ? `, reduced ${money0(r.reducedBy)}` : ''} (${r.agent})`);
    secs.push({ id: 'market', title: 'For sale nearby now', html: `${ownLine ? `<p><b>${esc(ownLine)}</b></p>` : ''}<ul class="val-list">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p class="hint">Sprift, ${esc(prettyDate(VAL.pack.spriftDate))}.</p>`, text: lines.map((l) => '• ' + l).join('\n'), on: false });
  }
  return { secs, comps, sf };
}

/* ---------------- Screen ---------------- */
async function renderValue() {
  const P = await loadPack();
  if (!P) {
    app.innerHTML = `<h2>Market appraisal</h2>
      <div class="notice info">Load your area pack first. Your PC makes a fresh one every week as <b>Griffin area pack.json</b> in the
      <b>Door Knock list</b> folder in OneDrive. Share it to the Griffin app, or tap below and pick it.</div>
      <div class="stack"><button class="btn pri" id="v-load" type="button">Load area pack</button></div>
      <input type="file" id="v-file" accept=".json,application/json,text/plain" hidden>`;
    wirePackLoad();
    return;
  }
  if (VAL.home) return renderValueHome();
  const age = packAgeDays(P);
  app.innerHTML = `<h2>Market appraisal</h2>
    <label for="v-q">House number and street, or postcode</label>
    <input type="text" id="v-q" autocomplete="off" enterkeyhint="search" placeholder="e.g. 42 Silvertown Avenue" value="${esc(VAL.query)}">
    <ul class="stops val-results" id="v-res"></ul>
    <p class="meta">${num0(P.homes.length)} homes · sales to ${esc(prettyDate(P.landRegistryLatest))}${P.spriftDate ? ` · Sprift ${esc(prettyDate(P.spriftDate))}` : ''} · pack built ${esc(prettyDate(P.built))}</p>
    ${age > 10 ? `<div class="notice warn">This pack is ${age} days old. Load this week's one from the Door Knock list folder.</div>` : ''}
    <div class="stack"><button class="btn small" id="v-load" type="button">Load a newer area pack</button></div>
    <input type="file" id="v-file" accept=".json,application/json,text/plain" hidden>`;
  wirePackLoad();
  const show = () => {
    VAL.query = $('#v-q').value;
    const res = searchHomes(VAL.query);
    $('#v-res').innerHTML = res.map((h) => `<li data-i="${h.i}"><div class="stop-body"><b>${esc(h.a)}</b><small>${esc(h.pc)}${h.sq ? ` · ${num0(h.sq)} sq ft` : ''}${h.s ? ` · last sold ${esc(monthYear(h.s[h.s.length - 1][0]))}` : ''}</small></div></li>`).join('')
      || (VAL.query.trim().length > 2 ? '<li><div class="stop-body"><small>No match. Try just the number and street, or the postcode.</small></div></li>' : '');
  };
  $('#v-q').addEventListener('input', show);
  $('#v-res').onclick = (e) => { const li = e.target.closest('li[data-i]'); if (li) { VAL.home = VAL.homes[+li.dataset.i]; VAL.adds = []; VAL.whole = ''; go('value'); } };
  show();
  if (!VAL.query) $('#v-q').focus();
}

function wirePackLoad() {
  $('#v-load').onclick = () => $('#v-file').click();
  $('#v-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (await savePackText(await f.text())) renderValue();
  };
}

function renderValueHome() {
  const sub = VAL.home;
  const { secs } = buildSections(sub);
  VAL.secs = secs;
  const loc = localRate(sub);
  const rate = extraSpaceRate(sub, loc && loc.v);
  VAL.rate = rate;
  const C = ceilingInfo(sub);
  const items = VAL.adds;
  const kindOpts = (sel) => SPACE_KINDS.map((k) => `<option value="${k.k}" ${sel === k.k ? 'selected' : ''}>${esc(k.label)} (${Math.round(k.f * 100)}%)</option>`).join('');
  const itemHtml = (it, n) => {
    const s = suggestFor(it);
    const fig = it.override != null ? it.override : s && s.added;
    const done = it.status === 'agreed';
    return `<div class="val-add${done ? ' agreed' : ''}" data-n="${n}">
      <div class="row"><select data-f="kind" aria-label="What is it?">${kindOpts(it.kind)}</select><button type="button" class="icon-btn" data-a="del" aria-label="Remove">✕</button></div>
      <div class="fee-input"><input type="text" data-f="size" inputmode="decimal" autocomplete="off" placeholder="${VAL.unit === 'm2' ? 'Size in m², e.g. 12.5' : 'Size in sq ft, e.g. 135'}" value="${esc(it.size)}"><span>${VAL.unit === 'm2' ? 'm²' : 'sq ft'}</span></div>
      ${s ? `<p class="val-sugg">${done ? '✓ In the draft: ' : 'Suggested: '}<b>+ ${money0(fig)}</b>${it.override != null ? ' <small>(your figure)</small>' : ''}<br><small>${esc(s.why)}</small></p>` : ''}
      ${s && !done && !it.editing ? `<div class="row"><button type="button" class="btn pri small" data-a="agree">Agree, add to draft</button><button type="button" class="btn small" data-a="change">Change amount</button></div>` : ''}
      ${s && it.editing ? `<div class="fee-row"><div class="fee-input"><span>£</span><input type="text" data-f="override" inputmode="numeric" autocomplete="off" placeholder="Your figure" value="${it.override != null ? esc(it.override.toLocaleString('en-GB')) : ''}"></div><button type="button" class="btn pri small" data-a="useown">Use my figure</button></div>` : ''}
      ${done ? `<div class="row"><button type="button" class="btn small" data-a="undo">Take out of draft</button><button type="button" class="btn small" data-a="change">Change amount</button></div>` : ''}
    </div>`;
  };
  const total = agreedTotal();
  const R = VAL.range;
  app.innerHTML = `
    <button class="btn small" id="v-back" type="button">← Search again</button>
    <h2>${esc(sub.a)}</h2>
    <p class="meta">${esc(sub.pc)}${sub.st ? ' · ' + esc(sub.st) : ''}</p>
    ${secs.map((s) => `<section class="val-sec" id="sec-${s.id}"><h3>${esc(s.title)}</h3>${s.html}</section>`).join('')}
    <section class="val-sec" id="sec-measure">
      <h3>Measure extra space</h3>
      ${rate.rate ? `<p class="hint">A signed-off extension here adds about <b>£${Math.round(rate.rate)} per sq ft (£${num0(rate.rate * SQ_M)} per m²)</b>: ${Math.round(rate.used * 100)}% of the £${Math.round(rate.local)} per sq ft ${esc(loc.w)}. The average also pays for the land, kitchen and location, so each extra sq ft is worth less. Other types count at the % shown. ${rate.rule ? 'Too few similar sales nearby to measure it, so this is a rule of thumb.' : `From ${rate.n} similar sales within ¾ mile${rate.beta < 0.5 ? ` the data says ${Math.round(rate.beta * 100)}%, but wrong EPC sizes pull that down, so it's kept at 50% or more` : ''}.`}</p>` : '<p class="hint">Not enough sales nearby to suggest a figure. Add your own amounts.</p>'}
      <div class="seg" role="group" aria-label="Units">
        <button type="button" id="v-u-m2" aria-pressed="${VAL.unit === 'm2'}">m²</button>
        <button type="button" id="v-u-ft" aria-pressed="${VAL.unit === 'ft'}">sq ft</button>
      </div>
      <label for="v-whole">Whole house measured (optional)</label>
      <div class="fee-input"><input type="text" id="v-whole" inputmode="decimal" autocomplete="off" placeholder="Total inside area" value="${esc(VAL.whole)}"><span>${VAL.unit === 'm2' ? 'm²' : 'sq ft'}</span></div>
      <p class="hint" id="v-whole-out"></p>
      <div id="v-adds">${items.map(itemHtml).join('')}</div>
      <div class="stack"><button class="btn" id="v-add" type="button">+ Add ${items.length ? 'another' : 'an'} extension, conservatory or conversion</button></div>
      ${total ? `<p class="val-big">+ ${money0(total)} <small>agreed</small></p>${R ? `<p>With it, the evidence points to <b>${money0(R.lo + total)} – ${money0(R.hi + total)}</b>.</p>` : ''}` : ''}
      ${ceilingHtml(C, R, total)}
    </section>
    <div class="stack"><button class="btn pri big" id="v-share" type="button">Share with the owner…</button></div>
    <p class="hint">${esc(VAL.pack.sources)}</p>`;
  $('#v-back').onclick = () => { VAL.home = null; go('value'); };
  const rerender = () => { const y = window.scrollY; renderValueHome(); window.scrollTo(0, y); };
  $('#v-u-m2').onclick = () => { VAL.unit = 'm2'; rerender(); };
  $('#v-u-ft').onclick = () => { VAL.unit = 'ft'; rerender(); };
  const wholeOut = () => {
    VAL.whole = $('#v-whole').value;
    const v = toSqft(VAL.whole);
    $('#v-whole-out').textContent = !v ? '' : !sub.sq ? 'No EPC size to compare with. Add the extra parts below.'
      : v > sub.sq ? `That's ${num0(v - sub.sq)} sq ft (${((v - sub.sq) / SQ_M).toFixed(1)} m²) more than the EPC's ${num0(sub.sq)} sq ft. Add it below as the right type.`
      : `That's no bigger than the EPC's ${num0(sub.sq)} sq ft.`;
  };
  $('#v-whole').addEventListener('input', wholeOut);
  wholeOut();
  $('#v-add').onclick = () => {
    VAL.adds.push({ kind: 'ext1', size: '', status: 'new', override: null });
    rerender();
    const all = document.querySelectorAll('.val-add input[data-f=size]');
    if (all.length) all[all.length - 1].focus();
  };
  const box = $('#v-adds');
  const itemOf = (el) => { const d = el.closest('.val-add'); return d ? { d, it: VAL.adds[+d.dataset.n] } : {}; };
  box.addEventListener('change', (e) => {
    const { it } = itemOf(e.target); if (!it) return;
    if (e.target.dataset.f === 'kind') { it.kind = e.target.value; it.status = 'new'; it.override = null; it.editing = false; rerender(); }
    if (e.target.dataset.f === 'size') { it.size = e.target.value; it.status = 'new'; rerender(); }
  });
  box.addEventListener('input', (e) => { const { it } = itemOf(e.target); if (it && e.target.dataset.f === 'size') it.size = e.target.value; });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.f === 'size') e.target.blur(); });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const { d, it } = itemOf(b); if (!it) return;
    const a = b.dataset.a;
    if (a === 'del') VAL.adds.splice(+d.dataset.n, 1);
    if (a === 'agree') { it.status = 'agreed'; it.editing = false; }
    if (a === 'change') { it.editing = true; it.status = 'new'; }
    if (a === 'undo') it.status = 'new';
    if (a === 'useown') {
      const v = parseInt(String(d.querySelector('input[data-f=override]').value).replace(/[^\d]/g, ''), 10);
      if (!(v >= 0)) { toast('Type the amount in £'); return; }
      it.override = v; it.status = 'agreed'; it.editing = false;
    }
    rerender();
  });
  $('#v-share').onclick = openValueShare;
}

const toSqft = (v) => { const n = parseFloat(String(v || '').replace(/[^\d.]/g, '')); return n > 0 ? (VAL.unit === 'm2' ? n * SQ_M : n) : null; };
function localRate(sub) {
  const sf = streetFigure(sub); if (sf && sf.ok) return { v: sf.med, w: 'on ' + sub.st };
  const c = comparables(sub).filter((x) => x.h.sq); if (c.length >= 3) return { v: quant(c.map(ppsf), 0.5), w: 'for the comparable sales' };
  const nf = nearbyFigure(sub); return nf.n >= 5 ? { v: nf.med, w: 'nearby' } : null;
}
function suggestFor(it) {
  const sq = toSqft(it.size);
  const kind = SPACE_KINDS.find((k) => k.k === it.kind) || SPACE_KINDS[0];
  if (!sq) return null;
  const r = VAL.rate && VAL.rate.rate;
  const added = r ? (k5(sq * r * kind.f) || Math.round(sq * r * kind.f / 1000) * 1000) : 0;
  const why = `${num0(sq)} sq ft (${(sq / SQ_M).toFixed(1)} m²) ${kind.label.toLowerCase()}${r ? ` × £${Math.round(r)} per sq ft × ${Math.round(kind.f * 100)}%` : ''}.${kind.note ? ' ' + kind.note : ''}`;
  return { sq, kind, added, why: r ? why : why + ' No local rate, so type your own figure.' };
}
function agreedItems() {
  return VAL.adds.filter((it) => it.status === 'agreed')
    .map((it) => { const s = suggestFor(it); return s ? { ...s, it, fig: it.override != null ? it.override : s.added } : null; })
    .filter(Boolean);
}
const agreedTotal = () => agreedItems().reduce((t, x) => t + x.fig, 0);

// The street's ceiling: the best sales on the road, and the dearest similar home for sale nearby.
function ceilingInfo(sub) {
  if (!sub.st) return null;
  const onSt = recentSales(10).filter((x) => x.h.st === sub.st && x.h.pc.slice(0, 4) === sub.pc.slice(0, 4));
  if (!onSt.length) return null;
  const best = onSt.reduce((m, x) => (x.adj > m.adj ? x : m));
  const same = onSt.filter((x) => x.h.t === sub.t);
  const bestSame = same.length ? same.reduce((m, x) => (x.adj > m.adj ? x : m)) : null;
  const mk = marketNow(sub).rows.map((x) => x.r).filter((r) => r.price);
  const topAsk = mk.length ? mk.reduce((m, r) => (r.price > m.price ? r : m)) : null;
  return { best, bestSame, topAsk, n: onSt.length };
}
function ceilingHtml(C, R, total) {
  if (!C) return '';
  const over = R && R.hi + (total || 0) > C.best.adj;
  return `<div class="notice ${over ? 'warn' : 'info'} val-ceiling"><b>Ceiling for ${esc(VAL.home.st)}: about ${money0(C.best.adj)}</b><br>
    Best sale on the road in 10 years: ${esc(C.best.h.a)}, ${money0(C.best.price)} in ${esc(monthYear(C.best.date))} (≈ ${money0(C.best.adj)} today)${C.bestSame && C.bestSame !== C.best ? `. Best ${esc(TYPE_WORD[VAL.home.t] || 'similar')} home: ${esc(C.bestSame.h.a)}, ≈ ${money0(C.bestSame.adj)} today` : ''}.
    ${C.topAsk ? `<br>Dearest similar home for sale nearby: ${esc(C.topAsk.a)}, asking ${money0(C.topAsk.price)} (${esc(C.topAsk.agent)}).` : ''}
    <br><small>Why it matters: buyers compare with what's sold on the road, and their surveyors check the price against the same sales, so it's hard to sell much above the best one however much has been spent.${over ? ' Your top figure is above it.' : ''}</small></div>`;
}

/* ---------------- Share with the owner (tick what goes in) ---------------- */
// Sprift is only named when its listings are in the message.
function valueFooter(withSprift) {
  const src = withSprift ? VAL.pack.sources : VAL.pack.sources.replace('; Sprift', '');
  return `Market appraisal from public records, not a formal (RICS) valuation. ${src}`;
}
function composeShare(ticks) {
  const sub = VAL.home;
  const secs = buildSections(sub).secs.filter((s) => s.text && ticks[s.id]);
  const from = S.settings.name ? `${S.settings.name}, Griffin` : 'Griffin';
  return [`${sub.a}, ${sub.pc}`, ...secs.map((s) => `*${s.title}*\n${s.text}`), `From ${from}`, `_${valueFooter(!!ticks.market)}_`].join('\n\n');
}
function openValueShare() {
  const secs = buildSections(VAL.home).secs.filter((s) => s.text);
  VAL.shareTicks = VAL.shareTicks || {};
  const ticks = Object.fromEntries(secs.map((s) => [s.id, VAL.shareTicks[s.id] != null ? VAL.shareTicks[s.id] : s.on]));
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = `<div class="sheet val-share" role="dialog" aria-label="Share with the owner">
    <h3>Before you send</h3>
    <div class="val-before">${ceilingHtml(ceilingInfo(VAL.home), VAL.range, agreedTotal()) || '<p class="hint">Not enough sales on this road to show a ceiling.</p>'}</div>
    <h3>What goes in the message?</h3>
    <p class="hint">Untick anything that doesn't help. The sources line always goes in. The ceiling above is just for you.</p>
    <div class="val-ticks">${secs.map((s) => `<label class="val-tick"><input type="checkbox" data-id="${s.id}" ${ticks[s.id] ? 'checked' : ''}> ${esc(s.title)}</label>`).join('')}</div>
    <label for="v-preview">Message (you can edit it)</label>
    <textarea id="v-preview" rows="10"></textarea>
    <div class="row"><button class="btn pri" id="v-send" type="button">Send…</button><button class="btn" id="v-copy" type="button">Copy</button><button class="btn" id="v-close" type="button">Close</button></div>
  </div>`;
  document.body.appendChild(back);
  const pv = back.querySelector('#v-preview');
  const refresh = () => { pv.value = composeShare(ticks); };
  back.querySelector('.val-ticks').onchange = (e) => { const c = e.target.closest('input[data-id]'); if (c) { ticks[c.dataset.id] = c.checked; VAL.shareTicks[c.dataset.id] = c.checked; refresh(); } };
  const close = () => back.remove();
  back.querySelector('#v-close').onclick = close;
  back.onclick = (e) => { if (e.target === back) close(); };
  back.querySelector('#v-copy').onclick = async () => { try { await navigator.clipboard.writeText(pv.value); toast('Copied'); } catch (e) { pv.select(); toast('Select all and copy'); } };
  back.querySelector('#v-send').onclick = async () => {
    const text = pv.value;
    if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  };
  refresh();
}

// From a door card: jump straight to that home's evidence.
async function openValueFor(address, postcode) {
  const P = await loadPack();
  VAL.home = null; VAL.adds = []; VAL.whole = '';
  VAL.query = String(address || '').split(',')[0] + (postcode ? ' ' + postcode : '');
  if (P) {
    let hits = searchHomes(VAL.query);
    // Registers don't always agree on a postcode, so try the street address alone too.
    if (!hits.length && postcode) { VAL.query = String(address || '').split(',')[0]; hits = searchHomes(VAL.query); }
    if (hits.length === 1 || (hits.length && postcode && hits.filter((h) => h.pc === postcode).length === 1)) VAL.home = hits.length === 1 ? hits[0] : hits.find((h) => h.pc === postcode);
  }
  go('value');
}
