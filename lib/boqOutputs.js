// ============================================================================
// BOQ OUTPUTS -- the two documents made from one BOQ.
//   Materials list: for the wholesaler. Every material line, quantities only.
//   Client quote:   for the customer. Selling prices, lines the user chose to
//                   show, at the chosen level of detail.
// Pure functions (no React, no imports) so they can be tested in Node. The PDF
// and the CSV are both drawn from the same document, so they always agree.
// ============================================================================

export const QUOTE_VALID_DAYS = 30;

// Qty/rate cells are free text. Blank is zero; anything else must be a number
// (commas, spaces and a leading "£" are allowed). A non-number counts as zero
// and is flagged so the screen can warn about it.
export function parseNum(v) {
  if (v == null) return { value: 0, bad: false };
  if (typeof v === "number") return Number.isFinite(v) ? { value: v, bad: false } : { value: 0, bad: true };
  const s = String(v).trim().replace(/[£,\s]/g, "");
  if (s === "") return { value: 0, bad: false };
  const n = Number(s);
  return Number.isFinite(n) ? { value: n, bad: false } : { value: 0, bad: true };
}

export const lineTotal = (it) => parseNum(it.qty).value * parseNum(it.rate).value;
export const sectionTotal = (sec) => sec.items.reduce((s, it) => s + lineTotal(it), 0);

// BOQs saved before the VAT switch existed charge VAT.
export const vatOnFor = (boq) => boq.vatOn !== false;

export function boqTotals(boq) {
  const net = boq.sections.reduce((s, sec) => s + sectionTotal(sec), 0);
  const vatOn = vatOnFor(boq);
  const vatRate = boq.vatRate || 0;
  const vat = vatOn ? net * vatRate / 100 : 0;
  return { net, vatOn, vatRate, vat, gross: net + vat };
}

// Lines whose Qty or Rate isn't a number.
export function badNumberLines(boq) {
  const out = [];
  boq.sections.forEach(sec => sec.items.forEach(it => {
    if (parseNum(it.qty).bad || parseNum(it.rate).bad) out.push({ section: sec.title, item: it.item });
  }));
  return out;
}

// ---- Dates ------------------------------------------------------------------
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function addDaysIso(iso, days) {
  const m = ISO.exec(String(iso || "").trim());
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return d.toISOString().slice(0, 10);
}

// "2026-10-26" -> "26 Oct 2026". Anything else is shown as typed.
export function fmtDate(v) {
  const m = ISO.exec(String(v || "").trim());
  if (!m) return String(v || "");
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// Valid until: what the user typed, else 30 days from the date issued.
export const validUntilFor = (meta = {}) =>
  (meta.validUntil && String(meta.validUntil).trim()) || addDaysIso(meta.dateIssued, QUOTE_VALID_DAYS);

// ---- Saved output settings (stored on the BOQ, so saved with the drawing) --
export const QUOTE_DETAILS = [
  { key: "full", label: "Full detail", hint: "Qty, unit price and total on each line" },
  { key: "lineTotals", label: "Line totals only", hint: "No quantities or unit prices" },
  { key: "sectionTotals", label: "Section totals only", hint: "Section names and totals, no lines" },
];

export function outputSettings(boq) {
  const q = boq.quote || {};
  const mat = boq.materials || {};
  return {
    output: boq.output === "quote" ? "quote" : "materials",
    detail: QUOTE_DETAILS.some(d => d.key === q.detail) ? q.detail : "full",
    skipEmpty: mat.skipEmpty !== false,
  };
}

// Hidden-from-client is stored as hideOnQuote so every existing line is shown.
export const shownOnQuote = (it) => !it.hideOnQuote;
