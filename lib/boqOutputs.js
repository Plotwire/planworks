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

// ---- Documents --------------------------------------------------------------
// A document is what the PDF and the CSV both render:
//   { kind, heading, title, subtitle, company, metaRows: [[label, value]],
//     notes: { title, lines } | null, columns: [{ key, label, align, width, money }],
//     sections: [{ title, subtitle, rows: [{ n, kind, ...cells }], subtotal }],
//     totals: { heading, lines: [[label, n]], grand: { label, note, value },
//               after: [[label, n, strong]] } | null,
//     footer: { notice, left }, fileSuffix }
// Money cells and totals are numbers (or null for a blank cell); the renderer
// formats them, so the CSV keeps plain numbers.

export const LABOUR_SECTION_KEY = "labour";

// A line worth listing: a quantity (or text such as "TBC") has been entered.
export function hasQty(it) {
  const { value, bad } = parseNum(it.qty);
  return bad || value !== 0;
}

const qtyText = (it) => { const s = String(it.qty ?? "").trim(); return s === "" ? "" : s; };

export function materialsDoc(boq, { projectName = "", company = "", notice = "" } = {}) {
  const m = boq.meta || {};
  const { skipEmpty } = outputSettings(boq);
  const sections = boq.sections
    .filter(sec => sec.key !== LABOUR_SECTION_KEY)
    .map(sec => {
      const items = skipEmpty ? sec.items.filter(hasQty) : sec.items;
      return {
        title: sec.title, subtitle: sec.subtitle || "", subtotal: null,
        rows: items.map((it, i) => ({ n: i + 1, kind: "item", item: it.item, spec: it.spec, qty: qtyText(it) })),
      };
    })
    .filter(sec => sec.rows.length);
  return {
    kind: "materials",
    heading: "Materials list",
    title: m.development || projectName || "Project",
    subtitle: "For supplier pricing · quantities only",
    company,
    metaRows: [
      ["Development", m.development || projectName],
      ["Site address", m.siteAddress],
      ["Prepared by", m.preparedBy],
      ["Supplier", m.supplier],
      ["Drawing no.", m.drawingNo],
      ["Date issued", fmtDate(m.dateIssued)],
      ["Required on site", m.requiredOnSite],
    ],
    notes: (boq.notes || []).filter(n => String(n).trim()).length
      ? { title: "Notes to supplier", lines: boq.notes.filter(n => String(n).trim()) } : null,
    columns: [
      { key: "n", label: "#", width: 26 },
      { key: "item", label: "Item" },
      { key: "spec", label: "Specification / Notes" },
      { key: "qty", label: "Qty", align: "right", width: 60 },
    ],
    sections,
    totals: null,
    footer: { notice, left: company },
    fileSuffix: "Materials",
  };
}

// Plain CSV of a document: header details, then each section's table.
export function docToCsv(doc) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const money = (v) => (v == null ? "" : Number(v).toFixed(2));
  const row = (cells) => cells.map(esc).join(",");
  const L = [row([doc.heading, doc.title])];
  doc.metaRows.forEach(([k, v]) => L.push(row([k, v])));
  L.push("");
  doc.sections.forEach(sec => {
    L.push(row([sec.title]));
    L.push(row(doc.columns.map(c => c.label)));
    sec.rows.forEach(r => L.push(row(doc.columns.map(c => c.money ? money(r[c.key]) : (r[c.key] ?? "")))));
    if (sec.subtotal != null) {
      const cells = doc.columns.map(() => "");
      cells[1] = `${sec.title} total`; cells[cells.length - 1] = money(sec.subtotal);
      L.push(row(cells));
    }
    L.push("");
  });
  if (doc.totals) {
    const t = doc.totals;
    t.lines.forEach(([k, v]) => L.push(row([k, money(v)])));
    L.push(row([t.grand.label, money(t.grand.value)]));
    t.after.forEach(([k, v]) => L.push(row([k, money(v)])));
    L.push("");
  }
  if (doc.footer?.notice) L.push(row([doc.footer.notice]));
  return L.join("\r\n");
}

// Client quote. Every line still counts in the totals; lines unticked for the
// quote (or hidden by the detail level) are summed into an "Other materials &
// sundries" row per section so the page adds up. Lines with no quantity and
// no value are left off. Sections with nothing to show are left off.
export function quoteDoc(boq, { projectName = "", company = "" } = {}) {
  const m = boq.meta || {};
  const { detail } = outputSettings(boq);
  const t = boqTotals(boq);
  const validUntil = validUntilFor(m);

  const priced = boq.sections.map(sec => {
    const total = sectionTotal(sec);
    const shown = sec.items.filter(it => shownOnQuote(it) && (hasQty(it) || lineTotal(it) !== 0));
    const other = total - shown.reduce((s, it) => s + lineTotal(it), 0);
    const rows = shown.map((it, i) => {
      const rate = parseNum(it.rate).value;
      return { n: i + 1, kind: "item", item: it.item, spec: it.spec, qty: qtyText(it), rate: rate || null, total: lineTotal(it) };
    });
    if (Math.abs(other) >= 0.005) {
      rows.push({
        n: null, kind: "sundries", spec: "", qty: "", rate: null, total: other,
        item: sec.key === LABOUR_SECTION_KEY ? "Other labour" : "Other materials & sundries",
      });
    }
    return { title: sec.title, subtitle: "", rows, subtotal: total };
  }).filter(sec => sec.rows.length || Math.abs(sec.subtotal) >= 0.005);

  const columns = detail === "full"
    ? [
        { key: "n", label: "#", width: 26 },
        { key: "item", label: "Item" },
        { key: "spec", label: "Description" },
        { key: "qty", label: "Qty", align: "right", width: 48 },
        { key: "rate", label: "Unit price", align: "right", width: 78, money: true },
        { key: "total", label: "Total", align: "right", width: 84, money: true },
      ]
    : [
        { key: "n", label: "#", width: 26 },
        { key: "item", label: "Item" },
        { key: "spec", label: "Description" },
        { key: "total", label: "Total", align: "right", width: 84, money: true },
      ];

  const metaRows = [
    ["Client", m.clientName],
    ["Client address", m.clientAddress],
    ["Site address", m.siteAddress],
    ["Quote reference", m.quoteRef],
    ["Date issued", fmtDate(m.dateIssued)],
    ["Valid until", fmtDate(validUntil)],
    ["Drawing no.", m.drawingNo],
  ].filter(([label, v]) => label === "Client" || String(v || "").trim());

  return {
    kind: "quote",
    heading: "Quotation",
    title: m.development || projectName || "Project",
    subtitle: t.vatOn ? "Prices in GBP · VAT shown separately" : "Prices in GBP",
    company,
    metaRows,
    notes: null,
    columns,
    // Section totals only: no line tables, the summary lists each section.
    sections: detail === "sectionTotals" ? [] : priced,
    totals: {
      heading: "Summary",
      lines: priced.map(sec => [sec.title, sec.subtotal]),
      grand: { label: t.vatOn ? "Total (ex VAT)" : "Total", note: "", value: t.net },
      after: t.vatOn ? [[`VAT @ ${t.vatRate}%`, t.vat], ["Total inc. VAT", t.gross, true]] : [],
    },
    footer: {
      notice: (validUntil ? `Quotation valid until ${fmtDate(validUntil)}. ` : "")
        + "Based on the drawings and information available at the time of pricing.",
      left: company,
    },
    fileSuffix: "Quote",
  };
}
