// The name a new drawing starts with, so new drawings can be told apart on the
// dashboard instead of all being "Untitled drawing": the day and time it was
// started, e.g. "Drawing 16 Oct 2026, 06:20". Typing a project name replaces it.
export function defaultDrawingName(when = new Date()) {
  const day = when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `Drawing ${day}, ${time}`;
}
