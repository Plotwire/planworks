/* Plotwire service worker: SWITCHED OFF (the kill switch).
 *
 * Served in place of public/sw.js when the app is deployed with
 * NEXT_PUBLIC_SW_OFF=1 (next.config.js), or copied over sw.js by hand. Every
 * device still running the worker fetches this the next time it opens the
 * app with signal, or comes back to it (lib/device/serviceWorker.js), and it:
 *   - deletes the worker's own caches (named "plotwire-...": the app's code
 *     and pages), and
 *   - unregisters itself, so from then on everything comes from the network.
 * It leaves IndexedDB alone on purpose: saves waiting to upload, and the
 * drawings and plan images kept on the device (lib/device), aren't the
 * worker's, and the app keeps uploading them. Open pages aren't reloaded
 * (that could lose work not yet saved): they carry on, straight from the
 * network, and load fresh next time.
 */

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("plotwire-")).map((name) => caches.delete(name)));
    } catch { /* nothing cached */ }
    try { await self.registration.unregister(); } catch { /* already gone */ }
  })());
});

// No fetch handler: every request goes straight to the network.
