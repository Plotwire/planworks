/* ============================================================================
 * wireStrength.js -- how the switch-to-light link lines ("wires") draw.
 *
 * A drawing's Wire lines setting (View menu): Light, Standard or Bold. It only
 * changes how dark and thick the dashed lines are; the wires themselves (what
 * connects to what) are never touched.
 *
 * Standard is the line as it has been since 6 Oct 2026: a 55% tint of the line
 * colour, 0.8 units wide, 4/3 dashes. Saved on the drawing as
 * project.wireStrength, but only when it isn't Standard: drawings saved
 * before this setting existed have no field, and draw exactly as before.
 *
 * Sizes are sheet units; the sheet prints at A3 (1 unit = 0.265 mm). The
 * editor and the print sheet both draw with wireStyle(), and the PDF overlay
 * is captured from the print sheet, so screen, print and PDF match.
 * ========================================================================= */

export const WIRE_STRENGTHS = [
  { value: "light", label: "Light" },
  { value: "standard", label: "Standard" },
  { value: "bold", label: "Bold" },
];
export const DEFAULT_WIRE_STRENGTH = "standard";

export const normaliseWireStrength = (v) =>
  WIRE_STRENGTHS.some((s) => s.value === v) ? v : DEFAULT_WIRE_STRENGTH;

// The project field for a strength: none for Standard, so a drawing set back
// to Standard is stored exactly like one that was never changed.
export function wireStrengthField(v) {
  const s = normaliseWireStrength(v);
  return s === DEFAULT_WIRE_STRENGTH ? {} : { wireStrength: s };
}

// Colours are tints of the full line colour mixed with white (not opacity, so
// crossing lines don't darken where they overlap, and every printer shows the
// same). Full colour: red #dc2626, or #0a0a0a in Mono.
const LEVELS = {
  // 40% tint; 0.6 wide (0.16 mm)
  light:    { width: 0.6, red: "#F1A8A8", mono: "#9D9D9D", hoverWidth: 1.2 },
  // 55% tint; 0.8 wide (0.21 mm). Unchanged: exactly today's line.
  standard: { width: 0.8, red: "#EC8888", mono: "#787878", hoverWidth: 1.2 },
  // Full colour; 1.2 wide (0.32 mm), the weight the lines had before 6 Oct
  bold:     { width: 1.2, red: "#dc2626", mono: "#0a0a0a", hoverWidth: 1.6 },
};
const FULL = { red: "#dc2626", mono: "#0a0a0a" };
const DASH = "4 3"; // 1.1 mm dashes, 0.8 mm gaps, flat ends, at every strength

// How a wire draws at this strength in this colour mode. hover*: a line
// hovered with the Select tool in the editor shows at full strength.
export function wireStyle(strength, colourMode) {
  const l = LEVELS[normaliseWireStrength(strength)];
  const tone = colourMode === "mono" ? "mono" : "red";
  return { width: l.width, colour: l[tone], dash: DASH, hoverWidth: l.hoverWidth, hoverColour: FULL[tone] };
}
