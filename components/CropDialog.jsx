"use client";

/* ============================================================================
 * The crop step: keep just the floor plan from an imported page, and (for a
 * PDF) say what scale the drawing is at so it can be placed at a true scale.
 * Presentation only -- what is shown and how big -- never the design.
 *
 * source   { kind: "pdf" | "image", w, h, pageMm?, render(ctx, s) } -- the
 *          page in its own units (PDF points / pixels); render draws all of
 *          it into ctx at s device pixels per unit.
 * initial  { crop, drawingScale, sheetScale } -- any of them null.
 * work     (Crop & scale) what's on the plan, in the page's units
 *          (lib/planCrop workMarks): shown as dots, and a crop that would
 *          leave any of it out says so and can't be used.
 * symbols  { count, scale } and sizeFactor(choice) -- the sheet's symbols,
 *          and how many times bigger the plan would be drawn: for the choice
 *          to resize the symbols with it.
 * onApply  ({ crop, drawingScale, sheetScale, resizeSymbols }) -- crop null =
 *          whole page; sheetScale null = fitted to the sheet (NTS).
 * error    shown in red while the dialog stays open (a change that was
 *          refused, so the user can try another crop or scale).
 *
 * The page never moves under a drag. Its size and place come from the window
 * alone (measured as the dialog opens), and are held from press to release.
 * While the box is dragged only the box (and the dots) change: the scale,
 * size and cut-off text below follow when it's let go, so nothing in the
 * dialog reflows mid-drag. One input stream: pointer events with pointer
 * capture, the box updated once a frame.
 * ========================================================================== */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { DRAWING_SCALES, SYMBOL_SCALE, cropMmOf, cutBy, cutMessage, fittingScales, outsideArea, paperName, realSizeM, symbolScaleFor, validRect } from "@/lib/planCrop";

const CORNERS = [["nw", 0, 0], ["ne", 1, 0], ["se", 1, 1], ["sw", 0, 1]];
const EDGES = [["n", 0.5, 0], ["e", 1, 0.5], ["s", 0.5, 1], ["w", 0, 0.5]];
const CURSOR = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
const fmtM = (m) => (m >= 10 ? m.toFixed(1) : m.toFixed(2)).replace(/\.?0+$/, "");
const pct = (v) => `${Math.round(v * 100)}%`;

export default function CropDialog({ mode = "import", source, initial = {}, allowScale = false, work = null, symbols = null, sizeFactor = null, busy = false, note = null, error = null, onCancel, onApply }) {
  const W = source.w, H = source.h;
  const whole = { x: 0, y: 0, w: W, h: H };
  const [crop, setCrop] = useState(() => (validRect(initial.crop) ? initial.crop : whole));
  const [drawingScale, setDrawingScale] = useState(initial.drawingScale || null);
  const [sheetScale, setSheetScale] = useState(initial.sheetScale || null);
  const [resizeSymbols, setResizeSymbols] = useState(true);
  // The box while it's being dragged (null otherwise); crop is where it was
  // let go, and is what everything outside the page follows.
  const [live, setLive] = useState(null);
  const [dragging, setDragging] = useState(false);
  const frozen = useRef(null);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const cardRef = useRef(null);
  const drag = useRef(null);

  // The window, and the room the dialog's own header, panels and buttons
  // take (measured as it opens, and again only if the window changes).
  const [view, setView] = useState(() => (typeof window === "undefined" ? { vw: 1024, vh: 768 } : { vw: window.innerWidth, vh: window.innerHeight }));
  const [chrome, setChrome] = useState(allowScale ? 300 : 220);
  const passes = useRef(0);
  useEffect(() => {
    const read = () => { passes.current = 0; setView({ vw: window.innerWidth, vh: window.innerHeight }); };
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  // Room left for a scrollbar at the side (always kept: scrollbar-gutter),
  // so one appearing never moves the dialog sideways.
  const cardW0 = Math.max(280, Math.min(view.vw - 50, 1212));
  const s0 = Math.max(0.01, Math.min((cardW0 - 34) / W, (view.vh - 32 - chrome) / H));
  const cssH0 = Math.round(H * s0);
  const layoutNow = { cardW: cardW0, s: s0, cssW: Math.round(W * s0), cssH: cssH0, top: Math.max(16, Math.round((view.vh - chrome - cssH0) / 2)) };
  // Held while a drag is on, whatever happens to the window meanwhile.
  const { cardW, s, cssW, cssH, top } = dragging && frozen.current ? frozen.current : layoutNow;
  useLayoutEffect(() => {
    const c = cardRef.current;
    if (!c || passes.current >= 3 || drag.current) return;
    const room = c.offsetHeight - cssH;
    if (Math.abs(room - chrome) > 2) { passes.current++; setChrome(room); }
  }, [view, chrome, cssH]);

  // A thumb needs a wider edge to catch than a mouse pointer.
  const [coarse] = useState(() => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(any-pointer: coarse)").matches);
  const T = coarse ? 34 : 22;

  // Drawn off screen and copied in when done, so a redraw for a new size
  // never shares a canvas with one still running; an older one is dropped.
  useEffect(() => {
    let dead = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const k = Math.min(dpr, Math.sqrt(4_000_000 / Math.max(1, cssW * cssH))); // keep the preview small on an iPad
    const off = document.createElement("canvas");
    off.width = Math.max(1, Math.round(cssW * k));
    off.height = Math.max(1, Math.round(cssH * k));
    const octx = off.getContext("2d");
    octx.fillStyle = "#ffffff"; octx.fillRect(0, 0, off.width, off.height);
    Promise.resolve(source.render(octx, s * k)).then(() => {
      const c = canvasRef.current;
      if (dead || !c) return;
      c.width = off.width; c.height = off.height;
      c.getContext("2d").drawImage(off, 0, 0);
    }).catch(() => { /* the preview stays blank; the crop still works */ })
      .finally(() => { off.width = off.height = 0; });
    return () => { dead = true; };
  }, [source, cssW, cssH, s]);

  useEffect(() => {
    const key = (e) => { if (e.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy, onCancel]);

  // Scale: what fits, and keep the choice to one that does.
  const pageMm = source.pageMm;
  const cropMm = allowScale && pageMm ? cropMmOf(crop, W, H, pageMm) : null;
  const fitting = useMemo(() => (cropMm && drawingScale ? fittingScales(cropMm, drawingScale) : []), [cropMm && cropMm.w, cropMm && cropMm.h, drawingScale]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!drawingScale) { if (sheetScale) setSheetScale(null); return; }
    if (!fitting.includes(sheetScale)) setSheetScale(fitting[0] || null);
  }, [fitting, drawingScale]); // eslint-disable-line react-hooks/exhaustive-deps

  const minSide = Math.max(W, H) * 0.03;
  const clampRect = (r) => {
    const w = Math.min(Math.max(r.w, minSide), W), h = Math.min(Math.max(r.h, minSide), H);
    return { x: Math.min(Math.max(r.x, 0), W - w), y: Math.min(Math.max(r.y, 0), H - h), w, h };
  };
  const resize = (r0, m, dx, dy) => {
    let { x, y, w, h } = r0;
    const right = r0.x + r0.w, bottom = r0.y + r0.h;
    if (m.includes("w")) { x = Math.min(Math.max(r0.x + dx, 0), right - minSide); w = right - x; }
    if (m.includes("e")) { w = Math.min(Math.max(r0.w + dx, minSide), W - r0.x); }
    if (m.includes("n")) { y = Math.min(Math.max(r0.y + dy, 0), bottom - minSide); h = bottom - y; }
    if (m.includes("s")) { h = Math.min(Math.max(r0.h + dy, minSide), H - r0.y); }
    return { x, y, w, h };
  };
  // A drag works from what it found at the press: the box, the pointer, and
  // where the page was and how big (never measured again until the release).
  const place = (d, cx, cy) => {
    const dx = (cx - d.x0) / d.s, dy = (cy - d.y0) / d.s;
    if (d.m === "move") return clampRect({ ...d.r0, x: d.r0.x + dx, y: d.r0.y + dy });
    if (d.m === "new") {
      const u = Math.min(Math.max((cx - d.left) / d.s, 0), W), v = Math.min(Math.max((cy - d.top) / d.s, 0), H);
      if (Math.abs(u - d.u0) <= minSide / 2 && Math.abs(v - d.v0) <= minSide / 2) return null;
      return clampRect({ x: Math.min(d.u0, u), y: Math.min(d.v0, v), w: Math.abs(u - d.u0), h: Math.abs(v - d.v0) });
    }
    return resize(d.r0, d.m, dx, dy);
  };
  const frame = useRef(0);
  const start = (m) => (e) => {
    // A second finger never takes over a drag; a new press does.
    if (busy || (e.pointerType === "mouse" && e.button !== 0) || (drag.current && !e.isPrimary)) return;
    e.preventDefault(); e.stopPropagation();
    try { stageRef.current.setPointerCapture(e.pointerId); } catch { /* fine */ }
    const r = stageRef.current.getBoundingClientRect();
    frozen.current = { cardW, s, cssW, cssH, top };
    drag.current = {
      m, id: e.pointerId, x0: e.clientX, y0: e.clientY, r0: crop, s, left: r.left, top: r.top,
      u0: Math.min(Math.max((e.clientX - r.left) / s, 0), W), v0: Math.min(Math.max((e.clientY - r.top) / s, 0), H), last: null,
    };
    setDragging(true);
  };
  const finish = (d, pt) => {
    if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; }
    const p = pt || d.last;
    const next = p ? place(d, p.x, p.y) : null;
    drag.current = null;
    if (next) setCrop(next);
    setLive(null);
    setDragging(false);
  };
  const move = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    // A mouse button let go where the page couldn't see it: the drag is over.
    if (e.pointerType === "mouse" && e.buttons === 0) { finish(d, null); return; }
    e.preventDefault();
    d.last = { x: e.clientX, y: e.clientY };
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const dd = drag.current;
        const next = dd && dd.last ? place(dd, dd.last.x, dd.last.y) : null;
        if (next) setLive(next);
      });
    }
  };
  const end = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    finish(d, e.type === "pointerup" ? { x: e.clientX, y: e.clientY } : null);
  };
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  const isWhole = crop.x < 0.5 && crop.y < 0.5 && Math.abs(crop.w - W) < 0.5 && Math.abs(crop.h - H) < 0.5;
  const choiceNow = { crop: isWhole ? null : crop, drawingScale: allowScale ? drawingScale : null, sheetScale: allowScale && drawingScale ? sheetScale : null };
  // What this crop would cut off (Crop & scale): it can't be used until none.
  const cut = work ? cutBy(work, crop) : null;
  const blocked = !!(cut && cut.total);
  // The symbols' size, if they're resized with the plan.
  const factor = symbols && symbols.count > 0 && sizeFactor ? sizeFactor(choiceNow) : null;
  const sizeChanges = Number.isFinite(factor) && Math.abs(factor - 1) > 0.005;
  const newSymbolScale = sizeChanges ? symbolScaleFor(symbols.scale, factor) : null;
  const apply = (useWhole) => {
    const c = useWhole || isWhole ? null : crop;
    let sheet = sheetScale;
    if (useWhole && drawingScale && pageMm) {
      const f = fittingScales(cropMmOf(null, W, H, pageMm), drawingScale);
      sheet = f.includes(sheetScale) ? sheetScale : f[0] || null;
    }
    // The tick is the choice; the change resizes only if the plan's size changes.
    onApply({ crop: c, drawingScale: allowScale ? drawingScale : null, sheetScale: allowScale && drawingScale ? sheet : null, resizeSymbols });
  };

  const box = live || crop;
  const R = { left: box.x * s, top: box.y * s, width: box.w * s, height: box.h * s };
  const paper = pageMm ? `${paperName(pageMm) ? paperName(pageMm) + " · " : ""}${Math.round(pageMm.w)} × ${Math.round(pageMm.h)} mm` : null;
  const real = cropMm && drawingScale ? realSizeM(cropMm, drawingScale) : null;
  const sel = "px-2.5 py-1.5 text-sm bg-white dark:bg-[#0E141B] rounded-lg ring-1 ring-slate-200 dark:ring-[#2A3947] text-slate-900 dark:text-slate-100 focus:ring-[#3FB7C9] focus:outline-none";
  const btn2 = "px-4 py-2 rounded-lg text-sm font-semibold ring-1 ring-slate-300 dark:ring-[#2A3947] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-40";
  // Where to catch the box: its corners, the whole length of each edge, and
  // inside it to move it; anywhere else on the page draws a new area.
  const zone = (m, style) => (
    <div key={m} data-crop-zone={m} onPointerDown={start(m)} style={{ position: "absolute", cursor: CURSOR[m], touchAction: "none", ...style }} />
  );

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/50 backdrop-blur-sm overflow-y-auto" style={{ scrollbarGutter: "stable" }} role="dialog" aria-modal="true" aria-label={mode === "adjust" ? "Adjust crop and scale" : "Crop the plan"}>
      <div ref={cardRef} className="bg-white dark:bg-[#16202B] rounded-2xl ring-1 ring-slate-200 dark:ring-[#2A3947] shadow-2xl flex flex-col overflow-hidden mx-auto"
           style={{ width: cardW, marginTop: top, marginBottom: 16 }}>
        <div className="flex items-start justify-between gap-4 px-5 py-3.5 border-b border-slate-200 dark:border-[#2A3947]">
          <div>
            <div className="text-[10px] tracking-[0.3em] uppercase text-slate-500 dark:text-slate-400">{mode === "adjust" ? "Plan" : "Import plan"}</div>
            <div className="text-base font-semibold mt-0.5 text-slate-900 dark:text-slate-100">{mode === "adjust" ? "Adjust crop & scale" : "Keep just the floor plan"}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-[640px]">
              Drag the corners or edges to crop out the title block and margins, or drag across the page to draw a new area.
              {source.kind === "pdf" ? " The original PDF is kept as it is." : " The picture is kept at its full detail."}
            </div>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Cancel" className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 rounded-md">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 flex justify-center bg-slate-100 dark:bg-[#0E141B] overflow-hidden">
          <div ref={stageRef} className="relative select-none" style={{ width: cssW, height: cssH, touchAction: "none", cursor: "crosshair" }}
               onPointerDown={start("new")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
            <canvas ref={canvasRef} style={{ width: cssW, height: cssH, display: "block", boxShadow: "0 1px 3px rgba(15,23,42,.25)" }} />
            {/* Outside the crop, dimmed */}
            {[[0, 0, cssW, R.top], [0, R.top + R.height, cssW, cssH - R.top - R.height], [0, R.top, R.left, R.height], [R.left + R.width, R.top, cssW - R.left - R.width, R.height]].map(([l, t, w, h], i) => (
              <div key={i} aria-hidden="true" style={{ position: "absolute", left: l, top: t, width: Math.max(0, w), height: Math.max(0, h), background: "rgba(15,23,42,.45)", pointerEvents: "none" }} />
            ))}
            {/* The work on the plan: dark dots, amber where this crop leaves it out */}
            {work && work.marks.map((m, i) => {
              const out = outsideArea(m, box);
              return <span key={i} aria-hidden="true" style={{ position: "absolute", left: m.u * s - (out ? 5 : 4), top: m.v * s - (out ? 5 : 4), width: out ? 10 : 8, height: out ? 10 : 8, borderRadius: 99, background: out ? "#D97706" : "#1A2530", border: "1.5px solid #fff", boxShadow: "0 0 0 1px rgba(15,23,42,.35)", pointerEvents: "none" }} />;
            })}
            <div data-crop-rect style={{ position: "absolute", ...R, outline: "2px solid #2C97A8", boxShadow: "0 0 0 1px rgba(255,255,255,.9) inset", cursor: "move", touchAction: "none" }}
                 onPointerDown={start("move")}>
              {/* The whole length of each edge, then the corners over them */}
              {zone("n", { left: 0, right: 0, top: -T / 2, height: T })}
              {zone("s", { left: 0, right: 0, bottom: -T / 2, height: T })}
              {zone("w", { top: 0, bottom: 0, left: -T / 2, width: T })}
              {zone("e", { top: 0, bottom: 0, right: -T / 2, width: T })}
              {CORNERS.map(([m, fx, fy]) => zone(m, { left: fx * R.width - T * 0.75, top: fy * R.height - T * 0.75, width: T * 1.5, height: T * 1.5 }))}
              {[...CORNERS, ...EDGES].map(([m, fx, fy]) => (
                <span key={"h" + m} data-crop-handle={m} aria-hidden="true"
                      style={{ position: "absolute", left: fx * R.width - 18, top: fy * R.height - 18, width: 36, height: 36, display: "grid", placeItems: "center", pointerEvents: "none" }}>
                  <span style={{ width: m.length === 2 ? 14 : 12, height: m.length === 2 ? 14 : 12, background: "#2C97A8", border: "2px solid #fff", borderRadius: 3, boxShadow: "0 1px 3px rgba(15,23,42,.4)" }} />
                </span>
              ))}
            </div>
          </div>
        </div>

        {allowScale && (
          <div className="px-5 py-3 border-t border-slate-200 dark:border-[#2A3947] flex flex-wrap items-end gap-x-6 gap-y-2 text-sm">
            {paper && <div><div className="text-[10px] tracking-[0.2em] uppercase text-slate-500 dark:text-slate-400 mb-1">Paper</div><div className="text-slate-800 dark:text-slate-100 py-1.5">{paper}</div></div>}
            <label className="block">
              <div className="text-[10px] tracking-[0.2em] uppercase text-slate-500 dark:text-slate-400 mb-1">Original drawing scale</div>
              <select className={sel} value={drawingScale || ""} disabled={busy} onChange={(e) => setDrawingScale(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Not known (fit to sheet, NTS)</option>
                {DRAWING_SCALES.map((n) => <option key={n} value={n}>1:{n}</option>)}
              </select>
            </label>
            {drawingScale && (fitting.length ? (
              <label className="block">
                <div className="text-[10px] tracking-[0.2em] uppercase text-slate-500 dark:text-slate-400 mb-1">Prints on this sheet at</div>
                <select className={sel} value={sheetScale || ""} disabled={busy} onChange={(e) => setSheetScale(Number(e.target.value))}>
                  {fitting.map((n) => <option key={n} value={n}>1:{n} @ A3</option>)}
                </select>
              </label>
            ) : (
              <div className="text-amber-700 dark:text-amber-300 text-xs max-w-[320px] py-1.5">Too big for A3 even at 1:500. It will be fitted to the sheet and shown as NTS. Crop to a smaller area to print it to scale.</div>
            ))}
            {real && <div className="text-xs text-slate-500 dark:text-slate-400 py-1.5 tabular-nums whitespace-nowrap min-w-[17rem]">Area kept is about {fmtM(real.w)} × {fmtM(real.h)} m on site.</div>}
          </div>
        )}

        {/* Same shape whether or not the size would change, so it never moves the page. */}
        {symbols && symbols.count > 0 && (
          <div className="px-5 py-2.5 border-t border-slate-200 dark:border-[#2A3947] text-sm">
            <label className={`flex items-start gap-2.5 ${sizeChanges ? "cursor-pointer" : "opacity-60"}`}>
              <input type="checkbox" className="mt-0.5 w-4 h-4 accent-[#2C97A8]" checked={sizeChanges && resizeSymbols} disabled={busy || !sizeChanges} onChange={(e) => setResizeSymbols(e.target.checked)} />
              <span>
                <span className="font-medium text-slate-800 dark:text-slate-100">Resize symbols to suit the new scale</span>
                <span className="tabular-nums text-slate-500 dark:text-slate-400">{sizeChanges
                  ? ` (${pct(symbols.scale)} → ${pct(newSymbolScale)}${symbols.scale * factor < SYMBOL_SCALE.min ? ", as small as they go" : symbols.scale * factor > SYMBOL_SCALE.max ? ", as big as they go" : ""}: the plan is drawn ${factor < 1 ? `${fmtM(1 / factor)} times smaller` : `${fmtM(factor)} times bigger`})`
                  : " (no change: the plan stays the same size)"}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  Resized, each symbol covers the same part of the building; unticked, symbols keep their printed size. Change it any time with Symbol size.
                </span>
              </span>
            </label>
          </div>
        )}

        <div className="px-5 py-3 border-t border-slate-200 dark:border-[#2A3947] flex flex-wrap items-center justify-end gap-2 min-h-[64px]">
          {error ? <div role="alert" className="mr-auto text-xs font-medium text-red-700 dark:text-red-300 max-w-[520px]">{error}</div>
            : blocked ? <div role="status" className="mr-auto text-xs font-medium text-amber-700 dark:text-amber-300 max-w-[520px]">{cutMessage(cut)}</div>
            : note && <div className="mr-auto text-xs text-slate-500 dark:text-slate-400 max-w-[460px]">{note}</div>}
          <button type="button" className={btn2} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={btn2} onClick={() => apply(true)} disabled={busy}>Use whole page</button>
          <button type="button" onClick={() => apply(false)} disabled={busy || (blocked && !isWhole)}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--action,#2C97A8)] text-[color:var(--action-ink,#1A2530)] hover:bg-[var(--action-hover,#2C97A8)] disabled:opacity-40">
            {busy ? "Preparing the plan…" : isWhole ? "Use whole page" : "Use this area"}
          </button>
        </div>
      </div>
    </div>
  );
}
