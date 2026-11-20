'use strict';
/* ============================================================
   Market appraisal: condition, our price, the lister's price, the marketing strategy,
   the Rightmove "who sees your home" ladder, contact details, sending and the Sent list.
   Loaded after appraisal.js; uses its helpers (VAL, comparables, quant, k5, money0 ...).
   ============================================================ */

// Rightmove's min/max price steps (read from its search page, Nov 2026). Above £1m they're not checked.
const RM_STEPS = [50, 60, 70, 80, 90, 100, 110, 120, 125, 130, 140, 150, 160, 170, 175, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300,
  325, 350, 375, 400, 425, 450, 475, 500, 550, 600, 650, 700, 800, 900, 1000, 1250, 1500, 1750, 2000, 2500, 3000, 4000, 5000].map((k) => k * 1000);
const stepAtOrBelow = (p) => RM_STEPS.filter((s) => s <= p).pop() || RM_STEPS[0];
const stepAbove = (p) => RM_STEPS.find((s) => s > p) || RM_STEPS[RM_STEPS.length - 1];
const stepNearest = (p) => RM_STEPS.reduce((b, s) => (Math.abs(s - p) < Math.abs(b - p) ? s : b), RM_STEPS[0]);
const onStep = (p) => RM_STEPS.includes(p);

const CONDITIONS = [
  { k: 'reno', label: 'Needs serious renovation or repair', q: 0.15, word: 'needing serious work' },
  { k: 'avg', label: 'Average condition', q: 0.5, word: 'in average condition' },
  { k: 'high', label: 'Modern, high spec throughout', q: 0.85, word: 'modern and high spec' }
];
const STRATEGIES = [
  { k: 'guide', label: 'Guide price', two: true },
  { k: 'oieo', label: 'Offers in excess of' },
  { k: 'oiro', label: 'Offers in the region of' },
  { k: 'fixed', label: 'Fixed price' },
  { k: 'asking', label: 'Asking price' }
];
const STRAT_WHY = {
  guide: 'A guide range widens the audience: buyers searching at the lower figure see it, and the range tells them what it is expected to achieve, so more people view and compete for it.',
  oieo: 'Offers in excess of sets a clear floor and signals demand. Buyers searching at that figure see it, and the wording invites them to compete above it.',
  oiro: 'Offers in the region of gives buyers a realistic figure with room to negotiate either side, which keeps serious buyers talking rather than walking away.',
  fixed: 'A fixed price gives certainty: the first buyer who meets it and is ready to proceed secures the home. Good when speed or a clean sale matters most.',
  asking: 'A straightforward asking price. Set on one of Rightmove\'s search steps so no band of buyers misses it.'
};

/* ---------------- The price ---------------- */
function priceModel(sub) {
  const comps = comparables(sub);
  if (comps.length < 3) return null;
  const loc = sub.sq ? localRate(sub) : null;
  const rate = loc ? extraSpaceRate(sub, loc.v).rate : null;
  const vals = comps.map((c) => (sub.sq && rate ? c.adj + (sub.sq - c.h.sq) * rate : c.adj));
  const C = ceilingInfo(sub);
  const extra = agreedTotal();
  const out = {};
  // Where comparables sit close together their spread understates condition, so renovation is at least
  // 10% under the middle and high spec at least 5% over it (starting points: the lister's price overrides).
  const mid = quant(vals, 0.5);
  for (const c of CONDITIONS) {
    let v = (c.k === 'reno' ? Math.min(quant(vals, c.q), mid * 0.9) : c.k === 'high' ? Math.max(quant(vals, c.q), mid * 1.05) : mid) + extra;
    let capped = false;
    if (c.k === 'high' && C && v > C.best.adj) { v = C.best.adj; capped = true; }
    out[c.k] = { v: k5(v), capped };
  }
  return { by: out, n: comps.length, extra, ceiling: C };
}

function strategyFigures(kind, p) {
  if (kind === 'guide') { const lo = onStep(p) ? p : stepAtOrBelow(p); return { lo, hi: stepAbove(lo) }; }
  if (kind === 'oieo') return { lo: stepAtOrBelow(p) };
  if (kind === 'oiro') return { lo: stepNearest(p) };
  if (kind === 'fixed') return { lo: p };
  return { lo: Math.abs(stepNearest(p) - p) <= p * 0.03 ? stepNearest(p) : p };
}
// The single figure Rightmove searches on (the lower figure of a range).
const portalPrice = (st) => st.lo;
function strategyText(st) {
  const s = STRATEGIES.find((x) => x.k === st.kind);
  return st.kind === 'guide' ? `Guide price ${money0(st.lo)} – ${money0(st.hi)}` : st.kind === 'asking' ? `Asking price ${money0(st.lo)}` : `${s.label} ${money0(st.lo)}`;
}

/* ---------------- Who sees your home on Rightmove ---------------- */
function ladder(price, compare) {
  const i = Math.max(0, RM_STEPS.indexOf(stepAtOrBelow(Math.min(price, compare || price))));
  const steps = RM_STEPS.slice(Math.max(0, i - 2), i + 3);
  const bands = [];
  for (let j = 0; j < steps.length - 1; j++) bands.push({ min: steps[j], max: steps[j + 1] });
  const sees = (b, p) => b.min <= p && p <= b.max;
  return { steps, bands, sees, count: (p) => bands.filter((b) => sees(b, p)).length };
}
const k0 = (n) => '£' + Math.round(n / 1000) + 'k';
function ladderLines(st, raw) {
  const pp = portalPrice(st);
  const L = ladder(pp, raw);
  const lines = [];
  if (raw && raw !== pp) {
    const missed = L.bands.filter((b) => L.sees(b, pp) && !L.sees(b, raw));
    lines.push(`Rightmove buyers choose a minimum and maximum from fixed steps (${L.steps.map(k0).join(', ')}). Priced at ${money0(raw)}, your home only appears to buyers whose search reaches ${money0(raw)}${missed.length ? `: anyone searching ${missed.map((b) => k0(b.min) + '–' + k0(b.max)).join(' or ')} never sees it` : ''}.`);
    lines.push(`Marketed as ${strategyText(st).replace(/^./, (c) => c.toLowerCase())}, it sits on Rightmove's ${k0(pp)} step, so it is seen by ${L.count(pp)} of these search bands instead of ${L.count(raw)}${st.kind === 'guide' ? `, and the guide tells buyers it is expected to achieve up to ${money0(st.hi)}` : ''}.`);
  } else {
    lines.push(`Rightmove buyers choose a minimum and maximum from fixed steps (${L.steps.map(k0).join(', ')}). At ${money0(pp)} your home sits exactly on a step, so buyers searching up to ${k0(pp)} and buyers searching from ${k0(pp)} both see it.`);
  }
  lines.push('We are not playing the system: we are making sure every buyer who can afford your home actually sees it. More of the right buyers means more viewings, more competition and the best price for you.');
  return { lines, L, pp };
}
function ladderHtml(st, raw) {
  const pp = portalPrice(st);
  const L = ladder(pp, raw);
  const col = (p, title) => `<div class="lad-col"><b>${esc(title)}</b>${L.bands.map((b) => `<div class="lad-band ${L.sees(b, p) ? 'on' : ''}">${k0(b.min)} – ${k0(b.max)}<span>${L.sees(b, p) ? '✓ sees it' : '✗ misses it'}</span></div>`).join('')}<small>Seen by ${L.count(p)} of ${L.bands.length} search bands</small></div>`;
  return `<div class="lad">${raw && raw !== pp ? col(raw, `Priced at ${money0(raw)}`) : ''}${col(pp, strategyText(st))}</div>`;
}

// How many similar homes are for sale now in each band (Sprift).
function competition(sub, L) {
  const rows = (VAL.pack.market || []).filter((r) => !r.withdrawn && !r.fell && r.price >= 50000);
  const here = VAL.pack.pts[sub.pc];
  const flat = sub.t === 'flat';
  const near = rows.filter((r) => (km(here, VAL.pack.pts[r.pc]) ?? 99) <= 1.6 && /flat|maisonette|apartment/i.test(r.type || '') === flat);
  return L.bands.map((b) => ({ b, n: near.filter((r) => r.price >= b.min && r.price < b.max).length }));
}

/* ---------------- Screen section ---------------- */
function priceSectionHtml(sub) {
  const M = priceModel(sub);
  VAL.priceModel = M;
  if (!M) return '<section class="val-sec" id="sec-price"><h3>Price and marketing</h3><p class="hint">Not enough comparable sales to suggest a price. Type your own below.</p>' + priceInputs(sub, null) + '</section>';
  return `<section class="val-sec" id="sec-price"><h3>Price and marketing</h3>
    <span class="label">Condition</span>
    <div class="seg val-cond" id="v-cond" role="group" aria-label="Condition">${CONDITIONS.map((c) => `<button type="button" data-c="${c.k}" aria-pressed="${VAL.cond === c.k}">${esc(c.label)}</button>`).join('')}</div>
    ${priceInputs(sub, M)}
  </section>`;
}
function priceInputs(sub, M) {
  const sug = M ? M.by[VAL.cond] : null;
  const price = VAL.myPrice != null ? VAL.myPrice : sug ? sug.v : null;
  VAL.finalPrice = price;
  const st = price ? currentStrategy(price) : null;
  const comp = st && VAL.pack.market && VAL.pack.market.length ? competition(sub, ladder(portalPrice(st), price)) : [];
  return `
    ${sug ? `<p>Our suggested price: <b class="val-big">${money0(sug.v)}</b><br><small>${esc(CONDITIONS.find((c) => c.k === VAL.cond).word)}: from ${M.n} comparable sales adjusted for size${M.extra ? `, plus ${money0(M.extra)} agreed extra space` : ''}${sug.capped ? `, held at the street ceiling (${money0(M.ceiling.best.adj)})` : ''}.</small></p>` : ''}
    <label for="v-myprice">Your price${VAL.myPrice != null ? ' (your figure)' : ''}</label>
    <div class="fee-row"><div class="fee-input"><span>£</span><input type="text" id="v-myprice" inputmode="numeric" autocomplete="off" placeholder="Your figure" value="${price ? esc(price.toLocaleString('en-GB')) : ''}"></div>${VAL.myPrice != null ? '<button type="button" class="btn small" id="v-myprice-reset">Use ours</button>' : ''}</div>
    ${st ? `
    <span class="label">Marketing strategy</span>
    <div class="fee-chips val-strats" id="v-strat">${STRATEGIES.map((s) => `<button type="button" data-s="${s.k}" aria-pressed="${st.kind === s.k}">${esc(s.label)}</button>`).join('')}</div>
    <div class="fee-row"><div class="fee-input"><span>£</span><input type="text" id="v-st-lo" inputmode="numeric" value="${esc(st.lo.toLocaleString('en-GB'))}"></div>${st.kind === 'guide' ? `<span class="val-to">to</span><div class="fee-input"><span>£</span><input type="text" id="v-st-hi" inputmode="numeric" value="${esc(st.hi.toLocaleString('en-GB'))}"></div>` : ''}</div>
    <p class="val-big val-strat-line">${esc(strategyText(st))}</p>
    <p class="hint">${esc(STRAT_WHY[st.kind])}</p>
    <h4>Who sees it on Rightmove</h4>
    ${ladderHtml(st, price)}
    ${comp.some((c) => c.n) ? `<p class="hint">For sale nearby now (Sprift): ${comp.map((c) => `${k0(c.b.min)}–${k0(c.b.max)}: ${c.n}`).join(' · ')}</p>` : ''}
    <p class="hint">Rightmove searches on one figure: the lower figure of a range. Worth confirming with Griffin's Rightmove account manager.</p>` : ''}`;
}
function currentStrategy(price) {
  const kind = VAL.strategy || 'guide';
  const auto = strategyFigures(kind, price);
  const o = VAL.stOverride && VAL.stOverride.kind === kind && VAL.stOverride.price === price ? VAL.stOverride : null;
  return { kind, lo: o && o.lo ? o.lo : auto.lo, hi: o && o.hi ? o.hi : auto.hi };
}
function wirePriceSection(rerender) {
  const num = (v) => { const n = parseInt(String(v || '').replace(/[^\d]/g, ''), 10); return n > 0 ? n : null; };
  const cond = $('#v-cond');
  if (cond) cond.onclick = (e) => { const b = e.target.closest('button[data-c]'); if (b) { VAL.cond = b.dataset.c; rerender(); } };
  const mp = $('#v-myprice');
  if (mp) mp.addEventListener('change', () => { const n = num(mp.value); const sug = VAL.priceModel && VAL.priceModel.by[VAL.cond].v; VAL.myPrice = n && n !== sug ? n : null; VAL.stOverride = null; rerender(); });
  const rs = $('#v-myprice-reset');
  if (rs) rs.onclick = () => { VAL.myPrice = null; VAL.stOverride = null; rerender(); };
  const sg = $('#v-strat');
  if (sg) sg.onclick = (e) => { const b = e.target.closest('button[data-s]'); if (b) { VAL.strategy = b.dataset.s; VAL.stOverride = null; rerender(); } };
  const setO = () => { VAL.stOverride = { kind: VAL.strategy || 'guide', price: VAL.finalPrice, lo: num($('#v-st-lo') && $('#v-st-lo').value), hi: num($('#v-st-hi') && $('#v-st-hi').value) }; rerender(); };
  for (const id of ['#v-st-lo', '#v-st-hi']) if ($(id)) $(id).addEventListener('change', setO);
}

// The strategy as a shareable section (screen text + PDF ladder).
function strategySection(sub) {
  const price = VAL.finalPrice;
  if (!price) return null;
  const st = currentStrategy(price);
  const { lines, L, pp } = ladderLines(st, price);
  const text = [`Our recommendation: ${strategyText(st)}.`, STRAT_WHY[st.kind], ...lines].join('\n');
  return { id: 'strategy', title: 'Our recommended price and marketing', text, on: true, st, price,
    ladder: { steps: L.steps, bands: L.bands.map((b) => ({ ...b, a: L.sees(b, price), b: L.sees(b, pp) })), raw: price, pp, label: strategyText(st), showRaw: price !== pp } };
}

/* ---------------- Contact details (each lister's own) ---------------- */
const CONTACT_DEFAULTS = { phone: '', email: '', reviews: 'https://www.google.com/maps/search/?api=1&query=Griffin+Residential+Grays' };
async function loadContact() {
  if (!VAL.contact) VAL.contact = { ...CONTACT_DEFAULTS, ...((await DB.get('kv', 'apprContact')) || {}) };
  return VAL.contact;
}
async function saveContact(c) { VAL.contact = { ...VAL.contact, ...c }; await DB.put('kv', VAL.contact, 'apprContact'); }
function contactButtons() {
  const c = VAL.contact || CONTACT_DEFAULTS;
  const first = (S.settings.name || '').split(' ')[0];
  const intl = (p) => String(p || '').replace(/[^\d+]/g, '').replace(/^0/, '+44');
  const b = [];
  if (c.phone) b.push({ label: first ? `Call ${first}` : 'Call us', url: 'tel:' + intl(c.phone) });
  if (c.phone) b.push({ label: first ? `Text ${first}` : 'Text us', url: 'sms:' + intl(c.phone) });
  if (c.email) b.push({ label: first ? `Email ${first}` : 'Email us', url: `mailto:${c.email}?subject=${encodeURIComponent('Market appraisal: ' + VAL.home.a)}` });
  if (c.reviews) b.push({ label: 'Read our Google reviews', url: c.reviews });
  return b;
}
// The client's "go ahead" button: an email to the lister, already written for them.
function instructButton() {
  const c = VAL.contact || CONTACT_DEFAULTS;
  if (!c.email) return null;
  const first = (S.settings.name || '').split(' ')[0];
  const body = `Hello${first ? ' ' + first : ''},\n\nThank you for the market appraisal for ${VAL.home.a}, ${VAL.home.pc}.\n\nWe would like to go ahead and instruct Griffin to sell our home. Please get in touch to arrange the next steps, including the photos and floorplan.\n\nThe best number to reach us on is: \nThe best times to call are: \n\nKind regards,\n`;
  return { label: 'Instruct Griffin to sell my home', url: `mailto:${c.email}?subject=${encodeURIComponent('Instructing Griffin: ' + VAL.home.a)}&body=${encodeURIComponent(body)}`, big: true };
}

/* ---------------- Sent appraisals and follow-ups ---------------- */
async function logSent(via, to) {
  const list = (await DB.get('kv', 'apprSent')) || [];
  const st = VAL.finalPrice ? strategyText(currentStrategy(VAL.finalPrice)) : '';
  const at = new Date();
  const due = new Date(at.getTime() + 3 * 86400000);
  list.unshift({ id: uid(), a: VAL.home.a, pc: VAL.home.pc, to: to || '', via, at: at.toISOString(), due: localDate(due), strategy: st, done: false });
  await DB.put('kv', list.slice(0, 300), 'apprSent');
}
async function sentListHtml() {
  const list = ((await DB.get('kv', 'apprSent')) || []).filter((x) => !x.done);
  if (!list.length) return '';
  const today = localDate();
  return `<section class="val-sec"><h3>Sent appraisals: follow up</h3><ul class="val-list comps" id="v-sent">${list.slice(0, 20).map((x) => `<li data-id="${x.id}">
    <b>${esc(x.a)}</b> <small>${esc(x.pc)}</small>${x.due <= today ? ' <span class="flag bad">Follow up due</span>' : ''}<br>
    <small>Sent ${esc(prettyDate(x.at))} by ${esc(x.via)}${x.to ? ' to ' + esc(x.to) : ''}${x.strategy ? ' · ' + esc(x.strategy) : ''} · follow up ${esc(prettyDate(x.due))}</small><br>
    <button type="button" class="btn small" data-a="open">Open</button> <button type="button" class="btn small" data-a="done">Followed up ✓</button></li>`).join('')}</ul></section>`;
}
function wireSentList() {
  const el = $('#v-sent'); if (!el) return;
  el.onclick = async (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const id = b.closest('li').dataset.id;
    const list = (await DB.get('kv', 'apprSent')) || [];
    const x = list.find((y) => y.id === id); if (!x) return;
    if (b.dataset.a === 'done') { x.done = true; await DB.put('kv', list, 'apprSent'); renderValue(); }
    if (b.dataset.a === 'open') openValueFor(x.a, x.pc);
  };
}
