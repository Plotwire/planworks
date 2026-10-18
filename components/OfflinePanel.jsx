"use client";

import React, { useEffect, useRef, useState } from "react";
import { subscribeLibrary, libraryStatus, updateLibrary, appReady } from "@/lib/device/library";
import { StatusIcon } from "@/components/StatusMark";

// The dashboard's line about the offline library (lib/device/library.js):
// how many drawings are kept on this device for working without signal, and,
// opened, how much storage that uses, whether the browser has promised to
// keep it, and "Update now". Styles: .offline-* in components/HomeScreen.jsx.

const size = (b) => {
  if (b == null) return "–";
  if (b < 1e6) return `${Math.max(1, Math.round(b / 1e3))} KB`;
  if (b < 1e9) return `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB`;
  return `${(b / 1e9).toFixed(1)} GB`;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default function OfflinePanel() {
  const [st, setSt] = useState(libraryStatus());
  const [open, setOpen] = useState(false);
  useEffect(() => subscribeLibrary(setSt), []);
  if (st.state === "off") return null;

  const total = st.drawingsTotal;
  const drawingsDone = total !== null && st.drawings >= total && (st.filesTotal === null || st.files >= st.filesTotal);
  // The app itself (public/sw.js): every page and code file kept too.
  const appDone = appReady(st.app);
  const complete = drawingsDone && appDone;
  // Traffic-light status (components/StatusMark.jsx): green tick ready to
  // work offline, amber clock still downloading, red warning needs signal
  // (or space).
  const ofTotal = `${st.drawings}${total !== null ? ` of ${total}` : ""}`;
  let tone, lead, line;
  if (st.state === "updating") {
    tone = "amber"; lead = "Still downloading:";
    line = total !== null ? `keeping your drawings on this device, ${st.drawings} of ${total}.` : "checking your drawings…";
  } else if (st.state === "full") {
    tone = "red"; lead = "Needs space:";
    line = `this device is nearly out of storage. ${ofTotal} drawings are kept for working offline.`;
  } else if (complete) {
    tone = "green"; lead = "Ready to work offline:";
    line = total === 0 ? "your drawings will be kept on this device." : `all ${plural(total, "drawing", "drawings")} and their plans are on this device.`;
  } else if (st.state === "offline") {
    tone = "red"; lead = "Needs signal:";
    line = appDone
      ? `${ofTotal} drawings are on this device. The rest need signal once to download.`
      : `${plural(st.drawings, "drawing is", "drawings are")} on this device, but parts of Plotwire still need signal once to download.`;
  } else if (drawingsDone) {
    tone = "amber"; lead = "Still downloading:";
    line = st.app && st.app.total ? `the rest of Plotwire, ${st.app.kept} of ${st.app.total} parts.` : "Plotwire itself…";
  } else {
    tone = "amber"; lead = "Still downloading:";
    line = `${ofTotal} drawings are on this device so far.`;
  }
  const busy = st.state === "updating";
  const noSignal = st.state === "offline";

  return (
    <div className="offline-strip" data-tone={tone} role="status">
      <div className="offline-row">
        <StatusIcon tone={tone} size={22} />
        <span className="offline-line"><strong>{lead}</strong> {line}</span>
        <button type="button" className="mg-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide" : "Storage"}
        </button>
      </div>
      {open && (
        <div className="offline-details">
          <dl>
            <dt>Kept for working without signal</dt>
            <dd>{plural(st.drawings, "drawing", "drawings")} and {plural(st.files, "plan file", "plan files")}: {size(st.bytes)}</dd>
            <dt>Plotwire itself</dt>
            <dd>
              {!st.app ? "Not kept by this browser"
                : appDone ? `Kept: all ${st.app.total} parts`
                : st.app.total ? `${st.app.kept} of ${st.app.total} parts kept. The rest need signal once.`
                : "Still downloading"}
            </dd>
            <dt>All Plotwire keeps in this browser</dt>
            <dd>{size(st.usage)}{st.quota ? ` of the ${size(st.quota)} this browser allows` : ""}</dd>
            <dt>Safe from automatic clearing</dt>
            <dd>
              {st.persisted === true ? "Yes" : st.persisted === false
                ? "Not promised by this browser. On an iPad, adding Plotwire to the Home Screen keeps it safe."
                : "Unknown"}
            </dd>
            <dt>Last brought up to date</dt>
            <dd>{st.lastUpdated ? new Date(st.lastUpdated).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Not yet"}</dd>
          </dl>
          <p className="offline-note">Signing out removes everything Plotwire keeps on this device, including these drawings and plans. Saves still waiting for signal are lost too (you'll be asked first).</p>
          <button type="button" className="mg-primary" onClick={updateLibrary} disabled={busy || noSignal}>
            {busy ? "Updating…" : noSignal ? "No signal" : "Update now"}
          </button>
        </div>
      )}
    </div>
  );
}

// Help, in the dashboard's side menu: a short menu of help items, each
// opening a short note. Only one so far: working offline on an iPad (adding
// Plotwire to the Home Screen opens it full screen, and keeps what it stores
// for working without signal: Safari clears a website's storage after about
// a week of not being used, but not a Home Screen app's). Styles: .help-* in
// components/HomeScreen.jsx.
export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState(null); // "ipad" while its note shows
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", away, true); window.removeEventListener("keydown", key); };
  }, [open]);
  useEffect(() => {
    if (!topic) return;
    const key = (e) => { if (e.key === "Escape") setTopic(null); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [topic]);
  const toggle = () => setOpen((o) => !o);
  return (
    <div className="help-wrap" ref={ref}>
      <div className={`navitem${open ? " is-open" : ""}`} title="Help" role="button" tabIndex={0} aria-haspopup="menu" aria-expanded={open}
        onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.2-2.5 3.7"/><path d="M12 17.2h.01"/></svg>
      </div>
      {open && (
        <div className="help-menu" role="menu" aria-label="Help">
          <div className="help-head">Help</div>
          <button type="button" role="menuitem" className="help-item" autoFocus onClick={() => { setOpen(false); setTopic("ipad"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><rect x="4.5" y="2.5" width="15" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>
            Using Plotwire offline on iPad
          </button>
        </div>
      )}
      {topic === "ipad" && (
        <div className="pw-modal-back" onClick={() => setTopic(null)}>
          <div className="pw-modal help-note" role="dialog" aria-modal="true" aria-labelledby="help-ipad-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="help-ipad-title" className="pw-modal-title">Using Plotwire offline on iPad</h3>
            <ol>
              <li>In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.</li>
              <li>Open Plotwire from the Home Screen icon and sign in there once. It keeps its own copy of your drawings, separate from Safari.</li>
              <li>With signal, stay on the dashboard until it says all your drawings are on this device.</li>
            </ol>
            <p>With no signal you can then open and change any drawing, start new ones, sketch, quote and make PDFs. Saves upload by themselves when there&rsquo;s signal. The work planner shows as last saved, to look at only.</p>
            <p className="help-why">Why the Home Screen? Safari can clear a website&rsquo;s stored data after about a week without use. A Home Screen app keeps it.</p>
            <div className="pw-modal-actions">
              <button type="button" className="mg-primary" autoFocus onClick={() => setTopic(null)}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
