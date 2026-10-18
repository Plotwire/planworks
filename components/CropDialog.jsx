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
 * onApply  ({ crop, drawingScale, sheetScale }) -- crop null = whole page;
 *          sheetScale null = fitted to the sheet (NTS).
 * error    shown in red while the dialog stays open (a change that was
 *          refused, so the user can try another crop or scale).
 * ========================================================================== */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { DRAWING_SCALES, cropMmOf, fittingScales, paperName, realSizeM, validRect } from "@/lib/planCrop";

const HANDLES = [
  ["nw", 0, 0], ["n", 0.5, 0], ["ne", 1, 0], ["e", 1, 0.5],
  ["se", 1, 1], ["s", 0.5, 1], ["sw", 0, 1], ["w", 0, 0.5],
];
const CURSOR = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
const fmtM = (m) => (m >= 10 ? m.toFixed(1) : m.toFixed(2)).replace(/\.?0+$/, "");

export default function CropDialog({ mode = "import", source, initial = {}, allowScale = false, busy = false, note = null, error = null, onCancel, onApply }) {
  const W = source.w, H = source.h;
  const whole = { x: 0, y: 0, w: W, h: H };
  const [crop, setCrop] = useState(() => (validRect(initial.crop) ? initial.crop : whole));
  const [drawingScale, setDrawingScale] = useState(initial.drawingScale || null);
  const [sheetScale, setSheetScale] = useState(initial.sheetScale || null);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const drag = useRef(null);

  // The page fitted to the space the dialog has.
  const [view, setView] = useState(() => (typeof window === "undefined" ? { vw: 1024, vh: 768 } : { vw: window.innerWidth, vh: window.innerHeight }));
  useEffect(() => {
    const read = () => setView({ vw: window.innerWidth, vh: window.innerHeight });
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  const s = Math.max(0.01, Math.min((Math.min(view.vw - 48, 1180) - 32) / W, (view.vh - (allowScale ? 330 : 250)) / H));
  const cssW = Math.round(W * s), cssH = Math.round(H * s);

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
  const at = (e) => {
    const b = stageRef.current.getBoundingClientRect();
    return { u: Math.min(Math.max((e.clientX - b.left) / s, 0), W), v: Math.min(Math.max((e.clientY - b.top) / s, 0), H) };
  };
  const start = (m) => (e) => {
    if (busy) return;
    e.preventDefault(); e.stopPropagation();
    try { stageRef.current.setPointerCapture(e.pointerId); } catch { /* fine */ }
    drag.current = { m, id: e.pointerId, x0: e.clientX, y0: e.clientY, r0: crop, p0: at(e) };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = (e.clientX - d.x0) / s, dy = (e.clientY - d.y0) / s;
    if (d.m === "move") setCrop(clampRect({ ...d.r0, x: d.r0.x + dx, y: d.r0.y + dy }));
    else if (d.m === "new") {
      const p = at(e);
      const x = Math.min(d.p0.u, p.u), y = Math.min(d.p0.v, p.v);
      if (Math.abs(p.u - d.p0.u) > minSide / 2 || Math.abs(p.v - d.p0.v) > minSide / 2) {
        setCrop(clampRect({ x, y, w: Math.abs(p.u - d.p0.u), h: Math.abs(p.v - d.p0.v) }));
      }
    } else setCrop(resize(d.r0, d.m, dx, dy));
  };
  const end = (e) => { if (drag.current && e.pointerId === drag.current.id) drag.current = null; };

  const isWhole = crop.x < 0.5 && crop.y < 0.5 && Math.abs(crop.w - W) < 0.5 && Math.abs(crop.h - H) < 0.5;
  const apply = (useWhole) => {
    const c = useWhole || isWhole ? null : crop;
    let sheet = sheetScale;
    if (useWhole && drawingScale && pageMm) {
      const f = fittingScales(cropMmOf(null, W, H, pageMm), drawingScale);
      sheet = f.includes(sheetScale) ? sheetScale : f[0] || null;
    }
    onApply({ crop: c, drawingScale: allowScale ? drawingScale : null, sheetScale: allowScale && drawingScale ? sheet : null });
  };

  const R = { left: crop.x * s, top: crop.y * s, width: crop.w * s, height: crop.h * s };
  const paper = pageMm ? `${paperName(pageMm) ? paperName(pageMm) + " · " : ""}${Math.round(pageMm.w)} × ${Math.round(pageMm.h)} mm` : null;
  const real = cropMm && drawingScale ? realSizeM(cropMm, drawingScale) : null;
  const sel = "px-2.5 py-1.5 text-sm bg-white dark:bg-[#0E141B] rounded-lg ring-1 ring-slate-200 dark:ring-[#2A3947] text-slate-900 dark:text-slate-100 focus:ring-[#3FB7C9] focus:outline-none";
  const btn2 = "px-4 py-2 rounded-lg text-sm font-semibold ring-1 ring-slate-300 dark:ring-[#2A3947] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={mode === "adjust" ? "Adjust crop and scale" : "Crop the plan"}>
      <div className="bg-white dark:bg-[#16202B] rounded-2xl ring-1 ring-slate-200 dark:ring-[#2A3947] shadow-2xl flex flex-col max-w-full max-h-full overflow-hidden">
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

        <div className="p-4 flex justify-center bg-slate-100 dark:bg-[#0E141B] overflow-auto">
          <div ref={stageRef} className="relative select-none" style={{ width: cssW, height: cssH, touchAction: "none", cursor: "crosshair" }}
               onPointerDown={start("new")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
            <canvas ref={canvasRef} style={{ width: cssW, height: cssH, display: "block", boxShadow: "0 1px 3px rgba(15,23,42,.25)" }} />
            {/* Outside the crop, dimmed */}
            {[[0, 0, cssW, R.top], [0, R.top + R.height, cssW, cssH - R.top - R.height], [0, R.top, R.left, R.height], [R.left + R.width, R.top, cssW - R.left - R.width, R.height]].map(([l, t, w, h], i) => (
              <div key={i} aria-hidden="true" style={{ position: "absolute", left: l, top: t, width: Math.max(0, w), height: Math.max(0, h), background: "rgba(15,23,42,.45)", pointerEvents: "none" }} />
            ))}
            <div data-crop-rect style={{ position: "absolute", ...R, outline: "2px solid #2C97A8", boxShadow: "0 0 0 1px rgba(255,255,255,.9) inset", cursor: "move" }}
                 onPointerDown={start("move")}>
              {HANDLES.map(([m, fx, fy]) => (
                <div key={m} data-crop-handle={m} aria-label={`Crop ${m} handle`} onPointerDown={start(m)}
                     style={{ position: "absolute", left: fx * R.width - 18, top: fy * R.height - 18, width: 36, height: 36, cursor: CURSOR[m], display: "grid", placeItems: "center", touchAction: "none" }}>
                  <span style={{ width: m.length === 2 ? 14 : 12, height: m.length === 2 ? 14 : 12, background: "#2C97A8", border: "2px solid #fff", borderRadius: 3, boxShadow: "0 1px 3px rgba(15,23,42,.4)" }} />
                </div>
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
            {real && <div className="text-xs text-slate-500 dark:text-slate-400 py-1.5">Area kept is about {fmtM(real.w)} × {fmtM(real.h)} m on site.</div>}
          </div>
        )}

        <div className="px-5 py-3 border-t border-slate-200 dark:border-[#2A3947] flex flex-wrap items-center justify-end gap-2">
          {error ? <div role="alert" className="mr-auto text-xs font-medium text-red-700 dark:text-red-300 max-w-[520px]">{error}</div>
            : note && <div className="mr-auto text-xs text-slate-500 dark:text-slate-400 max-w-[460px]">{note}</div>}
          <button type="button" className={btn2} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={btn2} onClick={() => apply(true)} disabled={busy}>Use whole page</button>
          <button type="button" onClick={() => apply(false)} disabled={busy}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--action,#2C97A8)] text-[color:var(--action-ink,#1A2530)] hover:bg-[var(--action-hover,#2C97A8)] disabled:opacity-40">
            {busy ? "Preparing the plan…" : isWhole ? "Use whole page" : "Use this area"}
          </button>
        </div>
      </div>
    </div>
  );
}
