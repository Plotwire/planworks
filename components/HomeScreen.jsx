"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Trash2 } from "lucide-react";
import { listProjects, localProjectsPending, migrateLocalProjects, deleteProjectRow, verifyPassword } from "@/lib/db";
import { signPlanImages } from "@/lib/planImages";
import { useApp } from "@/components/AppShell";
import { LEGAL_LINKS } from "@/lib/legal";

/* Sheet geometry â€” must match ElectricalPlanTool */
const SHEET = { width: 1587, height: 1123, margin: 18, legendWidth: 230, notesWidth: 280, titleHeight: 110 };
const DRAW = {
  x: SHEET.margin + SHEET.legendWidth + 8,
  y: SHEET.margin,
  w: SHEET.width - SHEET.margin * 2 - SHEET.legendWidth - SHEET.notesWidth - 16,
  h: SHEET.height - SHEET.margin * 2 - SHEET.titleHeight - 8,
};

// Derive a display name from the logged-in account (metadata name if present,
// otherwise a tidy version of the email's local part). No hardcoded names.
function displayName(user) {
  const meta = user?.user_metadata || {};
  const fromMeta = meta.full_name || meta.name;
  if (fromMeta) return String(fromMeta).trim().split(/\s+/)[0];
  const email = user?.email || "";
  if (!email) return "";
  const local = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "";
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function relTime(iso) {
  if (!iso) return "â€”";
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return mins + (mins === 1 ? " min ago" : " mins ago");
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + (hrs === 1 ? " hour ago" : " hours ago");
  const days = Math.round(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return days + " days ago";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/* Mini plan preview built from the project's real placed symbols + imported plan */
function PlanThumb({ project }) {
  if (!project) {
    return (
      <svg viewBox="0 0 1587 1123" preserveAspectRatio="xMidYMid meet">
        <rect x="40" y="40" width="1507" height="1043" fill="none" stroke="#cbd2da" strokeWidth="3"/>
      </svg>
    );
  }
  // Multi-sheet aware: preview the first drawing (ground floor); fall back to
  // the legacy flat shape for projects saved before sheets existed.
  const src = (project.sheets && project.sheets[0]) ? project.sheets[0] : project;
  const { bgImage, placed = [] } = src;
  let img = null;
  if (bgImage && bgImage.w && bgImage.h) {
    const s = Math.min(DRAW.w / bgImage.w, DRAW.h / bgImage.h);
    const w = bgImage.w * s, h = bgImage.h * s;
    img = { x: DRAW.x + (DRAW.w - w) / 2, y: DRAW.y + (DRAW.h - h) / 2, w, h, src: bgImage.src };
  }
  return (
    <svg viewBox="0 0 1587 1123" preserveAspectRatio="xMidYMid meet">
      <rect x={SHEET.margin} y={SHEET.margin} width={SHEET.width - SHEET.margin * 2}
            height={SHEET.height - SHEET.margin * 2} fill="none" stroke="#d3dbe3" strokeWidth="2"/>
      {img && <image href={img.src} x={img.x} y={img.y} width={img.w} height={img.h} opacity="0.55" preserveAspectRatio="none"/>}
      {!img && (
        <rect x={DRAW.x} y={DRAW.y} width={DRAW.w} height={DRAW.h} fill="none" stroke="#e0e6ec" strokeWidth="2"/>
      )}
      <g fill="#cc1418">
        {placed.map((p, i) => (
          <circle key={i} cx={DRAW.x + p.x} cy={DRAW.y + p.y} r="14" />
        ))}
      </g>
    </svg>
  );
}

export default function HomeScreen({ onOpenProject, onNewProject, onImport, onSketch, onPlanner, onBusiness, theme, onToggleTheme, user, onSignOut }) {
  const { manageBilling, subscription } = useApp();
  const [cards, setCards] = useState(null);
  const [pending, setPending] = useState(0);   // local jobs awaiting upload
  // The one drawing awaiting a confirmed delete (null = dialog closed). This
  // holds the whole card, not just an id, so the dialog names exactly what goes.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [migrating, setMigrating] = useState(false);

  const load = async () => {
    try {
      const rows = await listProjects();
      // Sign only the small first-sheet plan image referenced by each preview.
      const urls = await signPlanImages(rows.map(r => r.preview?.bg?.path).filter(Boolean));
      const full = rows.map((r) => {
        const pv = r.preview || {};
        const bg = pv.bg
          ? { ...pv.bg, src: pv.bg.src || (pv.bg.path && urls.get(pv.bg.path)) || null }
          : null;
        // Minimal project shape the thumbnail understands (first sheet only).
        const slimProject = {
          meta: { plot: pv.plot || "", drawingNumber: pv.drawingNumber || "" },
          sheets: [{ bgImage: bg, placed: pv.dots || [] }],
        };
        return {
          id: r.id,
          name: r.name || "Untitled drawing",
          addr: pv.plot || "",
          reg: pv.drawingNumber || "",
          floors: pv.floors || 1,
          updatedAt: r.updatedAt,
          count: pv.count || 0,
          project: slimProject,
        };
      });
      setCards(full);
    } catch (err) {
      console.error(err);
      setCards([]);
    }
  };

  useEffect(() => {
    load();
    setPending(localProjectsPending());
  }, []);

  const runMigration = async () => {
    setMigrating(true);
    const n = await migrateLocalProjects();
    setMigrating(false);
    setPending(0);
    await load();
    if (n > 0) alert(`Uploaded ${n} drawing${n === 1 ? "" : "s"} to your account.`);
  };
  const dismissMigration = () => setPending(0);

  // Called only after the dialog has confirmed the password AND the row is
  // gone from Supabase. Drops just that card from the list -- no reload, so a
  // stale fetch can't resurrect it.
  const onDeleted = (card) => {
    setCards(cs => (cs || []).filter(c => c.id !== card.id));
    setPendingDelete(null);
    setToast(`Deleted "${card.name}"`);
  };

  // Auto-dismiss the confirmation toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // Live filter over the drawings already fetched -- no extra query, and no
  // change to how they're loaded. Matches the same fields the cards show:
  // name, plot/address and drawing number.
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!cards) return null;
    if (!q) return cards;
    return cards.filter((c) =>
      [c.name, c.addr, c.reg].some((v) => (v || "").toLowerCase().includes(q))
    );
  }, [cards, q]);

  const stats = useMemo(() => {
    const list = cards || [];
    const symbols = list.reduce((s, c) => s + c.count, 0);
    const now = new Date();
    const month = list.filter(c => {
      if (!c.updatedAt) return false;
      const d = new Date(c.updatedAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    return { drawings: list.length, symbols, month };
  }, [cards]);

  return (
    <div className="pw-home">
      <style>{CSS}</style>
      <div className="pw-app">
        <aside className="rail">
          <div className="brandmark" title="Plotwire">
            <svg viewBox="0 0 24 24" fill="none"><path d="M13 2 4 13h6l-1 9 9-11h-6l1-9z" fill="#08313a"/></svg>
          </div>
          <div className="navitem active" title="Dashboard"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg></div>
          <div className="navitem" title="All drawings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>
          <div className="navitem" title="Symbol library"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="7" cy="7" r="3.2"/><rect x="14" y="4" width="6" height="6" rx="1.4"/><path d="M4 15h6v6H4zM14 18h6"/><circle cx="17" cy="18" r="3.2"/></svg></div>
          <div className="navitem" title="Work planner" onClick={onPlanner} style={{ cursor: "pointer" }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M7 13h3M7 17h3M14 13h3"/></svg></div>
          <div className="rail-spacer"></div>
          <div className="navitem" title="Edit business information" onClick={onBusiness} style={{ cursor: "pointer" }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 0 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9 2 2 0 0 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2 2 2 0 0 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9 2 2 0 0 1 0 4 1.7 1.7 0 0 0-1.5 1z"/></svg></div>
          <div className="rail-avatar">{(displayName(user) || user?.email || "?").slice(0, 2).toUpperCase()}</div>
        </aside>

        <div className="main">
          <header className="topbar">
            <span className="wordmark">Plot<b>wire</b></span>
            <div className="search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/></svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search drawings, plots, drawing numbers..."
                aria-label="Search drawings"
              />
            </div>
            <div className="topbar-right">
              <button className="theme-toggle" onClick={onToggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-label="Toggle theme">
                {theme === "dark" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
                )}
              </button>
              <div className="account" title={user?.email || ""}>
                <div style={{ textAlign: "right" }}><div className="nm">{displayName(user) || "Account"}</div><div className="sub">{user?.email || ""}</div></div>
                <div className="pic">{(user?.email || displayName(user) || "?").slice(0, 2).toUpperCase()}</div>
              </div>
              {subscription?.status === "trialing" && (
                <span className="trial-chip" title="You're on a free trial">Trial</span>
              )}
              {manageBilling && subscription?.sub && (
                <button className="theme-toggle" onClick={manageBilling} title="Manage billing" aria-label="Manage billing">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19"/></svg>
                </button>
              )}
              <button className="theme-toggle" onClick={onSignOut} title="Sign out" aria-label="Sign out">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>
              </button>
            </div>
          </header>

          <div className="scroll">
            {pending > 0 && (
              <div className="migrate-banner">
                <div>
                  <strong>{pending} drawing{pending === 1 ? "" : "s"} saved on this device.</strong>
                  <span> Upload them to your account so they're backed up and on every device?</span>
                </div>
                <div className="migrate-actions">
                  <button className="mg-ghost" onClick={dismissMigration} disabled={migrating}>Not now</button>
                  <button className="mg-primary" onClick={runMigration} disabled={migrating}>{migrating ? "Uploadingâ€¦" : "Upload to my account"}</button>
                </div>
              </div>
            )}
            <section className="hero">
              <div className="hero-glow"></div>
              <div className="hero-inner">
                <div>
                  <div className="eyebrow">Plotwire</div>
                  <h1>{greeting()}{displayName(user) ? `, ${displayName(user)}` : ""}</h1>
                  <p>Pick up where you left off, or start a new layout. Everything you draw is counted into your bill of quantities automatically.</p>
                </div>
                <div className="hero-actions">
                  <button className="btn btn-primary" onClick={onSketch}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>Sketch a plan</button>
                  <button className="btn btn-primary" onClick={() => onNewProject()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M12 5v14M5 12h14"/></svg>New drawing</button>
                </div>
              </div>
              <div className="stats">
                <div className="stat"><div className="n">{stats.drawings}</div><div className="l">Active drawings</div></div>
                <div className="stat"><div className="n">{stats.month}</div><div className="l">Edited this month</div></div>
                <div className="stat"><div className="n">{stats.symbols}</div><div className="l">Symbols placed</div></div>
              </div>
            </section>

            <div className="sec-head"><h2>Start something new</h2></div>
            <div className="templates"><div className="tpl" onClick={onPlanner}><div className="tpl-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M7 13h3M7 17h3M14 13h3"/></svg></div><div><div className="t">Work planner</div><div className="s">Plan your team&apos;s week</div></div></div><div className="tpl" onClick={onSketch}><div className="tpl-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg></div><div><div className="t">Sketch a floor plan</div><div className="s">Draw the building, then add electrics</div></div></div>
              <div className="tpl" onClick={() => onNewProject()}>
                <div className="tpl-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 3 5 13h6l-1 8 9-11h-6l1-7z"/></svg></div>
                <div><div className="t">Blank A3 sheet</div><div className="s">Landscape Â· titled</div></div>
              </div>
              <div className="tpl" onClick={onImport}>
                <div className="tpl-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 15V3m0 0L8 7m4-4 4 4"/><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/></svg></div>
                <div><div className="t">Import a PDF plan</div><div className="s">Trace over it</div></div>
              </div>
            </div>

            <div className="sec-head">
              <h2>Recent drawings</h2>
              {cards && cards.length > 0 && <span className="muted-count">{cards.length} saved</span>}
            </div>

            {cards === null ? (
              <div className="grid">
                {[0, 1, 2].map(i => <div key={i} className="card skel"><div className="thumb"></div><div className="card-body"><div className="sk-line w70"></div><div className="sk-line w40"></div></div></div>)}
              </div>
            ) : (
              <div className="grid">
                {visible.map(c => (
                  <div key={c.id} className="card" onClick={() => onOpenProject(c.id)}>
                    <div className="thumb">
                      <span className="badge">{c.reg || "A3"}</span>
                      {c.floors > 1 && <span className="badge badge-floors">{c.floors} floors</span>}
                      <PlanThumb project={c.project} />
                      <button
                        type="button"
                        className="card-del"
                        title={`Delete "${c.name}"`}
                        aria-label={`Delete ${c.name}`}
                        onClick={(e) => { e.stopPropagation(); setPendingDelete(c); }}>
                        <Trash2 strokeWidth={1.8} aria-hidden="true" />
                      </button>
                    </div>
                    <div className="card-body">
                      <div className="card-title">{c.name}</div>
                      {c.addr
                        ? <div className="card-addr"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>{c.addr}</div>
                        : <div className="card-addr" style={{ opacity: .55 }}>No site address yet</div>}
                      <div className="card-foot">
                        <span className="dt"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>{relTime(c.updatedAt)}</span>
                        <span className="ct">{c.count} {c.count === 1 ? "item" : "items"}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {!q && <div className="card new-card" onClick={() => onNewProject()}>
                  <div className="plus"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg></div>
                  <span>New drawing</span>
                </div>}
              </div>
            )}

            {cards && cards.length > 0 && visible.length === 0 && (
              <div className="empty">No drawings match &ldquo;{query.trim()}&rdquo;.</div>
            )}

            {cards && cards.length === 0 && (
              <div className="empty">No saved drawings yet â€” start a blank sheet or import a plan to get going.</div>
            )}

            <footer className="legal-links" aria-label="Legal">
              <a href={LEGAL_LINKS.terms} target="_blank" rel="noopener noreferrer">Terms of Service</a>
              <a href={LEGAL_LINKS.privacy} target="_blank" rel="noopener noreferrer">Privacy Policy</a>
              <a href={LEGAL_LINKS.dataProcessing} target="_blank" rel="noopener noreferrer">Data Processing Terms</a>
            </footer>
          </div>
        </div>
      </div>

      {pendingDelete && (
        <DeleteDrawingDialog
          card={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onDeleted={onDeleted}
        />
      )}
      {toast && <div className="pw-toast" role="status">{toast}</div>}
    </div>
  );
}

/* ============================================================================
 * DELETE CONFIRMATION
 * Deleting a drawing is permanent, so it asks for the account password before
 * it will touch anything. Nothing is deleted until verifyPassword() succeeds,
 * and only ever the single drawing named in the dialog.
 * ========================================================================= */
function DeleteDrawingDialog({ card, onCancel, onDeleted }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Escape cancels -- but not mid-delete, when it is too late to stop.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    // 1. Password first. A wrong one never reaches the delete.
    const check = await verifyPassword(password);
    if (!check.ok) {
      setBusy(false); setPassword(""); setError(check.message);
      inputRef.current?.focus();
      return;
    }
    // 2. Then delete exactly the drawing this dialog named.
    try {
      await deleteProjectRow(card.id);
      setPassword("");
      onDeleted(card);
    } catch (err) {
      setBusy(false); setPassword("");
      setError(err?.message || "Couldn't delete that drawing. Nothing was changed.");
    }
  };

  return (
    <div className="pw-modal-back" onClick={() => { if (!busy) onCancel(); }}>
      <div className="pw-modal" role="dialog" aria-modal="true" aria-labelledby="del-title"
           onClick={(e) => e.stopPropagation()}>
        <h3 id="del-title" className="pw-modal-title">Delete &ldquo;{card.name}&rdquo;?</h3>
        <p className="pw-modal-warn">
          This permanently deletes this drawing and everything on it. <b>This can&rsquo;t be undone.</b>
        </p>
        <form onSubmit={submit}>
          <label className="pw-modal-label" htmlFor="del-pw">Enter your account password to confirm</label>
          <input
            id="del-pw"
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(e) => { setPassword(e.target.value); if (error) setError(""); }}
            className="pw-modal-input"
          />
          {error && <div className="pw-modal-error" role="alert">{error}</div>}
          <div className="pw-modal-actions">
            <button type="button" className="pw-btn-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="submit" className="pw-btn-danger" disabled={busy || !password}>
              {busy ? "Deleting…" : "Delete drawing"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const CSS = `
.pw-home{position:fixed; inset:0; z-index:1;
  --ink:#0E141B; --navy:#1A2530; --navy-2:#22303D; --navy-line:#314250;
  --brand:#2C3E50; --teal:#3FB7C9; --teal-600:#2C97A8; --teal-700:#22808F;
  --paper:#F4F6F9; --surface:#FFFFFF; --line:#E6EBF1; --line-2:#EEF2F6;
  --ink-2:#3A4654; --muted:#697785; --muted-2:#9AA6B2; --blueprint:rgba(63,183,201,.14);
  font-family:'Inter',system-ui,sans-serif; color:var(--ink); -webkit-font-smoothing:antialiased;}
.pw-home *{box-sizing:border-box; margin:0; padding:0}
.pw-home .pw-app{display:flex; height:100%; width:100%; background:var(--paper)}
.pw-home .rail{width:74px; flex-shrink:0; background:var(--navy); display:flex; flex-direction:column; align-items:center; padding:18px 0; gap:6px; position:relative}
.pw-home .rail::after{content:""; position:absolute; inset:0 0 0 auto; width:1px; background:rgba(255,255,255,.05)}
.pw-home .brandmark{width:42px; height:42px; border-radius:12px; background:linear-gradient(150deg,var(--teal),var(--teal-700)); display:grid; place-items:center; margin-bottom:18px; box-shadow:0 6px 16px -4px rgba(63,183,201,.5)}
.pw-home .brandmark svg{width:22px; height:22px}
.pw-home .navitem{width:46px; height:46px; border-radius:12px; display:grid; place-items:center; color:#8190a0; cursor:pointer; transition:all .18s ease; position:relative}
.pw-home .navitem svg{width:21px; height:21px}
.pw-home .navitem:hover{color:var(--navy); background:var(--teal-600)}
.pw-home .navitem.active{color:#fff; background:rgba(63,183,201,.16)}
.pw-home .navitem.active::before{content:""; position:absolute; left:-18px; top:11px; bottom:11px; width:3px; border-radius:0 3px 3px 0; background:var(--teal)}
.pw-home .rail-spacer{flex:1}
.pw-home .rail-avatar{width:40px; height:40px; border-radius:50%; background:var(--navy-2); border:1.5px solid var(--navy-line); color:#cdd6e0; display:grid; place-items:center; font-weight:600; font-size:13px; cursor:pointer; font-family:'Space Grotesk',sans-serif; margin-top:6px}
.pw-home .main{flex:1; display:flex; flex-direction:column; min-width:0}
.pw-home .topbar{height:62px; flex-shrink:0; background:rgba(255,255,255,.85); backdrop-filter:saturate(1.4) blur(10px); border-bottom:1px solid var(--line); display:flex; align-items:center; gap:18px; padding:0 30px}
.pw-home .wordmark{font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:17px; letter-spacing:-.01em}
.pw-home .wordmark b{color:var(--teal-600)}
.pw-home .search{margin-left:8px; flex:1; max-width:380px; height:38px; border-radius:10px; background:var(--paper); border:1px solid var(--line); display:flex; align-items:center; gap:9px; padding:0 13px; color:var(--muted); font-size:13.5px}
.pw-home .search svg{width:16px; height:16px; flex-shrink:0}
.pw-home .search input{flex:1; min-width:0; height:100%; padding:0; border:none; outline:none; background:transparent; font-family:inherit; font-size:inherit; color:var(--ink)}
.pw-home .search input::placeholder{color:var(--muted)}
.pw-home .search input::-webkit-search-cancel-button{cursor:pointer}
.pw-home .topbar-right{margin-left:auto; display:flex; align-items:center; gap:14px}
.pw-home .account{display:flex; align-items:center; gap:10px; padding:5px 6px 5px 12px; border-radius:11px; cursor:pointer; transition:background .16s}
.pw-home .account:hover{background:var(--paper)}
.pw-home .account .nm{font-size:13px; font-weight:500; line-height:1.15}
.pw-home .account .sub{font-size:11px; color:var(--muted)}
.pw-home .account .pic{width:32px; height:32px; border-radius:50%; background:var(--brand); color:#fff; display:grid; place-items:center; font-weight:600; font-size:12px; font-family:'Space Grotesk',sans-serif}
.pw-home .trial-chip{font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:#08313a; background:#3FB7C9; padding:4px 8px; border-radius:999px; font-weight:600; white-space:nowrap}
.pw-home .theme-toggle{width:38px; height:38px; border-radius:10px; border:1px solid var(--line); background:var(--surface); color:var(--muted); display:grid; place-items:center; cursor:pointer; transition:all .16s}
.pw-home .theme-toggle:hover{color:var(--ink); border-color:var(--muted-2)}
.pw-home .theme-toggle svg{width:18px; height:18px}

/* ---- Migration banner ---- */
.pw-home .migrate-banner{display:flex; align-items:center; justify-content:space-between; gap:18px; flex-wrap:wrap; background:linear-gradient(120deg,#E8F7FA,#F0FBFC); border:1px solid #BFE7ED; border-radius:16px; padding:16px 20px; margin-bottom:22px}
.pw-home .migrate-banner strong{font-weight:600; color:var(--ink)}
.pw-home .migrate-banner span{color:var(--ink-2)}
.pw-home .migrate-actions{display:flex; gap:10px; flex-shrink:0}
.pw-home .mg-ghost{padding:9px 16px; border-radius:10px; border:1px solid var(--line); background:var(--surface); color:var(--ink-2); font-weight:500; font-size:13px; cursor:pointer}
.pw-home .mg-ghost:hover{color:var(--ink)}
.pw-home .mg-primary{padding:9px 18px; border-radius:10px; border:none; background:#3FB7C9; color:#08313a; font-weight:600; font-size:13px; cursor:pointer; transition:background .15s}
.pw-home .mg-primary:hover{background:#52C4D5}
.pw-home .mg-ghost:disabled,.pw-home .mg-primary:disabled{opacity:.6; cursor:default}

/* ---- Dark theme ---- */
html.dark .pw-home{
  --ink:#E7EDF3; --ink-2:#B6C2CE; --muted:#8595A3; --muted-2:#6B7A88;
  --paper:#0E141B; --surface:#16202B; --line:#263441; --line-2:#202C38;
  --navy:#0A1016; --navy-2:#16202B; --navy-line:#283642;
  --blueprint:rgba(63,183,201,.10);
}
html.dark .pw-home .topbar{background:rgba(14,20,27,.82); border-bottom-color:var(--line)}
html.dark .pw-home .search{background:#0E141B; border-color:var(--line); color:var(--muted)}
html.dark .pw-home .card{box-shadow:0 1px 2px rgba(0,0,0,.4)}
html.dark .pw-home .card:hover{box-shadow:0 18px 40px -12px rgba(0,0,0,.6)}
html.dark .pw-home .thumb{background:#0E141B}
html.dark .pw-home .thumb::before{background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px)}
html.dark .pw-home .tpl:hover{border-color:var(--teal-600)}
html.dark .pw-home .new-card{border-color:#2A3947}
html.dark .pw-home .card-foot .ct{background:#0E141B}
html.dark .pw-home .migrate-banner{background:linear-gradient(120deg,#13343b,#152832); border-color:#235662}
.pw-home .scroll{flex:1; overflow-y:auto; padding:36px 40px 60px}
.pw-home .legal-links{margin-top:48px; display:flex; flex-wrap:wrap; justify-content:center; gap:8px 20px; font-size:12.5px}
.pw-home .legal-links a{color:var(--muted); text-decoration:none}
.pw-home .legal-links a:hover{color:#22808F; text-decoration:underline}
.pw-home .hero{position:relative; overflow:hidden; border-radius:22px; background:linear-gradient(120deg,#1A2530 0%,#233241 60%,#2C4150 100%); padding:32px 34px; margin-bottom:34px; color:#fff; box-shadow:0 18px 40px -12px rgba(16,28,40,.22)}
.pw-home .hero::before{content:""; position:absolute; inset:0; background-image:linear-gradient(var(--blueprint) 1px,transparent 1px),linear-gradient(90deg,var(--blueprint) 1px,transparent 1px); background-size:26px 26px; -webkit-mask-image:linear-gradient(105deg,transparent 40%,#000 100%); mask-image:linear-gradient(105deg,transparent 40%,#000 100%)}
.pw-home .hero-glow{position:absolute; right:-80px; top:-90px; width:340px; height:340px; border-radius:50%; background:radial-gradient(circle,rgba(63,183,201,.32),transparent 68%)}
.pw-home .hero-inner{position:relative; display:flex; align-items:flex-end; justify-content:space-between; gap:24px; flex-wrap:wrap}
.pw-home .eyebrow{font-family:'JetBrains Mono',monospace; font-size:11.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--teal); margin-bottom:12px}
.pw-home .hero h1{font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:30px; letter-spacing:-.02em; line-height:1.08; margin-bottom:9px}
.pw-home .hero p{color:#aab8c6; font-size:14.5px; max-width:430px; line-height:1.55}
.pw-home .hero-actions{display:flex; gap:11px}
.pw-home .btn{height:46px; border-radius:12px; padding:0 20px; font-size:14px; font-weight:500; font-family:'Inter',sans-serif; display:inline-flex; align-items:center; gap:9px; cursor:pointer; border:none; transition:all .17s ease; white-space:nowrap}
.pw-home .btn svg{width:18px; height:18px}
.pw-home .btn-primary{background:var(--teal); color:#08313a; font-weight:600}
.pw-home .btn-primary:hover{background:#52c4d5; transform:translateY(-1px); box-shadow:0 8px 22px -6px rgba(63,183,201,.6)}
.pw-home .btn-ghost{background:rgba(255,255,255,.08); color:#e7eef4; border:1px solid rgba(255,255,255,.14)}
.pw-home .btn-ghost:hover{background:rgba(255,255,255,.14)}
.pw-home .stats{position:relative; display:flex; gap:34px; margin-top:26px; padding-top:22px; border-top:1px solid rgba(255,255,255,.1)}
.pw-home .stat .n{font-family:'Space Grotesk',sans-serif; font-size:23px; font-weight:600}
.pw-home .stat .l{font-size:11.5px; color:#93a2b1; margin-top:2px}
.pw-home .sec-head{display:flex; align-items:center; justify-content:space-between; margin:0 2px 16px}
.pw-home .sec-head h2{font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:17px; letter-spacing:-.01em}
.pw-home .muted-count{font-size:13px; color:var(--muted)}
.pw-home .templates{display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:14px; margin-bottom:38px}
.pw-home .tpl{background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:16px; cursor:pointer; transition:all .18s ease; display:flex; align-items:center; gap:13px}
.pw-home .tpl:hover{border-color:#cfe7ec; box-shadow:0 4px 14px rgba(16,28,40,.07); transform:translateY(-2px)}
.pw-home .tpl-ic{width:40px; height:40px; border-radius:10px; display:grid; place-items:center; flex-shrink:0; background:rgba(63,183,201,.12); color:var(--teal-700); transition:background .18s ease, color .18s ease}
.pw-home .tpl-ic svg{width:20px; height:20px}
.pw-home .tpl .t{font-size:13.5px; font-weight:500; transition:color .18s ease}
.pw-home .tpl .s{font-size:11.5px; color:var(--muted); margin-top:1px; transition:color .18s ease}

/* Hover: the whole tile goes Plotwire teal, matching the card info strip and
   the nav rail. The icon chip flips to a light square with a navy glyph so it
   stays readable against the teal. */
.pw-home .tpl:hover{background:var(--teal-600); border-color:var(--teal-600)}
.pw-home .tpl:hover .t{color:#fff}
.pw-home .tpl:hover .s{color:rgba(255,255,255,.85)}
.pw-home .tpl:hover .tpl-ic{background:rgba(255,255,255,.92); color:var(--navy)}
.pw-home .grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(252px,1fr)); gap:18px}
.pw-home .card{background:var(--surface); border:1px solid var(--line); border-radius:16px; overflow:hidden; cursor:pointer; transition:all .2s cubic-bezier(.2,.7,.3,1); box-shadow:0 1px 2px rgba(16,28,40,.04),0 1px 3px rgba(16,28,40,.06); display:flex; flex-direction:column}
.pw-home .card:hover{transform:translateY(-4px); box-shadow:0 18px 40px -12px rgba(16,28,40,.22); border-color:#d3dde6}
.pw-home .thumb{height:152px; position:relative; background:#F8FAFB; border-bottom:1px solid var(--line-2); overflow:hidden}
.pw-home .thumb::before{content:""; position:absolute; inset:0; background-image:linear-gradient(rgba(44,62,80,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(44,62,80,.05) 1px,transparent 1px); background-size:16px 16px}
.pw-home .thumb svg{position:absolute; inset:0; width:100%; height:100%}
.pw-home .badge{position:absolute; top:11px; left:11px; z-index:2; font-family:'JetBrains Mono',monospace; font-size:10.5px; font-weight:500; padding:3px 8px; border-radius:6px; background:rgba(26,37,48,.85); color:#cfeef3; letter-spacing:.02em}
/* Delete control: tucked into the thumb's bottom-right, away from the badges.
   Hidden until the card is hovered or the button is focused, so it can't be hit
   by accident; on touch (no hover) it stays faintly visible instead. */
.pw-home .card-del{position:absolute; bottom:10px; right:10px; z-index:3; width:40px; height:40px; min-width:40px; min-height:40px; padding:0; border:0; line-height:0; font-size:0; border-radius:10px; display:flex; align-items:center; justify-content:center; text-align:center; background:var(--teal-600); color:var(--navy); cursor:pointer; opacity:0; box-shadow:0 4px 12px -2px rgba(11,17,23,.35); transition:opacity .15s ease, background .15s ease, transform .15s ease}
/* 21px is exactly the left-rail icon size (.navitem svg).
   Centring is belt-and-braces: the flex rules above centre it, margin:auto
   centres it again if those are ever overridden, and position:static/inset:auto
   guarantee nothing can absolutely position it into a corner. */
.pw-home .card-del svg{width:21px; height:21px; display:block; flex:none; position:static; inset:auto; margin:auto}
.pw-home .card:hover .card-del{opacity:1}
.pw-home .card-del:focus-visible{opacity:1; outline:2px solid var(--navy); outline-offset:2px}
.pw-home .card-del:hover{background:var(--teal-700); transform:translateY(-1px)}
/* No hover on touch, so the button simply stays visible there. */
@media (hover:none){ .pw-home .card-del{opacity:1} }

/* Delete confirmation dialog */
.pw-modal-back{position:fixed; inset:0; z-index:60; background:rgba(11,17,23,.55); display:grid; place-items:center; padding:20px}
.pw-modal{width:100%; max-width:420px; background:var(--surface); color:var(--ink); border:1px solid var(--line); border-radius:16px; padding:22px; box-shadow:0 24px 60px -12px rgba(11,17,23,.45)}
.pw-modal-title{font-family:'Space Grotesk',system-ui,sans-serif; font-size:17px; font-weight:600; line-height:1.3; margin-bottom:8px; word-break:break-word}
.pw-modal-warn{font-size:13px; line-height:1.5; color:var(--muted); margin-bottom:16px}
.pw-modal-warn b{color:#c0392b; font-weight:600}
.pw-modal-label{display:block; font-size:12px; font-weight:500; color:var(--ink-2); margin-bottom:6px}
.pw-modal-input{width:100%; height:40px; padding:0 12px; font-size:14px; font-family:inherit; color:var(--ink); background:var(--paper); border:1px solid var(--line); border-radius:10px; outline:none}
.pw-modal-input:focus{border-color:var(--teal); box-shadow:0 0 0 3px rgba(63,183,201,.18)}
.pw-modal-error{margin-top:8px; font-size:12.5px; color:#c0392b}
.pw-modal-actions{display:flex; gap:10px; justify-content:flex-end; margin-top:18px}
.pw-modal-actions button{height:38px; padding:0 16px; font-size:13px; font-weight:600; font-family:inherit; border-radius:10px; cursor:pointer; border:1px solid transparent}
.pw-btn-cancel{background:transparent; border-color:var(--line); color:var(--ink-2)}
.pw-btn-cancel:hover:not(:disabled){background:var(--line-2)}
.pw-btn-danger{background:#c0392b; color:#fff}
.pw-btn-danger:hover:not(:disabled){background:#a93226}
.pw-modal-actions button:disabled{opacity:.5; cursor:not-allowed}

/* Post-delete confirmation */
.pw-toast{position:fixed; left:50%; bottom:26px; transform:translateX(-50%); z-index:70; background:var(--navy); color:#eaf6f8; font-size:13px; font-weight:500; padding:10px 18px; border-radius:10px; box-shadow:0 10px 30px -8px rgba(11,17,23,.5)}
.pw-home .badge-floors{left:auto; right:11px; background:rgba(63,183,201,.92); color:#08313a; font-weight:600}
.pw-home .card-body{padding:14px 16px 15px; transition:background .2s cubic-bezier(.2,.7,.3,1)}
.pw-home .card-title{font-size:14.5px; font-weight:600; letter-spacing:-.01em; margin-bottom:3px; transition:color .2s cubic-bezier(.2,.7,.3,1); overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.pw-home .card-addr{font-size:12.5px; color:var(--muted); transition:color .2s cubic-bezier(.2,.7,.3,1); display:flex; align-items:center; gap:5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.pw-home .card-addr svg{width:13px; height:13px; flex-shrink:0; opacity:.7}
.pw-home .card-foot{margin-top:13px; padding-top:12px; border-top:1px solid var(--line-2); transition:border-color .2s cubic-bezier(.2,.7,.3,1); display:flex; align-items:center; justify-content:space-between}
.pw-home .card-foot .dt{font-size:11.5px; color:var(--muted-2); transition:color .2s cubic-bezier(.2,.7,.3,1); display:flex; align-items:center; gap:5px}
.pw-home .card-foot .dt svg{width:13px; height:13px}
.pw-home .card-foot .ct{font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--ink-2); background:var(--paper); padding:3px 7px; border-radius:6px; transition:color .2s cubic-bezier(.2,.7,.3,1), background .2s cubic-bezier(.2,.7,.3,1)}

/* Hover: the info strip turns Plotwire teal, and everything in it is lifted to
   white / near-white so the name, date and item count stay readable. Resting
   state is untouched; only these colours change. */
.pw-home .card:hover .card-body{background:var(--teal-600)}
.pw-home .card:hover .card-title{color:#fff}
.pw-home .card:hover .card-addr{color:rgba(255,255,255,.88)}
.pw-home .card:hover .card-foot{border-top-color:rgba(255,255,255,.3)}
.pw-home .card:hover .card-foot .dt{color:rgba(255,255,255,.85)}
.pw-home .card:hover .card-foot .ct{color:var(--navy); background:rgba(255,255,255,.92)}
.pw-home .new-card{border:1.5px dashed #cdd7e0; background:transparent; box-shadow:none; align-items:center; justify-content:center; min-height:230px; color:var(--muted); gap:12px}
.pw-home .new-card:hover{border-color:var(--teal); color:var(--teal-700); background:rgba(63,183,201,.04); transform:translateY(-4px)}
.pw-home .new-card .plus{width:50px; height:50px; border-radius:14px; background:rgba(63,183,201,.1); display:grid; place-items:center; color:var(--teal-700)}
.pw-home .new-card .plus svg{width:24px; height:24px}
.pw-home .new-card span{font-size:13.5px; font-weight:500}
.pw-home .skel{pointer-events:none}
.pw-home .skel .thumb{background:#eef1f5}
.pw-home .sk-line{height:11px; border-radius:5px; background:#eaeef3; margin-top:8px}
.pw-home .sk-line.w70{width:70%} .pw-home .sk-line.w40{width:40%}
.pw-home .empty{margin-top:18px; padding:30px; text-align:center; color:var(--muted); font-size:13.5px; background:var(--surface); border:1px dashed var(--line); border-radius:14px}
@media (max-width:720px){.pw-home .rail{width:60px} .pw-home .scroll{padding:24px 18px 50px} .pw-home .hero{padding:24px} .pw-home .hero h1{font-size:24px} .pw-home .stats{gap:22px; flex-wrap:wrap}}
`;









