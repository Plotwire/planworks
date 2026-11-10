"use client";

import React, { useEffect, useRef, useState } from "react";

// "How to use Plotwire": the 2-minute walkthrough video, opened from Help in
// the dashboard's side menu (components/OfflinePanel.jsx HelpMenu) and from
// the tour card on the dashboard (TourCard below). Beside it, an index of the
// six chapters and the features in each: tap one to jump there. The video
// and its poster live in public/help/ and are never kept for offline use
// (public/sw.js skips /help/), so with no signal the player says it needs
// signal. The times come from the video itself (made with the social pack's
// lofi/compose.mjs, which writes them out). Styles: .help-video-* and
// .tour-* in components/HomeScreen.jsx.

export const HELP_VIDEO = {
  src: "/help/how-to-use-plotwire.mp4",
  poster: "/help/how-to-use-plotwire.jpg",
  chapters: [
    { t: 2, label: "Getting the plan in", topics: [
      { t: 3.1, label: "Import a PDF or photo" }, { t: 4.1, label: "Crop" }, { t: 6.4, label: "True scale" },
      { t: 10.4, label: "Floor plan tool" }, { t: 13.2, label: "Floors" }, { t: 15.1, label: "Save" }] },
    { t: 16.8, label: "Drawing the layout", topics: [
      { t: 17.9, label: "Symbols and search" }, { t: 19.8, label: "Facing the wall" }, { t: 25.4, label: "Recent symbols" },
      { t: 27, label: "Grid" }, { t: 31.6, label: "Wire tool" }, { t: 34.7, label: "Labels" }, { t: 36.5, label: "Mirror copy" },
      { t: 42.3, label: "Colours and wire lines" }, { t: 50.9, label: "Undo" }, { t: 53.9, label: "Symbol Library" }] },
    { t: 57.8, label: "Looking professional", topics: [
      { t: 59, label: "Logo and business details" }, { t: 64.2, label: "Title block" }] },
    { t: 70.8, label: "Quoting", topics: [
      { t: 72, label: "Counted from the drawing" }, { t: 74.4, label: "Presets" }, { t: 77.4, label: "Prices and labour" },
      { t: 79.5, label: "VAT" }, { t: 85, label: "What the customer sees" }, { t: 88.2, label: "Downloads" }] },
    { t: 91.9, label: "Getting it out", topics: [
      { t: 93, label: "Drawing PDF" }, { t: 100.5, label: "Work planner" }, { t: 104.3, label: "Sharing the week" }] },
    { t: 111.3, label: "On site", topics: [
      { t: 112.4, label: "iPad" }, { t: 116.5, label: "No signal" }] },
  ],
};

const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const TOPICS = HELP_VIDEO.chapters.flatMap((c) => c.topics);

export default function HelpVideo({ onClose }) {
  const ref = useRef(null);
  const [at, setAt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const jump = (t) => {
    const v = ref.current; if (!v) return;
    v.currentTime = t;
    v.play().catch(() => {});
  };
  // the feature playing now: the last one started
  const now = TOPICS.reduce((c, tp) => (at >= tp.t ? tp : c), null);
  return (
    <div className="pw-modal-back" onClick={onClose}>
      <div className="pw-modal help-video" role="dialog" aria-modal="true" aria-labelledby="help-video-title" onClick={(e) => e.stopPropagation()}>
        <div className="help-video-head">
          <h3 id="help-video-title" className="pw-modal-title">How to use Plotwire</h3>
          <button type="button" className="help-video-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </div>
        <div className="help-video-body">
          {failed ? (
            <div className="help-video-failed" role="status">
              The video needs signal to play. Try again when you&rsquo;re back online.
            </div>
          ) : (
            <video ref={ref} className="help-video-player" src={HELP_VIDEO.src} poster={HELP_VIDEO.poster}
              controls playsInline preload="metadata" autoPlay
              onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)} onError={() => setFailed(true)} />
          )}
          <nav className="help-video-index" aria-label="Jump to a part of the video">
            {HELP_VIDEO.chapters.map((ch, i) => (
              <div key={ch.t} className="help-video-chapter">
                <button type="button" className="help-video-chapter-head" disabled={failed} onClick={() => jump(ch.t)}>
                  {i + 1}. {ch.label}<span className="help-video-time">{mmss(ch.t)}</span>
                </button>
                <div className="help-video-topics">
                  {ch.topics.map((tp) => (
                    <button key={tp.t} type="button" disabled={failed} aria-current={tp === now ? "true" : undefined}
                      className={`help-video-topic${tp === now ? " is-now" : ""}`} onClick={() => jump(tp.t)}>
                      {tp.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}

// The dashboard card: shown until it's closed, so new accounts and existing
// ones both get one look at it. Closed for good on this device; the video
// stays in Help.
const TOUR_KEY = "plotwire:tourDismissed";

export function TourCard() {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { setShow(localStorage.getItem(TOUR_KEY) !== "1"); } catch { setShow(true); }
  }, []);
  const close = () => {
    setShow(false);
    try { localStorage.setItem(TOUR_KEY, "1"); } catch {}
  };
  if (!show && !open) return null;
  return (
    <>
      {show && (
        <div className="tour-card">
          <button type="button" className="tour-play" aria-label="Watch how to use Plotwire" onClick={() => setOpen(true)}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8a.8.8 0 0 0-1.2.7z"/></svg>
          </button>
          <div className="tour-text" onClick={() => setOpen(true)}>
            <div className="t">How to use Plotwire, in 2 minutes</div>
            <div className="s">Mirror copy, the grid, colours, the title block, your logo, quotes and more. It&rsquo;s always in Help too.</div>
          </div>
          <button type="button" className="tour-close" aria-label="Hide this" title="Hide this" onClick={close}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </div>
      )}
      {open && <HelpVideo onClose={() => setOpen(false)} />}
    </>
  );
}
