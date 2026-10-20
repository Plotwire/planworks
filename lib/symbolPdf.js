/* ============================================================================
 * symbolPdf.js — draw a 32-unit symbol as TRUE VECTOR into a pdf-lib page.
 * ========================================================================= */

const BOX = 48; // symbol viewBox is 0 0 48 48 (matches lib/symbols.jsx)

function primToPath(p) {
  switch (p.kind) {
    case "path":
      return p.d;
    case "line":
      return `M ${p.x1} ${p.y1} L ${p.x2} ${p.y2}`;
    case "rect": {
      const { x, y, w, h } = p;
      let rx = Math.abs(p.rx || 0), ry = Math.abs(p.ry || 0);
      if (rx && !ry) ry = rx;
      if (ry && !rx) rx = ry;
      rx = Math.min(rx, Math.abs(w) / 2);
      ry = Math.min(ry, Math.abs(h) / 2);
      if (!rx || !ry) return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
      return (
        `M ${x + rx} ${y}` +
        ` h ${w - 2 * rx}` +
        ` a ${rx} ${ry} 0 0 1 ${rx} ${ry}` +
        ` v ${h - 2 * ry}` +
        ` a ${rx} ${ry} 0 0 1 ${-rx} ${ry}` +
        ` h ${-(w - 2 * rx)}` +
        ` a ${rx} ${ry} 0 0 1 ${-rx} ${-ry}` +
        ` v ${-(h - 2 * ry)}` +
        ` a ${rx} ${ry} 0 0 1 ${rx} ${-ry}` +
        ` Z`
      );
    }
    case "circle": {
      const { cx, cy, r } = p;
      return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
    }
    case "polyline":
    case "polygon": {
      const pts = p.points;
      if (!pts || !pts.length) return "";
      let d = `M ${pts[0][0]} ${pts[0][1]}`;
      for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0]} ${pts[i][1]}`;
      if (p.kind === "polygon") d += " Z";
      return d;
    }
    default:
      return "";
  }
}

// flip: a mirror copy (lib/planMirror) -- its shapes reflected across the
// symbol's own upright axis through its centre, its text drawn the right way
// round at the mirrored spot, as on screen (components/SheetParts symbolGlyph).
// Needs pdf-lib's pushGraphicsState, popGraphicsState and
// concatTransformationMatrix in PDFLib.
export function drawSymbol(page, opts, PDFLib) {
  const { prims, cx, cy, size, rotationDeg = 0, flip = false } = opts;
  const { rgb, degrees, font, fontBold, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = PDFLib;
  const mirrored = Boolean(flip && pushGraphicsState && popGraphicsState && concatTransformationMatrix);
  const k = size / BOX;

  const theta = (-rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta), sin = Math.sin(theta);

  const ox = -(BOX / 2) * k;
  const oy = (BOX / 2) * k;
  const anchorX = cx + (ox * cos - oy * sin);
  const anchorY = cy + (ox * sin + oy * cos);

  /* Symbol space is the 48-unit viewBox, y DOWN. PDF space is y UP. Map a
     point through the same placement the shapes get: scale, flip y, rotate,
     then offset from the anchor. drawSvgPath does this internally for paths;
     text has to be positioned explicitly, so it is done here by hand. */
  const toPage = (px, py) => {
    const tx = px * k, ty = -py * k;
    return { x: anchorX + (tx * cos - ty * sin), y: anchorY + (tx * sin + ty * cos) };
  };

  if (mirrored) {
    // The symbol's upright axis on the page, and the reflection across it.
    const ux = sin, uy = -cos;
    const a = 2 * ux * ux - 1, b = 2 * ux * uy, c = b, d = 2 * uy * uy - 1;
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(a, b, c, d, cx - a * cx - c * cy, cy - b * cx - d * cy));
  }
  for (const p of prims) {
    if (p.kind === "text") {
      if (!mirrored) drawGlyphText(page, p, { toPage, k, cos, sin, rotationDeg, rgb, degrees, font, fontBold });
      continue;
    }

    const d = primToPath(p);
    if (!d) continue;

    const draw = { x: anchorX, y: anchorY, scale: k, rotate: degrees(-rotationDeg) };

    const fill = p.fill && p.fill !== "none" ? p.fill : null;
    const stroke = p.stroke && p.stroke !== "none" ? p.stroke : null;

    if (fill) {
      draw.color = toRgb(fill, rgb);
      if (p.fillOpacity != null && p.fillOpacity < 1) draw.opacity = p.fillOpacity;
    }
    if (stroke) {
      draw.borderColor = toRgb(stroke, rgb);
      draw.borderWidth = (p.strokeWidth ?? 1.5) * k;
      if (p.strokeOpacity != null && p.strokeOpacity < 1) draw.borderOpacity = p.strokeOpacity;
      if (p.strokeDasharray) draw.borderDashArray = p.strokeDasharray.map((n) => n * k);
    }
    if (!fill && !stroke) continue;

    page.drawSvgPath(d, draw);
  }
  if (mirrored) {
    page.pushOperators(popGraphicsState());
    const swap = { start: "end", end: "start" };
    for (const p of prims) {
      if (p.kind !== "text") continue;
      const anchor = p.anchor || "start";
      drawGlyphText(page, { ...p, x: BOX - p.x, anchor: swap[anchor] || anchor }, { toPage, k, cos, sin, rotationDeg, rgb, degrees, font, fontBold });
    }
  }
}

export function toRgb(hex, rgb) {
  let h = (hex || "#000000").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}



/* ----------------------------------------------------------------------------
 * Text inside a symbol -- the "2" on a 2-gang switch, "FCU", the detector
 * letters. 32 of the 65 symbols carry one, and every one of them was silently
 * missing from exported PDFs: the glyph walker never collected <text> and this
 * file had no case for it, so they were dropped twice over.
 *
 * The symbols set no dominant-baseline, so the SVG y IS the baseline -- which
 * is what pdf-lib's drawText expects too, and no baseline correction is needed.
 * text-anchor does need handling: pdf-lib always draws from the left of the
 * string, so middle/end shift the origin back along the text's own direction,
 * which under rotation is the rotated axis rather than the page's.
 * -------------------------------------------------------------------------- */
function drawGlyphText(page, p, ctx) {
  const { toPage, k, cos, sin, rotationDeg, rgb, degrees, font, fontBold } = ctx;
  const str = (p.text || "").trim();
  if (!str) return;

  const face = (p.bold && fontBold) || font;
  if (!face) return;   // no font embedded: draw nothing rather than throw

  const size = (p.fontSize || 6) * k;
  const { x, y } = toPage(p.x, p.y);

  // Shift the origin for the anchor, along the direction the text runs.
  let shift = 0;
  if (p.anchor === "middle" || p.anchor === "end") {
    const w = face.widthOfTextAtSize(str, size);
    shift = p.anchor === "middle" ? -w / 2 : -w;
  }

  page.drawText(str, {
    x: x + shift * cos,
    y: y + shift * sin,
    size,
    font: face,
    color: toRgb(p.fill || "#000000", rgb),
    rotate: degrees(-rotationDeg),
    ...(p.fillOpacity != null && p.fillOpacity < 1 ? { opacity: p.fillOpacity } : null),
  });
}
