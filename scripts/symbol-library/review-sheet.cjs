// The Symbol Library review sheet: every symbol by category, with its name and
// legend code, on A3 landscape. Symbols are drawn as vectors with the app's
// own PDF symbol code (lib/symbolPdf.js), so the sheet shows them as an
// exported drawing would.
//   node scripts/symbol-library/review-sheet.cjs [out.pdf]
//   node scripts/symbol-library/review-sheet.cjs --proof [category-key] [out.pdf]
//     (large proof of the new symbols, for checking drawings)
const path = require("path");
const fs = require("fs");
const { PDFDocument, StandardFonts, rgb, degrees } = require("pdf-lib");
const L = require("./load.cjs");
const { toPrims } = require("./prims.cjs");

const S = L.symbols();
const { drawSymbol } = L.symbolPdf();

const args = process.argv.slice(2);
const proof = args[0] === "--proof";
const proofCat = proof && args[1] && !args[1].endsWith(".pdf") ? args[1] : null;
const outArg = args.find((a) => a.endsWith(".pdf"));
const OUT = path.resolve(L.ROOT, outArg || path.join("Claude outputs", proof ? "symbol-library-proof.pdf" : "symbol-library-review.pdf"));

const A3 = [1190.55, 841.89];
const M = 28;
const TEAL = rgb(0.173, 0.592, 0.659), NAVY = rgb(0.102, 0.145, 0.188), GREY = rgb(0.45, 0.5, 0.55), LINE = rgb(0.84, 0.87, 0.89), PAPER = rgb(1, 1, 1);
const hex = (h) => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

// Standard PDF fonts only know WinAnsi; keep the odd character printable.
const safe = (s) => String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/[^\x20-\x7e -ÿ–—]/g, "?");

function wrap(text, font, size, width, maxLines) {
  const words = safe(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(t, size) <= width) cur = t;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    let last = keep[maxLines - 1];
    while (last.length && font.widthOfTextAtSize(last + "...", size) > width) last = last.slice(0, -1);
    keep[maxLines - 1] = last + "...";
    return keep;
  }
  return lines;
}

(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const originalIds = new Set(Object.values(S.SYMBOLS).flatMap((g) => g.items.map((i) => i.id)));

  const cats = S.LIBRARY_CATEGORIES
    .filter((c) => !proofCat || c.key === proofCat)
    .map((c) => ({ ...c, items: S.CATALOGUE.filter((s) => s.category === c.key && (!proof || !originalIds.has(s.id))) }))
    .filter((c) => c.items.length);
  const total = S.CATALOGUE.length, nNew = S.CATALOGUE.filter((s) => !originalIds.has(s.id)).length;
  const nDraft = S.CATALOGUE.filter((s) => s.draft).length;

  const cellW = proof ? 112 : 70, cellH = proof ? 118 : 66, glyph = proof ? 72 : 32;
  const cols = Math.floor((A3[0] - 2 * M) / cellW);
  const gridX = (A3[0] - cols * cellW) / 2;
  const headH = proof ? 40 : 62, catH = 18;
  const pages = [];
  let page, y;

  const newPage = () => {
    page = doc.addPage(A3);
    pages.push(page);
    page.drawRectangle({ x: 0, y: 0, width: A3[0], height: A3[1], color: PAPER });
    const top = A3[1] - M;
    page.drawText(proof ? "Symbol Library - drawing proof (new symbols)" : "Plotwire Symbol Library - review sheet", { x: M, y: top - 16, size: 16, font: bold, color: NAVY });
    if (!proof) {
      page.drawText(safe(`${total} symbols by category: ${total - nNew} existing (as used today, unchanged) and ${nNew} new, drawn in-house${nDraft ? `, ${nDraft} of them DRAFT (hidden from users until approved)` : ""}.`), { x: M, y: top - 33, size: 8.5, font, color: GREY });
      page.drawText("Each symbol shows its legend code (bold) and name. Drawn as vectors with the app's own PDF export code, in screen colours.", { x: M, y: top - 45, size: 8.5, font, color: GREY });
      // Key
      const kx = A3[0] - M - 210;
      page.drawRectangle({ x: kx, y: top - 36, width: 26, height: 11, color: TEAL });
      page.drawText("NEW", { x: kx + 5.5, y: top - 33, size: 7, font: bold, color: PAPER });
      page.drawText(nDraft ? "= new symbol, draft for approval" : "= new symbol", { x: kx + 32, y: top - 33, size: 8, font, color: NAVY });
    }
    y = top - headH;
  };

  newPage();
  if (!proof) {
    // Review sheet: newspaper columns, one line per symbol (drawing, code,
    // name), categories flowing on, so every symbol fits on two A3 pages
    // (one sheet printed both sides).
    const NCOL = 6, GAP = 10, rowH = 23, glyphR = 20.5, bandH = 15, bottom = M + 12;
    const colW = (A3[0] - 2 * M - (NCOL - 1) * GAP) / NCOL;
    let col = 0, top0 = y;
    const colX = () => M + col * (colW + GAP);
    const fit = (text, f, size, width) => {
      let t = safe(text);
      if (f.widthOfTextAtSize(t, size) <= width) return t;
      while (t.length && f.widthOfTextAtSize(t + "...", size) > width) t = t.slice(0, -1);
      return t + "...";
    };
    const nextCol = (cont) => {
      col++;
      if (col >= NCOL) { newPage(); col = 0; top0 = y; }
      y = top0;
      if (cont) { page.drawText(fit(cont + " (continued)", bold, 7, colW), { x: colX(), y: y - 9, size: 7, font: bold, color: NAVY }); y -= 13; }
    };
    for (const c of cats) {
      if (y - bandH - rowH < bottom) nextCol();
      const nOrig = c.items.filter((s) => originalIds.has(s.id)).length;
      page.drawRectangle({ x: colX(), y: y - bandH, width: colW, height: bandH, color: NAVY });
      page.drawText(fit(c.label.toUpperCase(), bold, 7.5, colW - 60), { x: colX() + 6, y: y - bandH + 5, size: 7.5, font: bold, color: PAPER });
      const note = `${nOrig} + ${c.items.length - nOrig} new`;
      page.drawText(note, { x: colX() + colW - 6 - font.widthOfTextAtSize(note, 6.5), y: y - bandH + 5.2, size: 6.5, font, color: rgb(0.75, 0.82, 0.86) });
      y -= bandH + 2;
      for (const s of c.items) {
        if (y - rowH < bottom) nextCol(c.label);
        const x = colX();
        page.drawLine({ start: { x, y: y - rowH }, end: { x: x + colW, y: y - rowH }, thickness: 0.4, color: LINE });
        const { prims } = toPrims(s.svg, S.resolveColours(s.id, "colour"));
        drawSymbol(page, { prims, cx: x + 2 + glyphR / 2, cy: y - rowH / 2, size: glyphR, rotationDeg: 0 }, { rgb, degrees, font, fontBold: bold });
        const isNew = !originalIds.has(s.id);
        page.drawText(safe(s.code), { x: x + 28, y: y - 9.5, size: 7, font: bold, color: NAVY });
        if (isNew) {
          page.drawRectangle({ x: x + colW - 19, y: y - 10.5, width: 18, height: 7.5, color: TEAL });
          page.drawText("NEW", { x: x + colW - 16.3, y: y - 8.7, size: 5.2, font: bold, color: PAPER });
        }
        page.drawText(fit(s.name, font, 6.2, colW - 30), { x: x + 28, y: y - 18, size: 6.2, font, color: GREY });
        y -= rowH;
      }
      y -= 6;
    }
  }
  for (const c of proof ? cats : []) {
    const rows = Math.ceil(c.items.length / cols);
    if (y - catH - cellH < M + 14) newPage();
    const nOrig = c.items.filter((s) => originalIds.has(s.id)).length;
    page.drawRectangle({ x: gridX, y: y - catH, width: cols * cellW, height: catH, color: NAVY });
    page.drawText(safe(c.label.toUpperCase()), { x: gridX + 8, y: y - catH + 5.5, size: 9.5, font: bold, color: PAPER });
    const note = proof ? `${c.items.length} new` : `${nOrig} existing, ${c.items.length - nOrig} new`;
    page.drawText(note, { x: gridX + cols * cellW - 8 - font.widthOfTextAtSize(note, 8), y: y - catH + 6, size: 8, font, color: rgb(0.75, 0.82, 0.86) });
    y -= catH;
    for (let r = 0; r < rows; r++) {
      if (y - cellH < M + 14) {
        newPage();
        page.drawText(safe(c.label + " (continued)"), { x: gridX, y: y - 11, size: 8.5, font: bold, color: NAVY });
        y -= 16;
      }
      for (let k = 0; k < cols; k++) {
        const s = c.items[r * cols + k];
        if (!s) break;
        const x = gridX + k * cellW, top = y;
        page.drawRectangle({ x, y: top - cellH, width: cellW, height: cellH, borderColor: LINE, borderWidth: 0.5 });
        const cols_ = S.resolveColours(s.id, "colour");
        const { prims } = toPrims(s.svg, cols_);
        drawSymbol(page, { prims, cx: x + cellW / 2, cy: top - 4 - glyph / 2, size: glyph, rotationDeg: 0 }, { rgb, degrees, font, fontBold: bold });
        const codeSize = proof ? 9 : 7;
        const code = safe(s.code);
        page.drawText(code, { x: x + (cellW - bold.widthOfTextAtSize(code, codeSize)) / 2, y: top - glyph - 13, size: codeSize, font: bold, color: NAVY });
        const nameSize = proof ? 7 : 5.6;
        wrap(s.name, font, nameSize, cellW - 6, proof ? 3 : 2).forEach((ln, i) => {
          page.drawText(ln, { x: x + (cellW - font.widthOfTextAtSize(ln, nameSize)) / 2, y: top - glyph - 21 - i * (nameSize + 1.4), size: nameSize, font, color: GREY });
        });
        if (proof) page.drawText(safe(s.id), { x: x + 3, y: top - cellH + 3, size: 5.5, font, color: rgb(0.65, 0.68, 0.7) });
        if (!originalIds.has(s.id) && !proof) {
          page.drawRectangle({ x: x + cellW - 21, y: top - 10, width: 19, height: 8, color: TEAL });
          page.drawText("NEW", { x: x + cellW - 18.3, y: top - 8, size: 5.5, font: bold, color: PAPER });
        }
      }
      y -= cellH;
    }
    y -= 8;
  }
  pages.forEach((p, i) => {
    const t = `Page ${i + 1} of ${pages.length}`;
    p.drawText(t, { x: A3[0] - M - font.widthOfTextAtSize(t, 8), y: M - 10, size: 8, font, color: GREY });
    if (!proof) p.drawText("Plotwire - in-house symbol drawings, UK layout conventions. Not for construction until approved.", { x: M, y: M - 10, size: 8, font, color: GREY });
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, await doc.save());
  console.log(`${OUT} (${pages.length} page${pages.length === 1 ? "" : "s"}, ${cats.reduce((n, c) => n + c.items.length, 0)} symbols)`);
})().catch((e) => { console.error(e); process.exit(1); });
