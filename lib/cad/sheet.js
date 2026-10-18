/* ============================================================================
 * lib/cad/sheet.js - the A3 sheet the electrical editor draws on.
 *
 * Pure values only - no React, no DOM. One copy for the editor
 * (components/ElectricalPlanTool.jsx, components/SheetParts.jsx) and the
 * sketch's true-scale plan export (lib/cad/planScale). The dashboard
 * thumbnails (components/HomeScreen.jsx) keep their own copy.
 *
 * Sheet units are CSS px at 96 dpi: A3 landscape, 420 x 297 mm, drawn
 * 1587 x 1123. Symbols, notes and the editor's walls are stored in DRAW
 * space: sheet units from the drawing area's top-left corner.
 * ========================================================================= */

export const SHEET = {
  width: 1587,   // 420mm at 96dpi  (≈ 16.5")
  height: 1123,  // 297mm at 96dpi
  margin: 18,
  legendWidth: 230,
  notesWidth: 280,
  titleHeight: 110,
};

// The paper the sheet prints on (mm).
export const PAPER_MM = { w: 420, h: 297 };

// The drawing area: the middle of the sheet, between the legend and notes
// columns and above the title block.
export const DRAW = {
  x: SHEET.margin + SHEET.legendWidth + 8,
  y: SHEET.margin,
  w: SHEET.width - SHEET.margin * 2 - SHEET.legendWidth - SHEET.notesWidth - 16,
  h: SHEET.height - SHEET.margin * 2 - SHEET.titleHeight - 8,
};

/* Where the plan sits inside the drawing area: scaled to fit (contain) and
 * centred. Returns { x, y, w, h } in CSS px, relative to DRAW's top-left.
 *
 * The editor, the print page and the PDF export all place the plan with this
 * one function. Symbols are positioned in the same DRAW space, so sharing it
 * is what keeps them on the right wall line in all three. */
export function planFootprint(DRAW, w, h) {
  const scale = Math.min(DRAW.w / w, DRAW.h / h);
  const fw = w * scale;
  const fh = h * scale;
  return { x: (DRAW.w - fw) / 2, y: (DRAW.h - fh) / 2, w: fw, h: fh };
}

// Sheet units per mm of paper, along each side. The sheet is 1587 x 1123 for
// 420 x 297 mm, so the two differ by 0.07%: a length meant to print true has
// to use the one for its own direction.
export const SHEET_PX_PER_MM = { x: SHEET.width / PAPER_MM.w, y: SHEET.height / PAPER_MM.h };

/* Where an imported plan sits in the drawing area, { x, y, w, h } as
 * planFootprint. A PDF plan given a true scale (lib/planCrop: the original
 * drawing's scale, drawingScale, and the scale it prints at on this sheet,
 * sheetScale) is sized exactly to that scale and centred -- not stretched to
 * fill. Everything else, or a true-scale plan that would no longer fit, is
 * fitted as before. The editor, the print page and the PDF export all place
 * the plan with this. */
export function planBox(DRAW, bg) {
  const m = bg && bg.cropMm;
  if (m && m.w > 0 && m.h > 0 && bg.drawingScale > 0 && bg.sheetScale > 0) {
    const f = bg.drawingScale / bg.sheetScale; // paper mm here per paper mm there
    const fw = m.w * f * SHEET_PX_PER_MM.x, fh = m.h * f * SHEET_PX_PER_MM.y;
    if (fw <= DRAW.w + 0.5 && fh <= DRAW.h + 0.5) return { x: (DRAW.w - fw) / 2, y: (DRAW.h - fh) / 2, w: fw, h: fh };
  }
  return planFootprint(DRAW, bg.w, bg.h);
}
