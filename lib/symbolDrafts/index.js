/* ============================================================================
 * Draft symbols: drawn in-house for the Symbol Library, not yet approved.
 *
 * Every symbol listed here is a DRAFT: lib/symbols.jsx puts it in the
 * CATALOGUE with draft: true, which keeps it off the library page and out of
 * the editor picker for every account (lib/symbolLibrary.js). findSymbol still
 * finds it, so nothing that names one can break.
 *
 * To approve symbols: move them out of these lists into the catalogue proper
 * (or list their ids in APPROVED below), then they appear on the library page
 * and can be ticked. Presets already name many of them, and fill out as they
 * are approved.
 * ========================================================================= */

import { POWER_SYMBOLS } from "./power";
import { LIGHTING_SYMBOLS } from "./lighting";
import { CONTROL_SYMBOLS } from "./controls";
import { SYSTEM_SYMBOLS } from "./systems";

// Ids approved for users while their drawings still live in these files.
export const APPROVED = new Set([]);

export const DRAFT_SYMBOLS = [
  ...POWER_SYMBOLS,
  ...LIGHTING_SYMBOLS,
  ...CONTROL_SYMBOLS,
  ...SYSTEM_SYMBOLS,
];
