'use strict';
/* ============================================================
   Griffin-branded market appraisal PDF, made on the phone (no signal or library needed).
   A small hand-written PDF: Helvetica text, Griffin navy and red, the logo in the header.
   Used by the share sheet in appraisal.js.
   ============================================================ */

const PDFX = (() => {
  const W = 595.28, H = 841.89, M = 40;
  const NAVY = [25 / 255, 25 / 255, 51 / 255], RED = [177 / 255, 31 / 255, 41 / 255];
  const GREY = [0.37, 0.37, 0.4], CARD = [0.95, 0.953, 0.96], LINE = [0.8, 0.8, 0.82], BLACK = [0.04, 0.04, 0.04];

  // Helvetica / Helvetica-Bold widths (1/1000 em) for characters 32-126.
  const WR = '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584'.split(' ').map(Number);
  const WB = '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584'.split(' ').map(Number);
  // Characters outside plain ASCII, as Windows-1252 bytes the standard fonts understand.
  const MAP = { '£': [0xa3, 556], '–': [0x96, 556], '—': [0x97, 1000], '•': [0x95, 350], '·': [0xb7, 278], '²': [0xb2, 333], '½': [0xbd, 834], '¾': [0xbe, 834], '¼': [0xbc, 834], '’': [0x92, 222], '‘': [0x91, 222], '“': [0x93, 333], '”': [0x94, 333], '©': [0xa9, 737], 'é': [0xe9, 556], '…': [0x85, 1000] };
  const SUB = { '≈': '~', '⚠': '!', '✓': '', '←': '', '→': '-' };
  const clean = (s) => String(s == null ? '' : s).replace(/[≈⚠✓←→]/g, (c) => SUB[c]).replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  function width(s, size, bold) {
    let w = 0;
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      w += c >= 32 && c <= 126 ? (bold ? WB : WR)[c - 32] : MAP[ch] ? MAP[ch][1] : 556;
    }
    return (w * size) / 1000;
  }
  function enc(s) {
    let o = '';
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      let b = c >= 32 && c <= 126 ? c : MAP[ch] ? MAP[ch][0] : 63;
      if (b === 40 || b === 41 || b === 92) o += '\\';
      o += String.fromCharCode(b);
    }
    return o;
  }
  function wrap(text, size, bold, maxW) {
    const out = [];
    for (const para of String(text).split('\n')) {
      const words = clean(para).split(' ');
      let line = '';
      for (const w of words) {
        const t = line ? line + ' ' + w : w;
        if (width(t, size, bold) <= maxW || !line) line = t; else { out.push(line); line = w; }
      }
      out.push(line);
    }
    return out;
  }

  class Doc {
    constructor() { this.pages = []; this.newPage(); }
    newPage() { this.ops = []; this.pages.push(this.ops); this.y = H - M; }
    col(c, stroke) { this.ops.push(`${c.map((v) => v.toFixed(3)).join(' ')} ${stroke ? 'RG' : 'rg'}`); }
    rect(x, y, w, h, c) { this.col(c); this.ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); }
    line(x1, y1, x2, y2, c, lw = 0.6) { this.col(c, true); this.ops.push(`${lw} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`); }
    text(x, y, s, size, { bold, c = BLACK, align } = {}) {
      s = clean(s);
      if (align === 'right') x -= width(s, size, bold);
      if (align === 'center') x -= width(s, size, bold) / 2;
      this.col(c);
      this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${enc(s)}) Tj ET`);
    }
    image(name, x, y, w, h) { this.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${name} Do Q`); }
  }

  async function logoJpeg() {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'icons/griffin-logo.png'; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.fillStyle = '#191933'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0);
    const b64 = c.toDataURL('image/jpeg', 0.92).split(',')[1];
    return { bin: atob(b64), w: c.width, h: c.height };
  }

  function assemble(doc, logo, footer) {
    const objs = [];
    const add = (s) => { objs.push(s); return objs.length; };
    const cat = add(''), pagesId = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const im = logo ? add(`<< /Type /XObject /Subtype /Image /Width ${logo.w} /Height ${logo.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.bin.length} >>\nstream\n${logo.bin}\nendstream`) : 0;
    const kids = [];
    doc.pages.forEach((ops, i) => {
      const f = footer(i + 1, doc.pages.length);
      const body = ops.concat(f).join('\n');
      const cs = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${cs} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${im ? ` /XObject << /Logo ${im} 0 R >>` : ''} >> >>`));
    });
    objs[cat - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  // data: { address, postcode, sub, from, date, note, tiles:[{k,v,s}], sections:[{title, lines[], table?}], disclaimer }
  async function build(data) {
    let logo = null;
    // Never let the logo hold the PDF up (a slow phone or a background tab): give up after 4 seconds.
    try { logo = await Promise.race([logoJpeg(), new Promise((res) => setTimeout(() => res(null), 4000))]); } catch (e) { /* the header still works without it */ }
    const d = new Doc();
    const FOOT = 70;
    const header = (first) => {
      const hh = first ? 92 : 50;
      d.rect(0, H - hh, W, hh, NAVY);
      d.rect(0, H - hh - 4, W, 4, RED);
      if (logo) { const lh = first ? 46 : 28, lw = lh * logo.w / logo.h; d.image('Logo', M, H - hh / 2 - lh / 2, lw, lh); }
      d.text(W - M, H - hh / 2 + (first ? 4 : -3), 'MARKET APPRAISAL', first ? 12 : 9, { bold: true, c: [1, 1, 1], align: 'right' });
      if (first) d.text(W - M, H - hh / 2 - 12, data.date, 9, { c: [0.85, 0.85, 0.9], align: 'right' });
      d.y = H - hh - 4 - 28;
    };
    const need = (h) => { if (d.y - h < FOOT) { d.newPage(); header(false); } };
    header(true);

    d.text(M, d.y, data.address, 22, { bold: true, c: NAVY }); d.y -= 18;
    d.text(M, d.y, data.sub, 11, { c: GREY }); d.y -= 15;
    d.text(M, d.y, `Prepared by ${data.from}`, 10, { c: GREY }); d.y -= 22;

    if (data.note) {
      const ls = wrap(data.note, 10.5, false, W - 2 * M - 24);
      const bh = ls.length * 14 + 18;
      need(bh);
      d.rect(M, d.y - bh + 10, W - 2 * M, bh, CARD);
      d.rect(M, d.y - bh + 10, 4, bh, RED);
      ls.forEach((l, i) => d.text(M + 16, d.y - 6 - i * 14, l, 10.5));
      d.y -= bh + 10;
    }

    if (data.tiles.length) {
      const n = data.tiles.length, gap = 10, tw = (W - 2 * M - gap * (n - 1)) / n, th = 74;
      need(th + 10);
      data.tiles.forEach((t, i) => {
        const x = M + i * (tw + gap);
        d.rect(x, d.y - th, tw, th, CARD);
        d.rect(x, d.y - 3, tw, 3, i === 0 ? RED : NAVY);
        d.text(x + 10, d.y - 18, t.k.toUpperCase(), 7.5, { bold: true, c: GREY });
        let size = 17; while (width(clean(t.v), size, true) > tw - 20 && size > 10) size -= 1;
        d.text(x + 10, d.y - 42, t.v, size, { bold: true, c: i === 0 ? RED : NAVY });
        wrap(t.s || '', 8, false, tw - 20).slice(0, 2).forEach((l, j) => d.text(x + 10, d.y - 56 - j * 10, l, 8, { c: GREY }));
      });
      d.y -= th + 22;
    }

    for (const s of data.sections) {
      need(48);
      d.text(M, d.y, s.title, 13, { bold: true, c: NAVY }); d.y -= 6;
      d.rect(M, d.y, 36, 2.5, RED); d.y -= 16;
      if (s.table) {
        const cols = s.table.cols, rows = s.table.rows;
        const xs = []; let x = M; for (const c of cols) { xs.push(x); x += c.w * (W - 2 * M); }
        need(18);
        cols.forEach((c, i) => d.text(c.right ? xs[i] + c.w * (W - 2 * M) - 4 : xs[i] + 4, d.y, c.h, 8, { bold: true, c: GREY, align: c.right ? 'right' : undefined }));
        d.y -= 6; d.line(M, d.y, W - M, d.y, LINE); d.y -= 13;
        for (const r of rows) {
          need(17);
          if (r.hi) d.rect(M, d.y - 5, W - 2 * M, 16, [1, 0.94, 0.94]);
          r.cells.forEach((v, i) => {
            const c = cols[i]; let t = clean(v), sz = 9.5;
            while (width(t, sz, i === 0) > c.w * (W - 2 * M) - 8 && t.length > 4) t = t.slice(0, -2) + '…';
            d.text(c.right ? xs[i] + c.w * (W - 2 * M) - 4 : xs[i] + 4, d.y, t.replace('……', '…'), sz, { bold: i === 0 || r.hi, c: r.hi ? RED : BLACK, align: c.right ? 'right' : undefined });
          });
          d.y -= 6; d.line(M, d.y, W - M, d.y, LINE, 0.3); d.y -= 11;
        }
        d.y -= 4;
      }
      for (const raw of s.lines || []) {
        const bullet = /^•\s*/.test(raw);
        const ls = wrap(raw.replace(/^•\s*/, ''), 10.5, false, W - 2 * M - (bullet ? 14 : 0));
        need(ls.length * 14 + 2);
        ls.forEach((l, i) => {
          if (bullet && i === 0) d.text(M + 2, d.y, '•', 10.5, { c: RED, bold: true });
          d.text(M + (bullet ? 14 : 0), d.y, l, 10.5); d.y -= 14;
        });
        d.y -= 2;
      }
      d.y -= 14;
    }

    const footLines = wrap(data.disclaimer, 7, false, W - 2 * M - 140);
    const footer = (p, n) => {
      const f = new Doc(); f.ops = [];
      f.line(M, FOOT - 8, W - M, FOOT - 8, LINE);
      footLines.slice(0, 4).forEach((l, i) => f.text(M, FOOT - 20 - i * 9, l, 7, { c: GREY }));
      f.text(W - M, FOOT - 20, `Page ${p} of ${n}`, 7.5, { c: GREY, align: 'right' });
      f.text(W - M, FOOT - 30, 'Griffin, the property people', 7.5, { bold: true, c: NAVY, align: 'right' });
      return f.ops;
    };
    return assemble(d, logo, footer);
  }
  return { build };
})();
