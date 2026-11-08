"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";

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
    <div className="pw-op">
      <style>{CSS}</style>
      <div className="op-glow" />
      <header className="op-top">
        <span className="op-brandmark">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 2 4 13h6l-1 9 9-11h-6l1-9z" fill="#08313a"/></svg>
        </span>
        <span className="op-wordmark">Plot<b>wire</b></span>
      </header>
      <main className="op-main">
        <div className="op-card">
          <div className="op-eyebrow">Timesheets</div>
          <h1>You&rsquo;re signed in</h1>
          <p>You&rsquo;re signed in as an operative. Your timesheet will appear here soon.</p>
          {user?.email && <div className="op-who">{user.email}</div>}
          <button type="button" className="op-signout" onClick={signOut} disabled={busy}>
            <LogOut strokeWidth={2} />
            <span>{busy ? "Signing out…" : "Sign out"}</span>
          </button>
          {note && <p role="alert" className="op-note">{note}</p>}
        </div>
      </main>
    </div>
  );
}

const CSS = `
.pw-op{position:fixed; inset:0; overflow-x:hidden; overflow-y:auto; display:flex; flex-direction:column; color:#fff;
  background:linear-gradient(150deg,#1A2530 0%,#233241 60%,#2C4150 100%);
  font-family:var(--font-inter),system-ui,sans-serif; -webkit-font-smoothing:antialiased}
.pw-op *{box-sizing:border-box; margin:0; padding:0}
.pw-op::before{content:""; position:absolute; inset:0; pointer-events:none;
  background-image:linear-gradient(rgba(63,183,201,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(63,183,201,.12) 1px,transparent 1px);
  background-size:26px 26px; -webkit-mask-image:linear-gradient(160deg,transparent 35%,#000 100%); mask-image:linear-gradient(160deg,transparent 35%,#000 100%)}
.pw-op .op-glow{position:absolute; right:-90px; top:-100px; width:340px; height:340px; border-radius:50%; pointer-events:none; background:radial-gradient(circle,rgba(63,183,201,.32),transparent 68%)}
.pw-op .op-top{position:relative; display:flex; align-items:center; gap:12px; padding:22px 22px 0}
.pw-op .op-brandmark{width:42px; height:42px; border-radius:12px; display:grid; place-items:center; background:linear-gradient(150deg,#3FB7C9,#22808F); box-shadow:0 6px 16px -4px rgba(63,183,201,.5)}
.pw-op .op-brandmark svg{width:22px; height:22px}
.pw-op .op-wordmark{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:20px; letter-spacing:-.01em}
.pw-op .op-wordmark b{color:#3FB7C9; font-weight:600}
.pw-op .op-main{position:relative; flex:1; display:grid; place-items:center; padding:24px 18px 44px}
.pw-op .op-card{width:100%; max-width:420px; padding:28px 24px; border-radius:20px; background:#FFFFFF; color:#0E141B; box-shadow:0 24px 60px -12px rgba(11,17,23,.45)}
html.dark .pw-op .op-card{background:#16202B; color:#E7EDF3}
.pw-op .op-eyebrow{font-family:var(--font-jetbrains-mono),monospace; font-size:11.5px; letter-spacing:.16em; text-transform:uppercase; color:#22808F; margin-bottom:10px}
html.dark .pw-op .op-eyebrow{color:#3FB7C9}
.pw-op h1{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:26px; letter-spacing:-.02em; line-height:1.1}
.pw-op p{margin-top:9px; font-size:14.5px; line-height:1.55; color:#697785}
html.dark .pw-op p{color:#8595A3}
.pw-op .op-who{margin-top:16px; padding:10px 12px; border-radius:10px; font-size:13.5px; color:#3A4654; background:#F4F6F9; overflow-wrap:anywhere}
html.dark .pw-op .op-who{color:#B6C2CE; background:#0E141B}
.pw-op .op-signout{margin-top:18px; width:100%; height:50px; display:flex; align-items:center; justify-content:center; gap:9px; border:none; border-radius:12px; background:var(--action); color:var(--action-ink); font-family:inherit; font-size:15px; font-weight:600; cursor:pointer; transition:background .15s ease}
.pw-op .op-signout:hover:not(:disabled){background:var(--action-hover)}
.pw-op .op-signout:disabled{opacity:.6; cursor:not-allowed}
.pw-op .op-signout svg{width:19px; height:19px; flex:none}
.pw-op .op-note{font-size:13px; color:#B91C1C}
html.dark .pw-op .op-note{color:#F87171}
`;
