"use client";

import React, { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { StatusIcon } from "@/components/StatusMark";
import { getContext, getPickLists } from "@/lib/timesheets/entries";
import WorkerWeek, { WORKER_CSS } from "@/components/timesheets/WorkerWeek";

// What a signed-in worker sees, at every address (components/AppShell.jsx):
// their own week, and nothing else in Plotwire. The database decides what
// they can read and change (supabase/timesheets.sql, timesheets-week.sql).
//
// Sign-out here ends the Supabase session and nothing else, on purpose. The
// owner's sign-out also clears what is kept on the device, and an owner may
// share this device: their unsent work must stay.
export default function OperativeApp({ user }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [ctx, setCtx] = useState(null);
  const [lists, setLists] = useState(null);
  const [failed, setFailed] = useState(false);

  // Set after each move to this address, which otherwise leaves the tab blank.
  const pathname = usePathname();
  useEffect(() => { document.title = "Timesheets — Plotwire"; }, [pathname]);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const c = await getContext();
      setCtx(c);
      if (c?.role === "operative" && c.addon && c.status === "active") setLists(await getPickLists());
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const signOut = async () => {
    const failedText = "Couldn't sign out. Check your connection and try again.";
    setBusy(true);
    setNote("");
    try {
      const { error } = (await supabase?.auth.signOut()) || {};
      if (error) setNote(failedText);
    } catch {
      setNote(failedText);
    } finally {
      setBusy(false);
    }
  };

  const ready = ctx?.role === "operative" && ctx.addon && ctx.status === "active" && lists;
  // Not ready to record hours, and why, in plain words.
  const blocked = failed ? null
    : !ctx ? null
    : ctx.role !== "operative" ? "Your login isn't on a team yet. Ask your boss to add you."
    : !ctx.addon ? `Timesheets is switched off${ctx.company ? ` for ${ctx.company}` : ""}. Ask your boss.`
    : ctx.status !== "active" ? "Your account isn't set up yet. Ask your boss to finish setting you up."
    : null;

  return (
    <div className="pw-tsw">
      <style>{WORKER_CSS}</style>
      <header className="tsw-top">
        <span className="tsw-brandmark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M13 2 4 13h6l-1 9 9-11h-6l1-9z" fill="#08313a"/></svg>
        </span>
        <div className="tsw-who">
          <div className="tsw-name">{ctx?.name || "Timesheets"}</div>
          <div className="tsw-company">{ctx?.company || user?.email || ""}</div>
        </div>
        <button type="button" className="tsw-icon-btn" onClick={signOut} disabled={busy} aria-label="Sign out" title="Sign out">
          <LogOut strokeWidth={2} />
        </button>
      </header>
      {note && <p role="alert" className="tsw-signout-note">{note}</p>}

      <main className="tsw-main">
        {failed ? (
          <div className="tsw-card tsw-message" role="alert">
            <StatusIcon tone="red" size={28} />
            <h2>Couldn&rsquo;t load your timesheet</h2>
            <p>Check your signal and try again.</p>
            <button type="button" className="tsw-btn is-wide" onClick={load}>Try again</button>
          </div>
        ) : blocked ? (
          <div className="tsw-card tsw-message">
            <StatusIcon tone="amber" size={28} />
            <h2>Not ready yet</h2>
            <p>{blocked}</p>
          </div>
        ) : ready ? (
          <WorkerWeek ctx={ctx} lists={lists} />
        ) : (
          <div className="tsw-card tsw-loading" aria-label="Loading">Loading your week…</div>
        )}
      </main>
    </div>
  );
}
