"use client";
// Drag, tap and long-press for planner job cards, on pointer events so the
// same code works with a mouse and on an iPad.
//
// Mouse: press and move 5 px to drag; a click opens the job; right-click is
// the card's own onContextMenu. Touch: a quick tap opens the job; hold still
// for 0.4 s and the card lifts -- move to drag it, or let go to open the menu.
// Moving before it lifts is a scroll, which is left to the browser. While a
// card is lifted or dragged, the page doesn't scroll under the finger.
//
// The caller decides what a drop means: resolveTarget(x, y, job) looks under
// the pointer (the ghost card ignores the pointer) and onDrop gets the result.
import { useCallback, useEffect, useRef, useState } from "react";

const LIFT_MS = 400;
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 10;
const EDGE = 56;       // px from a scroll edge where auto-scroll starts
const MAX_SPEED = 18;  // px per frame at the very edge

export function useJobDrag(options) {
  const opt = useRef(options);
  opt.current = options;
  const [drag, setDrag] = useState(null);       // { job, extra, x, y, w, h, offX, offY, target }
  const [lifted, setLifted] = useState(null);   // id of a card held on touch
  const g = useRef(null);                        // the gesture in progress
  const raf = useRef(0);

  const stopScroll = useCallback(() => { cancelAnimationFrame(raf.current); raf.current = 0; }, []);

  const cleanup = useCallback(() => {
    const s = g.current;
    if (!s) return;
    clearTimeout(s.timer);
    window.removeEventListener("pointermove", s.move);
    window.removeEventListener("pointerup", s.up);
    window.removeEventListener("pointercancel", s.cancel);
    window.removeEventListener("keydown", s.key, true);
    document.removeEventListener("touchmove", s.block);
    try { s.el.releasePointerCapture?.(s.id); } catch {}
    g.current = null;
    stopScroll();
    setLifted(null);
  }, [stopScroll]);

  useEffect(() => () => cleanup(), [cleanup]);

  // Keep the board and the page moving when the pointer nears an edge.
  const autoScroll = useCallback(() => {
    const s = g.current;
    if (!s || s.mode !== "drag") { raf.current = 0; return; }
    const box = opt.current.scrollRef?.current;
    let moved = false;
    const speed = (d) => Math.ceil(((EDGE - d) / EDGE) * MAX_SPEED);
    if (box) {
      const r = box.getBoundingClientRect();
      if (s.x < r.left + EDGE && s.x > r.left - 20) { box.scrollLeft -= speed(s.x - r.left); moved = true; }
      else if (s.x > r.right - EDGE && s.x < r.right + 20) { box.scrollLeft += speed(r.right - s.x); moved = true; }
      if (s.y < r.top + EDGE && s.y > r.top - 20) { box.scrollTop -= speed(s.y - r.top); moved = true; }
      else if (s.y > r.bottom - EDGE && s.y < r.bottom + 20) { box.scrollTop += speed(r.bottom - s.y); moved = true; }
    }
    if (s.y < EDGE) { window.scrollBy(0, -speed(s.y)); moved = true; }
    else if (s.y > window.innerHeight - EDGE) { window.scrollBy(0, speed(window.innerHeight - s.y)); moved = true; }
    if (moved) {
      const target = opt.current.resolveTarget(s.x, s.y, s.job, s.extra);
      setDrag((d) => (d ? { ...d, target } : d));
    }
    raf.current = requestAnimationFrame(autoScroll);
  }, []);

  const startDrag = useCallback(() => {
    const s = g.current;
    if (!s) return;
    if (!opt.current.canDrag) { const job = s.job; cleanup(); opt.current.onBlocked?.(job); return; }
    s.mode = "drag";
    try { s.el.setPointerCapture?.(s.id); } catch {}
    const r = s.rect;
    const target = opt.current.resolveTarget(s.x, s.y, s.job, s.extra);
    setLifted(null);
    setDrag({ job: s.job, extra: s.extra, x: s.x, y: s.y, w: r.width, h: r.height, offX: s.sx - r.left, offY: s.sy - r.top, target });
    if (!raf.current) raf.current = requestAnimationFrame(autoScroll);
  }, [autoScroll, cleanup]);

  const onPointerDown = useCallback((e, job, extra = null) => {
    if (e.pointerType === "mouse" && e.button !== 0) return; // right-click: the card's onContextMenu
    if (g.current) return;
    const el = e.currentTarget;
    const touch = e.pointerType !== "mouse";
    const s = {
      job, extra, el, id: e.pointerId, touch,
      sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY,
      rect: el.getBoundingClientRect(), mode: "press", timer: 0,
    };
    s.move = (ev) => {
      if (ev.pointerId !== s.id) return;
      s.x = ev.clientX; s.y = ev.clientY;
      const dist = Math.hypot(s.x - s.sx, s.y - s.sy);
      if (s.mode === "press") {
        if (!touch && dist > MOUSE_SLOP) startDrag();
        else if (touch && dist > TOUCH_SLOP) cleanup(); // a scroll, not a press
        return;
      }
      if (s.mode === "lifted") { if (dist > 6) startDrag(); return; }
      if (s.mode === "drag") {
        if (ev.cancelable) ev.preventDefault();
        const target = opt.current.resolveTarget(s.x, s.y, s.job, s.extra);
        setDrag((d) => (d ? { ...d, x: s.x, y: s.y, target } : d));
      }
    };
    s.up = (ev) => {
      if (ev.pointerId !== s.id) return;
      const { mode } = s;
      const target = mode === "drag" ? opt.current.resolveTarget(s.x, s.y, s.job, s.extra) : null;
      cleanup();
      if (mode === "drag") { setDrag(null); opt.current.onDrop?.(s.job, target, s.extra); }
      else if (mode === "lifted") opt.current.onMenu?.(s.job, s.x, s.y, s.extra);
      else opt.current.onTap?.(s.job, s.extra);
    };
    s.cancel = (ev) => {
      if (ev.pointerId !== s.id) return;
      const wasDrag = s.mode === "drag";
      cleanup();
      if (wasDrag) setDrag(null);
    };
    s.key = (ev) => {
      if (ev.key === "Escape" && s.mode === "drag") { ev.preventDefault(); ev.stopPropagation(); cleanup(); setDrag(null); }
    };
    // Lifted or dragging on a touch screen: the finger moves the card, not the page.
    s.block = (ev) => { if (s.mode === "lifted" || s.mode === "drag") { if (ev.cancelable) ev.preventDefault(); } };
    g.current = s;
    window.addEventListener("pointermove", s.move, { passive: false });
    window.addEventListener("pointerup", s.up);
    window.addEventListener("pointercancel", s.cancel);
    window.addEventListener("keydown", s.key, true);
    if (touch) {
      document.addEventListener("touchmove", s.block, { passive: false });
      s.timer = setTimeout(() => {
        if (g.current !== s || s.mode !== "press") return;
        s.mode = "lifted";
        setLifted(job.id);
        try { navigator.vibrate?.(12); } catch {}
      }, LIFT_MS);
    }
  }, [cleanup, startDrag]);

  // A long-press on iPad can also raise contextmenu: our own lift handles it.
  const busy = () => Boolean(g.current && g.current.touch);

  return { drag, lifted, onPointerDown, busy };
}
