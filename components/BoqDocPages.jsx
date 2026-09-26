"use client";

import { useLayoutEffect, useRef, useState } from "react";

/* ============================================================================
 * BOQ DOCUMENT PAGES -- renders a document from lib/boqOutputs.js (materials
 * list or client quote) as A4 pages (.boq-page) for the PDF export to capture.
 *
 * Page breaks use MEASURED heights: every block is first laid out once, hidden,
 * at the page's content width, so a long spec that wraps onto several lines
 * pushes rows onto the next page instead of running off the bottom.
 * ========================================================================= */

const PAGE_W = 794, PAGE_H = 1123, PAD_X = 46, PAD_TOP = 40, PAD_BOTTOM = 54;
const INNER_W = PAGE_W - PAD_X * 2;
// Usable height above the footer, with a little slack for rounding.
const CONTENT_H = PAGE_H - PAD_TOP - PAD_BOTTOM - 12;
const TEAL = "#22808F";

const gbp = (n) => "£" + (Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const th = { textAlign: "left", padding: "6px", fontSize: 8, letterSpacing: "0.06em", textTransform: "uppercase", color: "#64748b", borderBottom: "1px solid #cbd5e1" };
const td = { padding: "5px 6px", fontSize: 10, color: "#334155", borderBottom: "1px solid #eef2f6", verticalAlign: "top", overflowWrap: "anywhere" };

function cellText(col, row) {
  const v = row[col.key];
  if (col.money) return v == null ? "" : gbp(v);
  if (col.key === "n") return v == null ? "" : v;
  return v === "" || v == null ? (col.key === "qty" ? "—" : "") : v;
}

function Preamble({ doc }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, marginBottom: 26 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>{doc.company || ""}</div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: TEAL, fontWeight: 700 }}>{doc.heading}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", marginTop: 2, lineHeight: 1.1 }}>{doc.title}</div>
          {doc.subtitle && <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{doc.subtitle}</div>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 34, marginBottom: 20 }}>
        {doc.metaRows.map(([label, val]) => (
          <div key={label} style={{ display: "flex", borderBottom: "1px solid #eef2f6", padding: "6px 0" }}>
            <div style={{ width: 110, flexShrink: 0, fontSize: 8.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#94a3b8" }}>{label}</div>
            <div style={{ fontSize: 11, color: "#0f172a", fontWeight: 600, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{val || "—"}</div>
          </div>
        ))}
      </div>
      {doc.notes && (
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 16px", marginBottom: 8, background: "#f8fafc" }}>
          <div style={{ fontSize: 8.5, textTransform: "uppercase", letterSpacing: "0.1em", color: TEAL, fontWeight: 700, marginBottom: 7 }}>{doc.notes.title}</div>
          {doc.notes.lines.map((n, i) => (
            <div key={i} style={{ fontSize: 10, color: "#475569", marginBottom: 4, display: "flex", gap: 6 }}><span style={{ color: "#94a3b8" }}>•</span><span>{n}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

// paddingTop (not marginTop) so the gap is part of the measured height.
function SectionHead({ sec, continued }) {
  return (
    <div style={{ paddingTop: 14, paddingBottom: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
          {sec.title}{continued ? <span style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8" }}>  (cont.)</span> : null}
        </div>
        {sec.subtotal != null && <div style={{ fontSize: 13, fontWeight: 700, color: TEAL }}>{gbp(sec.subtotal)}</div>}
      </div>
      {!continued && sec.subtitle && <div style={{ fontSize: 9.5, color: "#94a3b8", marginTop: 4 }}>{sec.subtitle}</div>}
    </div>
  );
}

function ColGroup({ columns }) {
  return <colgroup>{columns.map(c => <col key={c.key} style={c.width ? { width: c.width } : undefined} />)}</colgroup>;
}

function HeadRow({ columns, m }) {
  return (
    <tr data-m={m}>
      {columns.map(c => <th key={c.key} style={{ ...th, textAlign: c.align || "left" }}>{c.label}</th>)}
    </tr>
  );
}

function BodyRow({ columns, row, m }) {
  const sundry = row.kind === "sundries";
  return (
    <tr data-m={m}>
      {columns.map(c => (
        <td key={c.key} style={{
          ...td, textAlign: c.align || "left",
          ...(c.key === "n" ? { color: "#94a3b8" } : {}),
          ...(c.key === "item" ? { fontWeight: 600, color: "#1e293b", fontStyle: sundry ? "italic" : "normal" } : {}),
          ...(c.key === "spec" ? { color: "#64748b" } : {}),
          ...(c.money && c.key === "total" ? { fontWeight: 600, color: "#0f172a" } : {}),
        }}>{cellText(c, row)}</td>
      ))}
    </tr>
  );
}

function SubtotalRow({ doc, sec, m }) {
  return (
    <tr data-m={m}>
      <td colSpan={doc.columns.length - 1} style={{ padding: "6px", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right", color: "#475569", fontWeight: 700 }}>{sec.title} total</td>
      <td style={{ padding: "6px", fontSize: 11, textAlign: "right", fontWeight: 700, color: "#0f172a" }}>{gbp(sec.subtotal)}</td>
    </tr>
  );
}

function Totals({ t }) {
  return (
    <div style={{ paddingTop: 16 }}>
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "16px 18px", background: "#f8fafc" }}>
        <div style={{ fontSize: 8.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "#64748b", fontWeight: 700, marginBottom: 8 }}>{t.heading}</div>
        {t.lines.map(([label, v], i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #eef2f6", padding: "5px 0", fontSize: 11 }}>
            <span style={{ color: "#475569" }}>{label}</span><span style={{ fontWeight: 600 }}>{gbp(v)}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 12, paddingTop: 8, borderTop: "2px solid #1e293b" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{t.grand.label}</div>
            {t.grand.note && <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "0.08em", color: "#94a3b8" }}>{t.grand.note}</div>}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#0f172a" }}>{gbp(t.grand.value)}</div>
        </div>
        {t.after.map(([label, v, strong], i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11, fontWeight: strong ? 700 : 400, marginTop: i === 0 ? 4 : 0 }}>
            <span style={{ color: strong ? "#0f172a" : "#475569" }}>{label}</span><span>{gbp(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Flow the document into pages using measured heights. A section that spills
// onto the next page repeats its title (marked "cont.") and column header.
function paginate(doc, h) {
  const pages = [];
  let page = { preamble: true, chunks: [], totals: false };
  let used = h.pre;
  const flush = () => { pages.push(page); page = { preamble: false, chunks: [], totals: false }; used = 0; };

  doc.sections.forEach((sec, si) => {
    const head = h.head[si] ?? 50;
    const rows = sec.rows.map((_, ri) => h.rows[si]?.[ri] ?? 28);
    const sub = sec.subtotal != null ? (h.sub[si] ?? 30) : 0;
    if (used + head + h.thead + (rows[0] ?? sub) > CONTENT_H && used > 0) flush();
    let chunk = { si, continued: false, start: 0, end: 0, subtotal: false };
    used += head + h.thead;
    for (let ri = 0; ri < rows.length; ri++) {
      if (used + rows[ri] > CONTENT_H && ri > chunk.start) {
        chunk.end = ri; page.chunks.push(chunk); flush();
        chunk = { si, continued: true, start: ri, end: ri, subtotal: false };
        used = head + h.thead;
      }
      used += rows[ri];
    }
    chunk.end = rows.length;
    if (sub) {
      if (used + sub > CONTENT_H) {
        page.chunks.push(chunk); flush();
        chunk = { si, continued: true, start: rows.length, end: rows.length, subtotal: false };
        used = head + h.thead;
      }
      chunk.subtotal = true;
      used += sub;
    }
    page.chunks.push(chunk);
  });
  if (doc.totals) {
    if (used + h.tot > CONTENT_H) flush();
    page.totals = true;
  }
  pages.push(page);
  return pages;
}

const ESTIMATE = { pre: 330, head: [], thead: 26, rows: [], sub: [], tot: 240 };

export default function BoqDocPages({ doc }) {
  const measureRef = useRef(null);
  const [h, setH] = useState(ESTIMATE);

  // Re-measure after every render; only store when something changed.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const ht = (sel) => { const n = el.querySelector(sel); return n ? n.getBoundingClientRect().height : 0; };
    const next = {
      pre: ht('[data-m="pre"]'),
      thead: ht('[data-m="thead"]') || 26,
      tot: ht('[data-m="tot"]'),
      head: doc.sections.map((_, si) => ht(`[data-m="head-${si}"]`)),
      rows: doc.sections.map((sec, si) => sec.rows.map((_, ri) => ht(`[data-m="row-${si}-${ri}"]`))),
      sub: doc.sections.map((_, si) => ht(`[data-m="sub-${si}"]`)),
    };
    setH(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  });

  const pages = paginate(doc, h);
  const table = (children) => (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
      <ColGroup columns={doc.columns} />
      {children}
    </table>
  );

  return (
    <>
      {/* Hidden measuring layout: same widths and styles as a page. */}
      <div ref={measureRef} aria-hidden style={{ position: "absolute", top: 0, left: 0, width: INNER_W, visibility: "hidden", fontFamily: "Inter, system-ui, sans-serif" }}>
        <div data-m="pre"><Preamble doc={doc} /></div>
        {doc.sections.map((sec, si) => (
          <div key={si}>
            <div data-m={`head-${si}`}><SectionHead sec={sec} continued={false} /></div>
            {table(
              <tbody>
                <HeadRow columns={doc.columns} m={si === 0 ? "thead" : undefined} />
                {sec.rows.map((row, ri) => <BodyRow key={ri} columns={doc.columns} row={row} m={`row-${si}-${ri}`} />)}
                {sec.subtotal != null && <SubtotalRow doc={doc} sec={sec} m={`sub-${si}`} />}
              </tbody>
            )}
          </div>
        ))}
        {doc.totals && <div data-m="tot"><Totals t={doc.totals} /></div>}
      </div>

      {pages.map((pg, pi) => (
        <div key={pi} className="boq-page" style={{ width: PAGE_W, height: PAGE_H, background: "#fff", padding: `${PAD_TOP}px ${PAD_X}px ${PAD_BOTTOM}px`, boxSizing: "border-box", color: "#1e293b", fontFamily: "Inter, system-ui, sans-serif", position: "relative", overflow: "hidden" }}>
          {pg.preamble && <Preamble doc={doc} />}
          {pg.chunks.map((ch, ci) => {
            const sec = doc.sections[ch.si];
            return (
              <div key={ci}>
                <SectionHead sec={sec} continued={ch.continued} />
                {table(
                  <>
                    <thead><HeadRow columns={doc.columns} /></thead>
                    <tbody>
                      {sec.rows.slice(ch.start, ch.end).map((row, ri) => <BodyRow key={ri} columns={doc.columns} row={row} />)}
                      {ch.subtotal && <SubtotalRow doc={doc} sec={sec} />}
                    </tbody>
                  </>
                )}
              </div>
            );
          })}
          {pg.totals && <Totals t={doc.totals} />}

          {/* Footer on every page, inside the bottom padding. */}
          <div style={{ position: "absolute", bottom: 16, left: PAD_X, right: PAD_X, fontSize: 8.5, borderTop: "1px solid #eef2f6", paddingTop: 7 }}>
            {doc.footer.notice && <div style={{ color: "#1A2530", marginBottom: 3 }}>{doc.footer.notice}</div>}
            <div style={{ color: "#94a3b8", display: "flex", justifyContent: "space-between" }}>
              <span>{doc.footer.left || ""}</span>
              <span>Page {pi + 1} of {pages.length}</span>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
