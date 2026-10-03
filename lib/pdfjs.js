// Shared pdf.js loader.
//
// pdf.js is loaded from CDN on demand (it's large, and not every session touches
// a PDF). This used to happen ONLY inside the import flow, which meant opening an
// already-saved PDF drawing in a fresh session left the renderer with no library
// to draw with — a blank plan. This helper makes loading available everywhere:
// both the importer and the on-screen renderer call it before using pdf.js.
//
// Safe to call repeatedly and concurrently; it resolves once window.pdfjsLib is
// ready and its worker is configured.

const PDFJS_VERSION = "3.11.174";
const PDFJS_SRC = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

// Subresource Integrity: the browser refuses either file if its bytes differ
// from these hashes (cdnjs's published SRI for 3.11.174, checked against the
// files themselves). Change them together with PDFJS_VERSION.
const PDFJS_SRC_SRI = "sha512-q+4liFwdPC/bNdhUpZx6aXDx/h77yEQtn4I1slHydcbZK34nLaR3cAeYSJshoxIOq3mjEf7xJE8YWIUHMn+oCQ==";
const PDFJS_WORKER_SRI = "sha512-BbrZ76UNZq5BhH7LL7pn9A4TKQpQeNCHOo65/akfelcIBbcVvYWOFQKPXIrykE3qZxYjmDX573oa4Ywsc7rpTw==";

let _loadPromise = null;

function loadScript() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PDFJS_SRC;
    s.integrity = PDFJS_SRC_SRI;
    s.crossOrigin = "anonymous"; // SRI on a cross-origin script needs a CORS request
    s.referrerPolicy = "no-referrer";
    s.async = true;
    s.onload = () => (window.pdfjsLib ? resolve(window.pdfjsLib) : reject(new Error("Failed to load PDF library")));
    s.onerror = () => { s.remove(); reject(new Error("Failed to load PDF library")); };
    document.head.appendChild(s);
  });
}

// A Worker can't be given an integrity attribute, so fetch the worker with
// one and run it from a same-origin blob: URL instead of the CDN URL.
function loadWorkerUrl() {
  return fetch(PDFJS_WORKER, { integrity: PDFJS_WORKER_SRI, mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" })
    .then((r) => { if (!r.ok) throw new Error("Failed to load PDF library"); return r.text(); })
    .then((code) => URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
}

export function ensurePdfjs() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("pdf.js can only load in the browser"));
  }
  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions?.workerSrc) {
    return Promise.resolve(window.pdfjsLib);
  }
  if (_loadPromise) return _loadPromise;
  _loadPromise = Promise.all([loadScript(), loadWorkerUrl()])
    .then(([lib, workerUrl]) => {
      if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = workerUrl;
      else URL.revokeObjectURL(workerUrl);
      return lib;
    })
    .catch((e) => { _loadPromise = null; throw e; });
  return _loadPromise;
}
