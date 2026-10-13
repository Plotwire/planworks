/* ============================================================================
 * The newer symbols: drawn in-house for the Symbol Library (lib/symbolKit.jsx).
 *
 * They come in batches. A batch stays a DRAFT until it is approved: drafts are
 * in the CATALOGUE (lib/symbols.jsx) with draft: true, which keeps them off the
 * library page and out of the editor picker for every account
 * (lib/symbolLibrary.js). findSymbol still finds them, so nothing that names
 * one can break.
 *
 * Approving a batch puts it on the library page, where it can be ticked. It
 * never ticks anything: a symbol reaches an account's picker only when the
 * account ticks it (or applies a preset that names it). Accounts that have
 * never saved any ticks keep the Domestic starter, which is originals only.
 *
 * isNew: its symbols carry a "New" badge on the library page. Set it to false
 * to retire the badge (docs/post-launch-tidy-up.md).
 *
 * A future symbol goes in a new batch (in its own file), not in an approved
 * one, so it starts as a draft.
 * ========================================================================= */

import { POWER_SYMBOLS } from "./power";
import { LIGHTING_SYMBOLS } from "./lighting";
import { CONTROL_SYMBOLS } from "./controls";
import { SYSTEM_SYMBOLS } from "./systems";

const BATCHES = [
  // 253 symbols. Approved as drawn on 13 Oct 2026, from the A3 review PDFs.
  {
    approved: true,
    isNew: true,
    symbols: [...POWER_SYMBOLS, ...LIGHTING_SYMBOLS, ...CONTROL_SYMBOLS, ...SYSTEM_SYMBOLS],
  },
];

// Every newer symbol, with draft (not yet approved) and isNew (badged) set.
export const NEWER_SYMBOLS = BATCHES.flatMap((b) =>
  b.symbols.map((s) => ({ ...s, draft: !b.approved, isNew: !!b.approved && !!b.isNew })));
