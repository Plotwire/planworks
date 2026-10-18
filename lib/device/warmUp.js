"use client";

import { prefetchPdfjs } from "../pdfjs";

// Everything a day without signal needs that the app only loads when it's
// used: the editor, the sketch tool, the PDF and quote makers, pdf.js (PDF
// plans, PDF import), and the other pages' code. Fetched once, while the app
// sits idle with signal; the service worker keeps it (public/sw.js), so
// later it all opens with none. Once per page load, and not on a data saver
// connection.
let warmed = false;
export function warmUpOffline({ delayMs = 3000 } = {}) {
  if (warmed || typeof window === "undefined") return () => {};
  if (navigator.connection?.saveData) return () => {};
  const warm = () => {
    if (warmed || navigator.onLine === false) return;
    warmed = true;
    import("@/components/ElectricalPlanTool").catch(() => {});
    import("@/components/cad/CadSketch").catch(() => {});
    import("@/components/WorkPlanner").catch(() => {});
    import("@/components/BusinessInfo").catch(() => {});
    import("@/components/SymbolLibrary").catch(() => {});
    import("jspdf").catch(() => {});
    import("html2canvas").catch(() => {});
    import("pdf-lib").catch(() => {});
    prefetchPdfjs().catch(() => {});
  };
  const t = setTimeout(() => {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(warm, { timeout: 10000 });
    else warm();
  }, delayMs);
  return () => clearTimeout(t);
}
