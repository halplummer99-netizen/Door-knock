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
    constructor() { this.pages = []; this.links = []; this.newPage(); }
    newPage() { this.ops = []; this.pages.push(this.ops); this.pageLinks = []; this.links.push(this.pageLinks); this.y = H - M; }
    link(x, y, w, h, url) { if (url) this.pageLinks.push({ x, y, w, h, url }); }
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
    const esc = (u) => u.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    doc.pages.forEach((ops, i) => {
      const annots = (doc.links[i] || []).map((l) => add(`<< /Type /Annot /Subtype /Link /Rect [${l.x.toFixed(2)} ${l.y.toFixed(2)} ${(l.x + l.w).toFixed(2)} ${(l.y + l.h).toFixed(2)}] /Border [0 0 0] /A << /S /URI /URI (${esc(l.url)}) >> >>`));
      const f = footer(i + 1, doc.pages.length);
      const body = ops.concat(f).join('\n');
      const cs = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${cs} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${im ? ` /XObject << /Logo ${im} 0 R >>` : ''} >>${annots.length ? ` /Annots [${annots.map((a) => a + ' 0 R').join(' ')}]` : ''} >>`));
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
    function buttonRow(btns) {
      const bh = 24, gap = 8;
      let x = M;
      need(bh + 10);
      for (const b of btns) {
        const bw = width(clean(b.label), 9.5, true) + 26;
        if (x + bw > W - M) { x = M; d.y -= bh + gap; }
        d.rect(x, d.y - bh, bw, bh, NAVY);
        d.text(x + bw / 2, d.y - bh + 8.5, b.label, 9.5, { bold: true, c: [1, 1, 1], align: 'center' });
        d.link(x, d.y - bh, bw, bh, b.url);
        x += bw + gap;
      }
      d.y -= bh + 20;
    }
    // Rightmove "who sees your home": each search band as a bar, lit if the price is inside it.
    function ladderGraphic(L) {
      const cols = L.showRaw ? [{ t: 'Priced at ' + money(L.raw), k: 'a' }, { t: L.label, k: 'b' }] : [{ t: L.label, k: 'b' }];
      const cw = (W - 2 * M - (cols.length - 1) * 14) / cols.length, rh = 22;
      const h = 22 + L.bands.length * (rh + 5) + 20;
      need(h);
      const top = d.y;
      cols.forEach((c, ci) => {
        const x = M + ci * (cw + 14);
        d.text(x, top, c.t, 10, { bold: true, c: ci === cols.length - 1 ? RED : NAVY });
        let y = top - 14;
        let seen = 0;
        for (const b of L.bands.slice().reverse()) {
          const on = b[c.k];
          if (on) seen++;
          d.rect(x, y - rh, cw, rh, on ? (ci === cols.length - 1 ? RED : NAVY) : CARD);
          d.text(x + 10, y - rh + 7.5, `Buyers searching ${money(b.min)} – ${money(b.max)}`, 8.5, { bold: on, c: on ? [1, 1, 1] : GREY });
          d.text(x + cw - 10, y - rh + 7.5, on ? 'SEES IT' : 'misses it', 8, { bold: true, c: on ? [1, 1, 1] : GREY, align: 'right' });
          y -= rh + 5;
        }
        d.text(x, y - 8, `Seen by ${seen} of ${L.bands.length} search bands`, 9, { bold: true, c: ci === cols.length - 1 ? RED : GREY });
      });
      d.y = top - h - 4;
    }
    const money = (n) => '£' + Math.round(n).toLocaleString('en-GB');
    const kfmt = (n) => '£' + Math.round(n / 1000) + 'k';
    // Simple vector charts in Griffin colours.
    function chart(c) {
      const ch = 150, cw = W - 2 * M, padL = 46, padB = 22, padT = 18;
      need(ch + 16);
      const top = d.y, x0 = M + padL, y0 = top - ch + padB, pw = cw - padL - 8, ph = ch - padB - padT;
      d.text(M, top, c.title, 10, { bold: true, c: NAVY });
      if (c.type === 'bars') {
        const vals = c.items.map((i) => i.v).concat(c.ref ? [c.ref.v] : []);
        const max = Math.max(1, ...vals) * 1.12, min = 0, pre = c.fmt == null ? '£' : c.fmt;
        const n = c.items.length, bw = Math.min(46, (pw / n) * 0.62);
        d.line(x0, y0, x0 + pw, y0, LINE);
        c.items.forEach((it, i) => {
          const cx = x0 + (pw / n) * (i + 0.5), bh = ((it.v - min) / (max - min)) * ph;
          d.rect(cx - bw / 2, y0, bw, Math.max(bh, 0.5), it.red ? RED : NAVY);
          d.text(cx, y0 + bh + 3, pre + it.v, pre ? 8 : 11, { bold: true, c: it.red ? RED : NAVY, align: 'center' });
          d.text(cx, y0 - 11, it.label.length > 16 ? it.label.slice(0, 15) + '…' : it.label, 7, { c: GREY, align: 'center' });
        });
        if (c.note) d.text(W - M, top, c.note, 8, { bold: true, c: NAVY, align: 'right' });
        if (c.ref) { const ry = y0 + ((c.ref.v - min) / (max - min)) * ph; d.line(x0, ry, x0 + pw, ry, RED, 1.4); d.text(W - M, top, 'Red line = ' + c.ref.label + ' per sq ft', 7.5, { bold: true, c: RED, align: 'right' }); }
      } else {
        const ts = c.pts.map((p) => new Date(p.t).getTime());
        const ps = c.pts.map((p) => p.p).concat(c.line ? [c.line.v] : []);
        const t0 = Math.min(...ts), t1 = Math.max(Date.now(), ...ts);
        let p0 = Math.min(...ps) * 0.9, p1 = Math.max(...ps) * 1.06;
        const X = (t) => x0 + ((t - t0) / (t1 - t0 || 1)) * pw, Y = (p) => y0 + ((p - p0) / (p1 - p0 || 1)) * ph;
        d.line(x0, y0, x0 + pw, y0, LINE); d.line(x0, y0, x0, y0 + ph, LINE);
        for (let k = 0; k <= 3; k++) { const v = p0 + ((p1 - p0) * k) / 3; d.text(x0 - 5, Y(v) - 3, kfmt(v), 7, { c: GREY, align: 'right' }); if (k) d.line(x0, Y(v), x0 + pw, Y(v), CARD, 0.4); }
        const y0yr = new Date(t0).getFullYear(), y1yr = new Date(t1).getFullYear();
        for (let yr = y0yr; yr <= y1yr; yr += Math.max(1, Math.ceil((y1yr - y0yr) / 6))) { const t = new Date(yr + '-06-30').getTime(); if (t >= t0 && t <= t1) d.text(X(t), y0 - 11, String(yr), 7, { c: GREY, align: 'center' }); }
        if (c.line) { const ly = Y(c.line.v); d.line(x0, ly, x0 + pw, ly, RED, 1.2); d.text(x0 + pw, ly + 3, `${c.line.label} ${money(c.line.v)}`, 7.5, { bold: true, c: RED, align: 'right' }); }
        for (const p of c.pts) { const s = p.me ? 7 : 4.5; d.rect(X(new Date(p.t).getTime()) - s / 2, Y(p.p) - s / 2, s, s, p.me ? RED : NAVY); }
        if (c.pts.some((p) => p.me)) d.text(W - M, top, 'Red = this home   Navy = other sales on the street', 7.5, { c: GREY, align: 'right' });
      }
      d.y = top - ch - 14;
    }
    header(true);

    d.text(M, d.y, data.address, 22, { bold: true, c: NAVY }); d.y -= 18;
    d.text(M, d.y, data.sub, 11, { c: GREY }); d.y -= 15;
    d.text(M, d.y, `Prepared by ${data.from}`, 10, { c: GREY }); d.y -= 22;
    if (data.buttons && data.buttons.length) buttonRow(data.buttons);

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

    function bigButton(b) {
      const bh = 40;
      need(bh + 14);
      d.rect(M, d.y - bh, W - 2 * M, bh, RED);
      d.text(W / 2, d.y - bh / 2 - 5, b.label, 15, { bold: true, c: [1, 1, 1], align: 'center' });
      d.link(M, d.y - bh, W - 2 * M, bh, b.url);
      d.y -= bh + 20;
    }
    if (data.instruct) bigButton(data.instruct);
    for (const s of data.sections) {
      need(48);
      d.text(M, d.y, s.title, 13, { bold: true, c: NAVY }); d.y -= 6;
      d.rect(M, d.y, 36, 2.5, RED); d.y -= 16;
      if (s.ladder) ladderGraphic(s.ladder);
      if (s.chart) chart(s.chart);
      if (s.table) {
        const cols = s.table.cols, rows = s.table.rows;
        const xs = []; let x = M; for (const c of cols) { xs.push(x); x += c.w * (W - 2 * M); }
        need(18);
        cols.forEach((c, i) => d.text(c.right ? xs[i] + c.w * (W - 2 * M) - 4 : xs[i] + 4, d.y, c.h, 8, { bold: true, c: GREY, align: c.right ? 'right' : undefined }));
        d.y -= 6; d.line(M, d.y, W - M, d.y, LINE); d.y -= 13;
        for (const r of rows) {
          need(17);
          if (r.hi) d.rect(M, d.y - 5, W - 2 * M, 16, [1, 0.94, 0.94]);
          if (r.link) d.link(M, d.y - 5, W - 2 * M, 16, r.link);
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

    if (data.instruct) { need(120); d.text(M, d.y, 'Ready to go ahead?', 13, { bold: true, c: NAVY }); d.y -= 6; d.rect(M, d.y, 36, 2.5, RED); d.y -= 14; bigButton(data.instruct); }
    if (data.buttons && data.buttons.length) { need(70); d.text(M, d.y, 'Any questions? Get in touch', 13, { bold: true, c: NAVY }); d.y -= 6; d.rect(M, d.y, 36, 2.5, RED); d.y -= 14; buttonRow(data.buttons); }
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
