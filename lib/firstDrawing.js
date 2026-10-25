/* ============================================================================
 * lib/firstDrawing.js -- the first-drawing guide's progress (pure values)
 * ----------------------------------------------------------------------------
 * A new account (no drawings) gets a "Let's do your first drawing" dashboard
 * (components/FirstDrawing.jsx), then a checklist in the editor that ticks
 * itself as each step is done. Its progress is kept with the account, in its
 * settings (user_settings.data.firstDrawing, no new table or column), and is
 * also what Joe's drop-off counts read (supabase/first-drawing-funnel.sql):
 *
 *   { started,          first shown the new-account dashboard (ms)
 *     signup,           when the account was made (ms), for the counts
 *     steps: { plan, symbol, quote, download, downloadLocked },
 *     hidden,           "Hide guide" (ms)
 *     finished,         all four steps done (ms)
 *     closed,           the "Done" message closed (ms)
 *     hintsOff: { palette, quote } }   a hint closed with its cross (ms)
 *
 * Every field is the time it first happened, and stays set: two devices'
 * progress combines by keeping the earliest of each (mergeGuide), so a step
 * done with no signal is never undone by the other device's copy.
 * downloadLocked: a try account pressed Download and was shown that downloads
 * come with a subscription (try mode's rule, unchanged): step 4 for them.
 * ========================================================================== */

export const GUIDE_STEPS = ["plan", "symbol", "quote", "download"];

export const GUIDE_TEXT = {
  plan: "Add your plan",
  symbol: "Place your first socket or light",
  quote: "Open the quote and see it filled in from the drawing",
  download: "Download or print your drawing",
};

const STEP_KEYS = ["plan", "symbol", "quote", "download", "downloadLocked"];
const TOP_KEYS = ["started", "signup", "hidden", "finished", "closed"];
const HINT_KEYS = ["palette", "quote"];

const time = (v) => (Number.isFinite(v) && v > 0 ? v : null);
const earliest = (a, b) => { const x = time(a), y = time(b); return x && y ? Math.min(x, y) : x || y; };

// Only the known fields, each a time or absent.
export function cleanGuide(g) {
  if (!g || typeof g !== "object") return null;
  const out = {};
  for (const k of TOP_KEYS) if (time(g[k])) out[k] = g[k];
  const steps = {};
  for (const k of STEP_KEYS) if (time(g.steps?.[k])) steps[k] = g.steps[k];
  out.steps = steps;
  const hints = {};
  for (const k of HINT_KEYS) if (time(g.hintsOff?.[k])) hints[k] = g.hintsOff[k];
  out.hintsOff = hints;
  return out;
}

// Two copies as one: each field at the earliest time either has.
export function mergeGuide(a, b) {
  const x = cleanGuide(a), y = cleanGuide(b);
  if (!x) return y;
  if (!y) return x;
  const out = { steps: {}, hintsOff: {} };
  for (const k of TOP_KEYS) { const v = earliest(x[k], y[k]); if (v) out[k] = v; }
  for (const k of STEP_KEYS) { const v = earliest(x.steps[k], y.steps[k]); if (v) out.steps[k] = v; }
  for (const k of HINT_KEYS) { const v = earliest(x.hintsOff[k], y.hintsOff[k]); if (v) out.hintsOff[k] = v; }
  return out;
}

export const sameGuide = (a, b) => JSON.stringify(cleanGuide(a)) === JSON.stringify(cleanGuide(b));

// Is this step done? Step 4 is done by a download or print, or for a try
// account by pressing Download (shown that it comes with a subscription).
export function stepDone(g, step) {
  const s = g?.steps || {};
  return step === "download" ? Boolean(time(s.download) || time(s.downloadLocked)) : Boolean(time(s[step]));
}
export const doneCount = (g) => GUIDE_STEPS.filter((s) => stepDone(g, s)).length;
export const allDone = (g) => doneCount(g) === GUIDE_STEPS.length;
// The first step not done yet, or null when all are.
export const nextStep = (g) => GUIDE_STEPS.find((s) => !stepDone(g, s)) || null;

// Should the editor show the guide? Only for an account that started it on
// the new-account dashboard, until it is hidden or its "Done" is closed.
export const guideShown = (g) => Boolean(g && time(g.started) && !time(g.hidden) && !time(g.closed));

// The guide with `key` (a step, or "started" etc.) set to now, unless it is
// set already: what to save, or the same guide when nothing changes.
export function withStep(g, step, now = Date.now()) {
  const cur = cleanGuide(g) || { steps: {}, hintsOff: {} };
  if (time(cur.steps[step])) return cur;
  const next = { ...cur, steps: { ...cur.steps, [step]: now } };
  if (!time(next.finished) && allDone(next)) next.finished = now;
  return next;
}
export function withField(g, key, now = Date.now()) {
  const cur = cleanGuide(g) || { steps: {}, hintsOff: {} };
  return time(cur[key]) ? cur : { ...cur, [key]: now };
}
export function withHintOff(g, hint, now = Date.now()) {
  const cur = cleanGuide(g) || { steps: {}, hintsOff: {} };
  return time(cur.hintsOff[hint]) ? cur : { ...cur, hintsOff: { ...cur.hintsOff, [hint]: now } };
}
