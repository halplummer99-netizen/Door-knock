'use strict';
/* ============================================================
   Slips (the promise card that goes in every envelope), made on the phone (Hal, 26 Nov 2026).
   Edit the six promises, then print / share an A4 PDF: three slips per sheet, each 200 x 89 mm with a
   5 mm white frame inside its 210 x 99 mm slot (same as the PC's slip sheets: cut at 99 and 198 mm).
   The card is drawn on a canvas at 300 dpi in Montserrat (fonts/, SIL Open Font Licence), copying the PC
   design in home-reports/letters/render.js, then placed on the pages with pdf-lib (vendor/).
   Edits are kept on this phone only (kv slipText). If any text mentions mortgages, the full risk warning
   is added to the card (Hal's rule for anything that mentions mortgages).
   ============================================================ */

// Hal's signed-off card (letter-types.json "promises", 26 Nov 2026). "Back to standard" restores these.
const SLIP_DEFAULT = {
  eyebrow: 'MY PROMISES TO EVERY SELLER',
  headline: 'One agent. Start to finish. Me.',
  items: [
    "I'll do your market appraisal, every viewing and every negotiation myself, then see it through to completion.",
    "Within an hour of every viewing, you'll know what the buyer thought and whether they can buy.",
    "Call or text me any time. If I miss you, I'll call back the same day.",
    'Your price is based on real sold prices per square foot, not set to win your business.',
    'Our branch is open all day Saturday, when most serious buyers can view.',
    "I'll take you through your contract before you sign. No surprise fees."
  ],
  contact: 'Hal Plummer · 07863 778856 · hal@griffingroup.co.uk'
};
const SLIP_RISK = 'As a mortgage is secured against your home or property, it could be repossessed if you do not keep up the mortgage repayments.';

async function slipText() {
  const t = (await DB.get('kv', 'slipText')) || {};
  return { ...SLIP_DEFAULT, ...t, items: SLIP_DEFAULT.items.map((d, i) => ((t.items || [])[i] != null ? t.items[i] : d)) };
}
const slipIsStandard = (t) => JSON.stringify({ ...t }) === JSON.stringify({ ...SLIP_DEFAULT });
const slipNeedsRisk = (t) => /mortgag/i.test([t.eyebrow, t.headline, t.contact, ...t.items].join(' '));

let slipFontsPromise = null;
function loadSlipFonts() {
  if (!slipFontsPromise) {
    slipFontsPromise = Promise.all([500, 600, 700, 800].map((w) =>
      new FontFace('MSlip', `url(fonts/montserrat-latin-${w}-normal.woff2)`, { weight: String(w) }).load().then((f) => document.fonts.add(f))
    )).catch((e) => { slipFontsPromise = null; throw new Error('Could not load the slip fonts. Open the app once with signal.'); });
  }
  return slipFontsPromise;
}

// Draw one card. Returns { canvas, fits } (fits = false if a promise had to be cut short).
const SLIP_W = 200, SLIP_H = 89; // mm, the card inside its 5 mm white frame
function drawSlip(t, dpi = 300) {
  const k = dpi / 25.4;                  // px per mm
  const pt = (p) => p * 0.3528 * k;      // points -> px
  const cssPx = (p) => p * 0.2646 * k;   // CSS px (letter-spacing in the PC design) -> px
  const c = document.createElement('canvas');
  c.width = Math.round(SLIP_W * k);
  c.height = Math.round(SLIP_H * k);
  const g = c.getContext('2d');
  const font = (w, p) => { g.font = `${w} ${pt(p)}px MSlip`; };
  const spaced = (px) => { if ('letterSpacing' in g) g.letterSpacing = `${px}px`; };

  g.fillStyle = '#1A1933'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#B12028'; g.fillRect(0, (SLIP_H - 4) * k, c.width, 4 * k);
  const L = 8 * k, R = (SLIP_W - 8) * k, T = 5.5 * k, B = (SLIP_H - 4 - 4) * k;
  g.textBaseline = 'alphabetic';

  // Top left: eyebrow + headline
  font(700, 8.5); spaced(cssPx(2.2)); g.fillStyle = '#e8a0a4';
  let y = T + pt(8.5) * 0.95;
  g.fillText(t.eyebrow, L, y);
  font(800, 17); spaced(0); g.fillStyle = '#fff';
  y += 1.5 * k + pt(17) * 1.05;
  g.fillText(t.headline, L, y, R - L - 45 * k);
  const headBottom = y + pt(17) * 0.3;
  // Top right: GRIFFIN / THE PROPERTY PEOPLE, centred on each other
  font(500, 17); spaced(cssPx(5.5));
  const wmW = g.measureText('GRIFFIN').width - cssPx(5.5);
  font(600, 5.2); spaced(cssPx(1.6));
  const tpW = g.measureText('THE PROPERTY PEOPLE').width - cssPx(1.6);
  const cx = R - Math.max(wmW, tpW) / 2;
  g.textAlign = 'left';
  font(500, 17); spaced(cssPx(5.5)); g.fillText('GRIFFIN', cx - wmW / 2, T + pt(17) * 0.95);
  font(600, 5.2); spaced(cssPx(1.6)); g.fillText('THE PROPERTY PEOPLE', cx - tpW / 2, T + pt(17) * 1.2 + 1 * k + pt(5.2));
  spaced(0);

  // Bottom: contact line above a faint rule
  font(600, 8); g.fillStyle = '#c9cbe0';
  const contactY = B;
  g.fillText(t.contact, L, contactY, R - L);
  const ruleY = contactY - pt(8) * 0.95 - 2.5 * k;
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(L, ruleY, R - L, Math.max(1, 0.26 * k));

  // Mortgage risk warning (only when something on the card mentions mortgages)
  let listBottom = ruleY - 1.5 * k;
  const wrap = (text, maxW) => {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (line && g.measureText(test).width > maxW) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  };
  if (slipNeedsRisk(t)) {
    font(600, 6); g.fillStyle = '#ffffff';
    const lines = wrap(SLIP_RISK, R - L);
    const lh = pt(6) * 1.3;
    lines.slice().reverse().forEach((l, i) => g.fillText(l, L, listBottom - i * lh));
    listBottom -= lines.length * lh + 1.5 * k;
  }

  // The six promises: 2 columns x 3 rows, numbered red squares. Shrinks the text to fit if needed.
  const top = headBottom + 3.5 * k;
  const colGap = 7 * k, rowGap = 2.6 * k, sq = 5.5 * k, gap = 3 * k;
  const colW = (R - L - colGap) / 2, textW = colW - sq - gap;
  const rowH = (listBottom - top - 2 * rowGap) / 3;
  let size = 8.6, fits = false, laid = [];
  for (; size >= 6.4; size -= 0.2) {
    font(500, size);
    const lh = pt(size) * 1.35;
    laid = t.items.map((s) => wrap(s, textW));
    if (laid.every((ls) => ls.length * lh <= rowH)) { fits = true; break; }
  }
  if (!fits) size = 6.4;
  const lh = pt(size) * 1.35;
  t.items.forEach((s, i) => {
    const x = L + (i % 2) * (colW + colGap);
    const yTop = top + Math.floor(i / 2) * (rowH + rowGap);
    g.fillStyle = '#B12028'; g.fillRect(x, yTop + 0.3 * k, sq, sq);
    font(800, 8); g.fillStyle = '#fff'; g.textAlign = 'center';
    g.fillText(String(i + 1), x + sq / 2, yTop + 0.3 * k + sq / 2 + pt(8) * 0.36);
    g.textAlign = 'left';
    font(500, size);
    const maxLines = Math.max(1, Math.floor(rowH / lh));
    laid[i].slice(0, maxLines).forEach((l, j) => g.fillText(l, x + sq + gap, yTop + pt(size) * 0.95 + j * lh));
  });
  return { canvas: c, fits, size };
}

async function buildSlipsPdf(t, sheets) {
  await loadSlipFonts();
  const { PDFDocument } = await loadPdfLib();
  const { canvas } = drawSlip(t, 300);
  const png = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(await png.arrayBuffer());
  const mm = 72 / 25.4, A4W = 210 * mm, A4H = 297 * mm;
  for (let s = 0; s < sheets; s++) {
    const p = doc.addPage([A4W, A4H]);
    for (let i = 0; i < 3; i++) p.drawImage(img, { x: 5 * mm, y: A4H - (i * 99 + 5 + SLIP_H) * mm, width: SLIP_W * mm, height: SLIP_H * mm });
  }
  doc.setTitle(`Griffin slips (${sheets} sheet${sheets === 1 ? '' : 's'})`);
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

/* ---------------- The slips screen (Letters tab › Slips) ---------------- */
async function renderSlips() {
  const t = await slipText();
  const list = await DB.get('kv', 'letterList');
  const letters = list ? list.rows.length : 0;
  const sheetsDefault = Math.max(1, Math.ceil((letters || 3) / 3));
  app.innerHTML = `
    <h2>✂️ Slips</h2>
    <p class="meta">The promise card for each envelope. Three to an A4 sheet: cut at the white gaps.</p>
    <canvas id="sl-preview" class="sl-preview" aria-label="Slip preview"></canvas>
    <div id="sl-fit" class="notice warn" hidden></div>
    <label for="sl-sheets">How many A4 sheets?</label>
    <input type="number" id="sl-sheets" min="1" max="20" inputmode="numeric" value="${sheetsDefault}">
    <div class="hint">${letters ? `${letters} letters today = ${sheetsDefault} sheet${sheetsDefault === 1 ? '' : 's'} (${sheetsDefault * 3} slips)` : '3 slips per sheet'}</div>
    <div class="stack"><button class="btn pri big" id="sl-print" type="button">🖨️ Print / share slips</button></div>

    <h3>Edit the card</h3>
    <p class="hint">Changes are saved on this phone and used every time you print slips here. Keep it to six: the letters say "the six promises I make".</p>
    <label for="sl-eyebrow">Small heading</label>
    <input type="text" id="sl-eyebrow" value="${esc(t.eyebrow)}" maxlength="40">
    <label for="sl-headline">Headline</label>
    <input type="text" id="sl-headline" value="${esc(t.headline)}" maxlength="45">
    ${t.items.map((s, i) => `
      <label for="sl-i${i}">Promise ${i + 1}</label>
      <textarea id="sl-i${i}" class="sl-item" rows="3" maxlength="160">${esc(s)}</textarea>`).join('')}
    <label for="sl-contact">Bottom line</label>
    <input type="text" id="sl-contact" value="${esc(t.contact)}" maxlength="80">
    <div class="stack">
      <button class="btn small" id="sl-reset" type="button" ${slipIsStandard(t) ? 'disabled' : ''}>Back to the standard promises</button>
      <button class="btn small" id="sl-back" type="button">Back to letters</button>
    </div>
  `;
  const read = () => ({
    eyebrow: $('#sl-eyebrow').value.trim(), headline: $('#sl-headline').value.trim(),
    items: [...app.querySelectorAll('.sl-item')].map((x) => x.value.replace(/\s+/g, ' ').trim()),
    contact: $('#sl-contact').value.trim()
  });
  let timer = null;
  const preview = async () => {
    try { await loadSlipFonts(); } catch (e) { $('#sl-fit').hidden = false; $('#sl-fit').textContent = e.message; return; }
    const cur = read();
    const { canvas, fits, size } = drawSlip(cur, 110);
    const pv = $('#sl-preview');
    if (!pv) return;
    pv.width = canvas.width; pv.height = canvas.height;
    pv.getContext('2d').drawImage(canvas, 0, 0);
    const warn = [];
    if (!fits) warn.push('Some promises are too long to fit and will be cut short. Shorten the longest one.');
    else if (size < 8.4) warn.push(`Text shrunk a little to fit (${size.toFixed(1)}pt instead of 8.6pt).`);
    if (slipNeedsRisk(cur)) warn.push('Mentions mortgages, so the full risk warning is added to the card.');
    if (cur.items.some((s) => !s)) warn.push('A promise is empty.');
    $('#sl-fit').hidden = !warn.length;
    $('#sl-fit').textContent = warn.join(' ');
  };
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const cur = read();
      await DB.put('kv', cur, 'slipText');
      $('#sl-reset').disabled = slipIsStandard(cur);
      preview();
    }, 250);
  };
  app.querySelectorAll('input[type=text], textarea').forEach((el) => { el.oninput = save; });
  preview();
  $('#sl-reset').onclick = async () => {
    const old = read();
    await DB.del('kv', 'slipText');
    await renderSlips();
    toast('Back to the standard promises', { label: 'Undo', fn: async () => { await DB.put('kv', old, 'slipText'); renderSlips(); } });
  };
  $('#sl-back').onclick = () => go('letters');
  $('#sl-print').onclick = async (e) => {
    const btn = e.currentTarget;
    const cur = read();
    if (cur.items.some((s) => !s) || !cur.headline) return toast('Fill in the headline and all six promises first');
    const n = Math.min(20, Math.max(1, parseInt($('#sl-sheets').value, 10) || 1));
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Making the slips…';
    try {
      await DB.put('kv', cur, 'slipText');
      const blob = await buildSlipsPdf(cur, n);
      await sharePdf(blob, `Slips - ${n} sheet${n === 1 ? '' : 's'}.pdf`);
    } catch (err) {
      toast('Could not make the slips: ' + err.message, null, 8000);
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  };
}
