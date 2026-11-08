"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";

const ACTION_BTN = "bg-[var(--action)] hover:bg-[var(--action-hover)] text-[color:var(--action-ink)]";

// What a signed-in operative sees, at every address (components/AppShell.jsx).
// The timesheet form comes in a later batch.
//
// Sign-out here ends the Supabase session and nothing else, on purpose. The
// owner's sign-out also clears what is kept on the device, and an owner may
// share this device: their unsent work must stay.
export default function OperativeApp({ user }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  // Set after each move to this address, which otherwise leaves the tab blank.
  const pathname = usePathname();
  useEffect(() => { document.title = "Timesheets — Plotwire"; }, [pathname]);

  const signOut = async () => {
    const failed = "Couldn't sign out. Check your connection and try again.";
    setBusy(true);
    setNote("");
    try {
      const { error } = (await supabase?.auth.signOut()) || {};
      if (error) setNote(failed);
    } catch {
      setNote(failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full min-h-screen flex items-center justify-center px-4 text-white"
      style={{ background: "linear-gradient(150deg,#1A2530 0%,#233241 55%,#2C4150 100%)" }}>
      <main className="max-w-[420px] w-full text-center">
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.01em]">Timesheets</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[#aab8c6]">
          You&rsquo;re signed in as an operative. Your timesheet will appear here soon.
        </p>
        {user?.email && <p className="mt-2 text-[13px] text-[#aab8c6] break-words">{user.email}</p>}
        <div className="mt-6 flex justify-center">
          <button type="button" onClick={signOut} disabled={busy}
            className={`h-11 px-5 rounded-[11px] text-[14px] font-semibold transition-colors disabled:opacity-60 ${ACTION_BTN}`}>
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
        {note && <p role="alert" className="mt-3 text-[13px] text-[#aab8c6]">{note}</p>}
      </main>
    </div>
  );
}
