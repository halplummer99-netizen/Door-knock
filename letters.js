'use strict';
/* ============================================================
   Letters tab (Hal, 26 Nov 2026): today's door letters on the phone.
   - The list comes with "Door knock list.csv" from the PC: every door on it has a letter, and the CSV says
     its type (letter), what that type is for (letter_why), which day it was printed (letter_day) and its page
     in that day's letters PDF (letter_page of letter_pages).
   - The PDFs come from OneDrive › Door Knock letters ("NEXT TO PRINT - letters - <day>.pdf", or a day folder's
     "PRINT ME - N letters.pdf"): shared to Griffin, or loaded with the button on this tab.
   - Print / share one letter, or all of today's in route order, through the phone's share menu
     (a printer app, WhatsApp, email, Drive...). Pages are cut out with pdf-lib (vendor/, MIT), loaded only when needed.
   Uses app.js helpers (DB, S, esc, go, toast, factKey, prettyDate), which are all there by the time this runs.
   ============================================================ */

const LETTER_TYPES_COLOUR = { A: '#0a6b2a', B: '#0040a8', C: '#6b3fa0', D: '#b11f29', E: '#6b4400', F: '#191933', G: '#00707a' };

// Pulled out of the door list CSV by csvToLines (app.js); saved by addLinesToDraft.
function lettersFromCsv(hdr, data, lineOf) {
  const at = (k) => hdr.indexOf(k);
  const li = at('letter');
  if (li < 0) return null;
  const rows = [];
  data.forEach((r, i) => {
    const line = lineOf(r);
    if (!line) return;
    const g = (k) => (at(k) >= 0 ? (r[at(k)] || '').trim() : '');
    rows.push({
      stop: +g('stop') || i + 1, line, letter: g('letter'), why: g('letter_why'),
      day: g('letter_day'), page: +g('letter_page') || 0, pages: +g('letter_pages') || 0, file: g('letter_file')
    });
  });
  if (!rows.some((x) => x.letter)) return null;
  const built = (data[0] && at('built_on') >= 0 ? (data[0][at('built_on')] || '').trim() : '');
  // Which PDF holds each letter: from 26 Nov 2026 ONE file for the whole list ("Door knock letters.pdf", key list:<day>);
  // older lists point at each print day's own file (key = that day).
  for (const r of rows) r.key = r.file ? 'list:' + built : r.day;
  return { built, rows };
}

async function saveLetterList(list) {
  await DB.put('kv', { ...list, saved: Date.now() }, 'letterList');
  await pruneLetterPdfs(list);
}

/* ---------------- PDFs kept on the phone, one per print day ---------------- */
// kv letterPdfs = { 'YYYY-MM-DD': { name, pages, added } }; the file itself is kv 'letterPdf:YYYY-MM-DD'.
const pdfIndex = async () => (await DB.get('kv', 'letterPdfs')) || {};

let pdfLibPromise = null;
function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (!pdfLibPromise) {
    pdfLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/pdf-lib.min.js';
      s.onload = () => resolve(window.PDFLib);
      s.onerror = () => { pdfLibPromise = null; reject(new Error('Could not load the PDF tool. Open the app once with signal.')); };
      document.head.appendChild(s);
    });
  }
  return pdfLibPromise;
}
async function readPdf(blob) {
  const { PDFDocument } = await loadPdfLib();
  return PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// "NEXT TO PRINT - letters - Thu 26 Nov.pdf" -> 2026-11-26; "2026-11-26" in a name works too.
function dayFromName(name) {
  const iso = /(\d{4})-(\d\d)-(\d\d)/.exec(name || '');
  if (iso) return iso[0];
  const m = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.exec(name || '');
  if (!m) return '';
  const now = new Date();
  let d = new Date(now.getFullYear(), MONTHS.indexOf(m[2].toLowerCase()), +m[1]);
  if (d - now > 180 * 86400000) d = new Date(now.getFullYear() - 1, d.getMonth(), d.getDate()); // Dec file opened in Jan
  return localDate(d);
}

// Which print day is this PDF? The name's date wins; else the day on the list with that many pages
// whose letters were made around when the PDF was (Letter Writer runs the evening before).
async function guessPdfDay(name, pages, created) {
  const fromName = dayFromName(name);
  if (fromName) return fromName;
  const list = (await DB.get('kv', 'letterList')) || { rows: [] };
  const days = [...new Set(list.rows.filter((r) => r.day && r.pages === pages).map((r) => r.day))];
  if (days.length <= 1) return days[0] || '';
  if (created) {
    const c = localDate(created);
    const near = days.filter((d) => d >= c && (new Date(d + 'T12:00:00') - new Date(c + 'T00:00:00')) / 86400000 <= 4).sort();
    if (near.length) return near[0];
  }
  return '';
}

// Save one letters PDF. forDay = the day the person picked it for (Load button); otherwise worked out.
async function addLetterPdf(file, forDay) {
  const LIST_PDF = /^Door knock letters (\d{4}-\d\d-\d\d)/;
  let doc;
  try { doc = await readPdf(file); } catch (e) { toast(`${file.name || 'That file'} couldn't be read as a PDF: ${e.message}`, null, 8000); return null; }
  const pages = doc.getPageCount();
  let created = null;
  try { created = doc.getCreationDate() || null; } catch (e) { /* no date in the file */ }
  const list = (await DB.get('kv', 'letterList')) || { rows: [] };
  let title = '';
  try { title = doc.getTitle() || ''; } catch (e) { /* untitled */ }
  const forList = LIST_PDF.exec(title);
  let day = forDay;
  if (!day && forList) {
    day = 'list:' + forList[1];
    if (forList[1] !== list.built) {
      toast(`That letters PDF is for ${prettyDate(forList[1])}, but your list is for ${prettyDate(list.built) || 'another day'}. Import today's Door knock list.csv and Door knock letters.pdf together.`, null, 12000);
      return null;
    }
  }
  if (!day && /^door knock letters/i.test(file.name || '') && list.rows.some((r) => r.key === 'list:' + list.built)) day = 'list:' + list.built;
  if (!day) day = await guessPdfDay(file.name, pages, created);
  if (!day) {
    toast(`Couldn't tell which day ${file.name || 'that PDF'} is for. Use the "Load PDF" button on the Letters tab instead.`, null, 9000);
    return null;
  }
  const want = (list.rows.find((r) => (r.key || r.day) === day) || {}).pages;
  const blob = new Blob([await file.arrayBuffer()], { type: 'application/pdf' });
  await DB.put('kv', blob, 'letterPdf:' + day);
  const idx = await pdfIndex();
  idx[day] = { name: file.name || 'letters.pdf', pages, added: Date.now() };
  await DB.put('kv', idx, 'letterPdfs');
  const warn = want && want !== pages ? ` WARNING: it has ${pages} pages but the list expects ${want}, so pages may not line up. Check you picked the letters file (not the slips).` : '';
  toast(`${day.startsWith('list:') ? `All ${pages} letters for ${prettyDate(day.slice(5))}` : `Letters PDF for ${prettyDate(day)}`} saved on the phone: print or share them on the Letters tab.${warn}`, null, warn ? 12000 : 5000);
  return day;
}

// Keep PDFs for days still on the list, plus anything added in the last 3 weeks (bag life is 14 days).
async function pruneLetterPdfs(list) {
  const idx = await pdfIndex();
  const keep = new Set((list.rows || []).map((r) => r.key || r.day));
  const cut = Date.now() - 21 * 86400000;
  let changed = false;
  for (const day of Object.keys(idx)) {
    if (keep.has(day) || idx[day].added > cut) continue;
    await DB.del('kv', 'letterPdf:' + day);
    delete idx[day];
    changed = true;
  }
  if (changed) await DB.put('kv', idx, 'letterPdfs');
}

/* ---------------- Cutting pages out and handing them to the share menu ---------------- */
async function buildLettersPdf(rows) {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  const docs = {};
  let n = 0;
  for (const r of rows) {
    const key = r.key || r.day;
    if (!docs[key]) {
      const blob = await DB.get('kv', 'letterPdf:' + key);
      if (!blob) continue;
      docs[key] = await readPdf(blob);
    }
    const src = docs[key];
    if (!r.page || r.page > src.getPageCount()) continue;
    const [p] = await out.copyPages(src, [r.page - 1]);
    out.addPage(p);
    n++;
  }
  if (!n) return null;
  out.setTitle(rows.length === 1 ? `Letter - ${rows[0].line}` : `Griffin letters (${n})`);
  return new Blob([await out.save()], { type: 'application/pdf' });
}

async function sharePdf(blob, filename) {
  const file = new File([blob], filename, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  // No share menu (e.g. a PC): save the file instead, then print it from there.
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
const safeName = (s) => String(s).split(',')[0].replace(/[\\/:*?"<>|]+/g, '').trim();

/* ---------------- The tab ---------------- */
const shortDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
function letterDelivered(line) {
  if (!S.run) return null;
  const k = factKey(line);
  const s = S.run.stops.find((x) => factKey(x.raw) === k);
  return s ? s.log : null;
}

async function renderLetters() {
  const list = await DB.get('kv', 'letterList');
  const idx = await pdfIndex();
  const rows = list ? list.rows : [];
  for (const r of rows) if (!r.key) r.key = r.day;   // lists saved by dk-v26
  const days = [...new Set(rows.map((r) => r.key).filter(Boolean))].sort();
  const old = list && list.built && list.built < localDate();
  const ready = rows.filter((r) => r.key && idx[r.key] && r.page);
  const handed = rows.filter((r) => { const L = letterDelivered(r.line); return L && L.letter_delivered; }).length;

  const missing = days.filter((d) => !idx[d]);
  const dayBoxes = `<div class="lt-days">
        ${days.map((d) => {
          const n = rows.filter((r) => r.key === d).length;
          const have = idx[d];
          const whole = d.startsWith('list:');
          return `<div class="lt-day">
            <div><b>${whole ? `All ${n} letters` : d === list.built ? 'Printed for today' : `Printed ${esc(shortDay(d))}`}</b>${whole ? '' : ` · ${n} letter${n === 1 ? '' : 's'}`}<br>
              <small class="meta">${have ? `✓ PDF on phone (${have.pages} pages)` : whole ? 'Needs "Door knock letters.pdf" (OneDrive › Door Knock list, next to the list)' : `Needs "NEXT TO PRINT - letters - ${esc(shortDay(d))}.pdf"${d === list.built ? '' : " or that day's PRINT ME letters file"}`}</small></div>
            <button class="btn small lt-load" type="button" data-day="${d}">${have ? 'Replace' : 'Load PDF'}</button>
          </div>`;
        }).join('')}
        <input type="file" id="lt-file" accept="application/pdf,.pdf" multiple hidden>
      </div>`;
  app.innerHTML = `
    <h2>✉️ Letters</h2>
    ${!list ? `<p>No letters yet. Share today's <b>Door knock list.csv</b> (OneDrive › Door Knock list) to Griffin: the letters come with it.</p>`
      : `<p class="meta">${rows.length} letter${rows.length === 1 ? '' : 's'} for ${esc(list.built ? shortDay(list.built) : 'today')}${handed ? ` · ${handed} handed over` : ''}</p>`}
    ${!rows.length ? '<div class="stack"><button class="btn big lt-slips" type="button">✂️ Slips: edit and print</button></div>' : ''}
    ${old ? `<div class="notice warn">This is ${esc(prettyDate(list.built))}'s list, not today's. Share today's Door knock list.csv to update it.</div>` : ''}
    ${rows.length ? `
      ${missing.length ? `<div class="notice warn">${missing.some((d) => d.startsWith('list:')) ? 'Load <b>Door knock letters.pdf</b> to print from here. It sits next to Door knock list.csv in OneDrive › Door Knock list: tick both when you tap Import on the Door Knock tab.' : `Load the letters PDF${missing.length === 1 ? '' : 's'} below to print from here.`}</div>${dayBoxes}` : ''}
      <div class="stack">
        <button class="btn pri big" id="lt-all" type="button">🖨️ Print / share all ${ready.length === rows.length ? rows.length : `${ready.length} of ${rows.length}`} letters</button>
        <button class="btn big lt-slips" type="button">✂️ Slips: edit and print (${Math.ceil(rows.length / 3)} sheet${Math.ceil(rows.length / 3) === 1 ? '' : 's'})</button>
      </div>
      ${rows.map((r, i) => {
        const t = (r.letter || '?').split(' ')[0];
        const L = letterDelivered(r.line);
        const facts = ((S.doorFacts || {})[factKey(r.line)] || '').split('\n')[0];
        const can = r.key && idx[r.key] && r.page;
        return `<div class="lead lt-item" style="border-left-color:${LETTER_TYPES_COLOUR[t] || 'var(--oth)'}">
          <div class="row" style="align-items:flex-start">
            <span class="lt-type" style="background:${LETTER_TYPES_COLOUR[t] || 'var(--oth)'}">${esc(t)}</span>
            <div style="flex:1;min-width:0"><b>${esc(r.stop)}. ${esc(r.line)}</b><br>
              <b>${esc(r.letter.replace(/^[A-Z]\s+/, '') || 'Letter')}</b>${r.why ? ` · ${esc(r.why)}` : ''}
              ${facts ? `<br><small class="meta">${esc(facts)}</small>` : ''}
              <br><small class="meta">${r.day && r.day !== list.built ? `In your bag since ${esc(shortDay(r.day))}` : 'Printed for today'}${r.page ? ` · page ${r.page} of ${r.pages}` : ''}${L && L.letter_delivered ? ' · <b>✉️ handed over</b>' : ''}</small></div>
          </div>
          <button class="btn small lt-one${can ? '' : ' lt-off'}" type="button" data-i="${i}">🖨️ Print / share this letter</button>
        </div>`;
      }).join('')}
      ${missing.length ? '' : `<details class="lt-pdfs"><summary>Letters PDFs on this phone (${days.length})</summary>${dayBoxes}</details>`}` : ''}
  `;

  app.querySelectorAll('.lt-slips').forEach((b) => { b.onclick = () => go('slips'); });
  let loadDay = '';
  app.querySelectorAll('.lt-load').forEach((b) => { b.onclick = () => { loadDay = b.dataset.day; $('#lt-file').click(); }; });
  if ($('#lt-file')) $('#lt-file').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    toast('Reading the PDF…');
    let ok = 0;
    for (const f of files) if (await addLetterPdf(f, files.length === 1 ? loadDay : '')) ok++;
    if (ok) renderLetters();
  };
  const needPdf = () => toast(missing.some((d) => d.startsWith('list:'))
    ? 'Load Door knock letters.pdf first: tap Load PDF and pick it from OneDrive › Door Knock list.'
    : 'Load the letters PDF for that day first (Load PDF on this tab).', null, 8000);
  const busy = async (btn, rowsToPrint, filename) => {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Getting it ready…';
    try {
      const blob = await buildLettersPdf(rowsToPrint);
      if (!blob) throw new Error('none of those pages are in the PDFs on this phone');
      await sharePdf(blob, filename);
    } catch (err) {
      toast('Could not make the PDF: ' + err.message, null, 8000);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  };
  if ($('#lt-all')) $('#lt-all').onclick = (e) => (!ready.length ? needPdf() : busy(e.currentTarget, ready, `Letters - ${list.built || localDate()} (${ready.length}).pdf`));
  app.querySelectorAll('.lt-one').forEach((b) => {
    b.onclick = () => { const r = rows[+b.dataset.i]; if (!(r.key && idx[r.key] && r.page)) return needPdf(); busy(b, [r], `Letter - ${safeName(r.line)}.pdf`); };
  });
}

// PDFs shared to the app (Share › Griffin). Returns how many were saved.
async function takeSharedPdfs(files) {
  let n = 0;
  for (const f of files) {
    const file = new File([f.blob], f.name || 'letters.pdf', { type: 'application/pdf' });
    if (await addLetterPdf(file, '')) n++;
  }
  return n;
}
