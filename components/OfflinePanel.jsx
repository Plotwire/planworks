"use client";

import React, { useEffect, useState } from "react";
import { subscribeLibrary, libraryStatus, updateLibrary } from "@/lib/device/library";

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
  const complete = total !== null && st.drawings >= total && (st.filesTotal === null || st.files >= st.filesTotal);
  let line;
  if (st.state === "updating") {
    line = total !== null
      ? `Keeping your drawings on this device for working without signal: ${st.drawings} of ${total}.`
      : "Checking your drawings for working without signal…";
  } else if (st.state === "full") {
    line = `This device is nearly out of storage: ${st.drawings}${total !== null ? ` of ${total}` : ""} drawings are kept for working without signal.`;
  } else if (complete) {
    line = total === 0 ? "Your drawings will be kept on this device for working without signal." : `All ${plural(total, "drawing", "drawings")} and their plans are on this device, ready for working without signal.`;
  } else if (st.state === "offline") {
    line = `No signal: ${plural(st.drawings, "drawing is", "drawings are")} on this device to work on.`;
  } else {
    line = `${st.drawings}${total !== null ? ` of ${total}` : ""} drawings are on this device for working without signal.`;
  }
  const busy = st.state === "updating";
  const noSignal = st.state === "offline";

  return (
    <div className="offline-strip" role="status">
      <div className="offline-row">
        <span className={`offline-dot${complete && !busy ? " is-ready" : ""}${busy ? " is-busy" : ""}`} aria-hidden />
        <span className="offline-line">{line}</span>
        <button type="button" className="mg-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide" : "Storage"}
        </button>
      </div>
      {open && (
        <div className="offline-details">
          <dl>
            <dt>Kept for working without signal</dt>
            <dd>{plural(st.drawings, "drawing", "drawings")} and {plural(st.files, "plan file", "plan files")}: {size(st.bytes)}</dd>
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

// iPad and iPhone in Safari only, once per device: adding Plotwire to the
// Home Screen opens it full screen, and keeps what it stores for working
// without signal (Safari clears a website's storage after about a week of
// not being used; a Home Screen app's it doesn't). "#homescreen-tip" in the
// address shows it anywhere, for testing.
const TIP_KEY = "plotwire:tip:homeScreen";
export function HomeScreenTip() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(TIP_KEY)) return;
      const forced = window.location.hash === "#homescreen-tip";
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const standalone = navigator.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;
      if (forced || (ios && !standalone)) setShow(true);
    } catch { /* storage unavailable: no tip */ }
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try { localStorage.setItem(TIP_KEY, String(Date.now())); } catch { /* shown again next time */ }
    setShow(false);
  };
  return (
    <div className="access-banner homescreen-tip" role="note">
      <div>
        <strong>Working on site without signal? Add Plotwire to your Home Screen.</strong>
        <span> In Safari, tap the Share button, then <b>Add to Home Screen</b>. Plotwire then opens full screen, and your iPad keeps its offline drawings safe (Safari can clear a website&rsquo;s stored data after a week without use). Open it from the Home Screen and sign in once there: it keeps its own copy of your drawings.</span>
      </div>
      <button type="button" className="mg-primary" onClick={dismiss}>Got it</button>
    </div>
  );
}
