"use client";

// Plan uploads still running in this tab, by the blob: link the plan is shown
// from. The editor starts an upload as soon as a plan is imported; a save made
// before it finishes keeps the plan's bytes on the device (lib/device/drawings)
// and, when that save goes up (lib/device/outbox), waits for this upload
// instead of sending the same file twice.
const running = new Map(); // blob: link -> Promise<stored path | null>

export function registerPlanUpload(displayUrl, pathPromise) {
  if (!displayUrl || !pathPromise) return;
  const p = Promise.resolve(pathPromise).catch(() => null);
  running.set(displayUrl, p);
  // A finished upload stays known for this tab: its path is reused.
}

export function planUploadFor(displayUrl) {
  return (displayUrl && running.get(displayUrl)) || null;
}
