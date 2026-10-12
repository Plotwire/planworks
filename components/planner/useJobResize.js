"use client";
// Stretch a job across days by dragging the handle on its right edge. The
// handle takes the pointer straight away (no long-press, even on iPad), so it
// never starts a card drag or a scroll. resolveDate(x, y) says which day the
// pointer is over; onResize(job, endDate) gets the result on release.
import { useCallback, useRef, useState } from "react";

export function useJobResize({ resolveDate, onResize, canResize, onBlocked }) {
  const opt = useRef({ resolveDate, onResize, canResize, onBlocked });
  opt.current = { resolveDate, onResize, canResize, onBlocked };
  const [resizing, setResizing] = useState(null); // { job, end, x, y }

  const onHandleDown = useCallback((e, job) => {
    e.stopPropagation();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    if (!opt.current.canResize) { opt.current.onBlocked?.(job); return; }
    const el = e.currentTarget;
    const id = e.pointerId;
    try { el.setPointerCapture(id); } catch {}
    const startEnd = job.end && job.end > job.date ? job.end : job.date;
    let end = startEnd;
    setResizing({ job, end, x: e.clientX, y: e.clientY });
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      if (ev.cancelable) ev.preventDefault();
      const d = opt.current.resolveDate(ev.clientX, ev.clientY);
      if (d) end = d < job.date ? job.date : d;
      setResizing({ job, end, x: ev.clientX, y: ev.clientY });
    };
    const finish = (ev, keep) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      try { el.releasePointerCapture(id); } catch {}
      setResizing(null);
      if (keep && end !== startEnd) opt.current.onResize(job, end);
    };
    const up = (ev) => finish(ev, true);
    const cancel = (ev) => finish(ev, false);
    const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); finish({ pointerId: id }, false); } };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
  }, []);

  return { resizing, onHandleDown };
}
