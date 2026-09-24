"use client";

/* ============================================================================
 * BUSINESS INFORMATION — the account's own company details.
 *
 * Stage 1: capture and store only. Nothing here feeds into drawings yet.
 * Every read and write goes through lib/companyProfile, which is locked to the
 * signed-in account by RLS at the database level.
 * ========================================================================= */

import React, { useState, useEffect, useRef, useMemo } from "react";
import { Save, X, Upload, Building2, Plus } from "lucide-react";
import { Masthead } from "@/components/TitleBlockMasthead";
import { companyProfileToTitleBlock } from "@/lib/titleBlock";
import {
  listCompanyLogos, saveCompanyLogo, deleteCompanyLogo,
  KIND_COMPANY, KIND_ACCREDITATION, MAX_ACCREDITATIONS,
} from "@/lib/companyLogos";
import {
  getCompanyProfile, saveCompanyProfile, EMPTY_PROFILE,
} from "@/lib/companyProfile";
import { resizeImageToDataUrl } from "@/lib/titleBlock";
import { LEGAL_LINKS } from "@/lib/legal";

const FIELDS = [
  { key: "company_name", label: "Company name", placeholder: "e.g. Your Company Ltd", type: "text" },
  { key: "address", label: "Address", placeholder: "Unit 4, Example Way\nLeeds LS1 1AA", type: "textarea" },
  { key: "phone", label: "Phone", placeholder: "01234 567890", type: "tel" },
  { key: "email", label: "Email", placeholder: "office@example.co.uk", type: "email" },
  { key: "website", label: "Website", placeholder: "www.example.co.uk", type: "text" },
  { key: "company_reg", label: "Company registration number", placeholder: "e.g. 09482716", type: "text" },
];

// Sample values so the preview reads as a real title block rather than a row
// of dashes. Only the company half of it comes from the user's own data.
const PREVIEW_META = {
  projectName: "Appletree Grange", plot: "Plot 14, Kettering",
  sheetName: "Ground Floor — Lighting", scale: "1:50",
  date: "—", drawingNumber: "WOE-0142-GF-L", revision: "C",
};

export default function BusinessInfo({ onClose, onSkip, onSaved, onboarding = false }) {
  // Same fields, same save path -- only the framing changes when this is the
  // first-login step. leave() is what the X and the left-hand button do:
  // skipping in onboarding, closing everywhere else.
  const leave = onboarding ? (onSkip || onClose) : onClose;
  const heading  = onboarding ? "Welcome to Plotwire" : "Business information";
  const subtitle = onboarding
    ? "Add your company details — these go on your drawings. You can change them any time."
    : "Your company details, saved to your account.";
  const leaveLabel = onboarding ? "Skip for now" : "Close";
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [logos, setLogos] = useState([]);        // company_logos rows
  const pendingKind = useRef({ kind: KIND_COMPANY, slot: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  const leaveTimer = useRef(null);
  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);

  // Load whatever was saved before, and mint a URL for the stored logo.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [p, rows] = await Promise.all([getCompanyProfile(), listCompanyLogos()]);
        if (!live) return;
        setProfile(p);
        setLogos(rows);
      } catch (err) {
        if (live) setError(err?.message || "Couldn't load your business information.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, []);

  const set = (key, value) => {
    setProfile(p => ({ ...p, [key]: value }));
    setSaved(false);
    if (error) setError("");
  };

  const companyLogo = logos.find((l) => l.kind === KIND_COMPANY) || null;
  const accreditations = logos.filter((l) => l.kind === KIND_ACCREDITATION);
  const nextSlot = [0, 1].find((n) => !accreditations.some((l) => l.sort_order === n)) ?? 0;

  // Rendering always uses the cached data-URI, never a signed URL: the URL
  // expires and taints the html2canvas canvas the PDF export depends on.
  const logoSrc = (l) => l && l.data_url;

  const pickFor = (target) => { pendingKind.current = target; fileRef.current?.click(); };

  const onPickLogo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be chosen again later
    if (!file) return;
    const { kind, slot } = pendingKind.current;
    setBusy(true); setError(""); setSaved(false);
    try {
      // Downscaled here so the bytes uploaded and the bytes rendered are the
      // same image, and the stored copy stays small.
      const dataUrl = await resizeImageToDataUrl(file, 260);
      await saveCompanyLogo({ kind, dataUrl, slot });
      setLogos(await listCompanyLogos());
      // Keep the legacy columns in step while they are still the fallback.
      if (kind === KIND_COMPANY) setProfile((p) => ({ ...p, logo_data_url: dataUrl }));
    } catch (err) {
      setError(err?.message || "Couldn't upload that logo.");
    } finally {
      setBusy(false);
    }
  };

  const removeLogo = async (logo) => {
    setBusy(true); setError(""); setSaved(false);
    try {
      await deleteCompanyLogo(logo.id);
      setLogos(await listCompanyLogos());
      if (logo.kind === KIND_COMPANY) setProfile((p) => ({ ...p, logo_path: null, logo_data_url: null }));
    } catch (err) {
      setError(err?.message || "Couldn't remove that logo.");
    } finally {
      setBusy(false);
    }
  };

  // The preview is the point of the screen: it answers "what does this logo do
  // to my drawing?" without opening one.
  const previewBlock = useMemo(
    () => companyProfileToTitleBlock(profile, logos) || { details: [], logos: [] },
    [profile, logos]
  );

  const save = async (e) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      await saveCompanyProfile(profile);
      // Let the app re-derive the title block so a drawing opened next shows
      // the new details without a reload.
      await onSaved?.();
      // Saved: confirm briefly, then hand the user back to the dashboard. Stays
      // busy meanwhile so the form can't be submitted twice on the way out.
      setSaved(true);
      leaveTimer.current = setTimeout(() => onClose?.(), 900);
    } catch (err) {
      // Failed: stay here, show why, and let them try again.
      setError(err?.message || "Couldn't save. Nothing was changed.");
      setBusy(false);
    }
  };

  return (
    <div className="pw-biz">
      <style>{CSS}</style>
      <div className="biz-sheet">
        <header className="biz-head">
          <div className="biz-head-l">
            <span className="biz-ic"><Building2 size={19} strokeWidth={1.8}/></span>
            <div>
              <h1>{heading}</h1>
              <p>{subtitle}</p>
            </div>
          </div>
          <button type="button" className="biz-close" onClick={leave} title={leaveLabel} aria-label={leaveLabel}>
            <X size={19} strokeWidth={2}/>
          </button>
        </header>

        {loading ? (
          <div className="biz-loading">Loading&hellip;</div>
        ) : (
          <form className="biz-body" onSubmit={save}>
            {FIELDS.map(f => (
              <label key={f.key} className="biz-field">
                <span className="biz-label">{f.label}</span>
                {f.type === "textarea" ? (
                  <textarea
                    rows={3}
                    value={profile[f.key] || ""}
                    placeholder={f.placeholder}
                    disabled={busy}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                ) : (
                  <input
                    type={f.type}
                    value={profile[f.key] || ""}
                    placeholder={f.placeholder}
                    disabled={busy}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
              </label>
            ))}

            {/* ---- Your company logo: exactly one ---- */}
            <div className="biz-sec">
              <div className="biz-sec-head"><span className="biz-sec-title">Your company logo</span></div>
              <div className="biz-logo-row">
                <div className="biz-tile biz-tile-co">
                  {companyLogo
                    ? <img src={logoSrc(companyLogo)} alt="Company logo" />
                    : <span className="biz-tile-empty">No logo yet</span>}
                </div>
                <div className="biz-tile-actions">
                  <button type="button" className="pw-btn-teal" disabled={busy}
                          onClick={() => pickFor({ kind: KIND_COMPANY })}>
                    <Upload size={17} strokeWidth={1.9}/>
                    <span>{companyLogo ? "Replace logo" : "Upload logo"}</span>
                  </button>
                  {companyLogo && (
                    <button type="button" className="pw-btn-plain" disabled={busy}
                            onClick={() => removeLogo(companyLogo)}>Remove</button>
                  )}
                </div>
              </div>
              <p className="biz-hint">Sits in the teal panel at the bottom of every drawing.</p>
            </div>

            <div className="biz-rule" />

            {/* ---- Accreditations: up to two ---- */}
            <div className="biz-sec">
              <div className="biz-sec-head">
                <span className="biz-sec-title">Accreditations</span>
                <span className="biz-count">{accreditations.length} of {MAX_ACCREDITATIONS} added</span>
              </div>
              <div className="biz-acc-row">
                {accreditations.map((l) => (
                  <div key={l.id || l.sort_order} className="biz-acc">
                    <div className="biz-tile biz-tile-acc"><img src={logoSrc(l)} alt="Accreditation logo" /></div>
                    <button type="button" className="biz-btn-sm" disabled={busy}
                            onClick={() => removeLogo(l)}>Remove</button>
                  </div>
                ))}
                {accreditations.length < MAX_ACCREDITATIONS && (
                  <button type="button" className="biz-add" disabled={busy}
                          onClick={() => pickFor({ kind: KIND_ACCREDITATION, slot: nextSlot })}>
                    <span className="biz-add-ic"><Plus size={17} strokeWidth={2.1}/></span>
                    <span className="biz-add-label">Add a logo</span>
                  </button>
                )}
              </div>
              {/* Users upload their own scheme marks. Plotwire deliberately ships
                  no built-in picker of NICEIC / NAPIT / ELECSA logos -- those are
                  the schemes' trademarks, and bundling them would mean handing
                  them to users who may not be accredited. */}
              <p className="biz-hint">
                Upload the scheme logos you&rsquo;re registered with &mdash; NICEIC, NAPIT, ELECSA and so on.
                They appear on white beside your company panel.
              </p>
            </div>

            <div className="biz-rule" />

            {/* ---- Live preview: the real masthead, scaled down ---- */}
            <div className="biz-sec">
              <div className="biz-sec-head"><span className="biz-sec-title">On your drawings</span></div>
              <div className="biz-preview">
                <div className="biz-preview-scale">
                  <Masthead tb={previewBlock} meta={PREVIEW_META} />
                </div>
              </div>
              <p className="biz-hint">Updates as you add or remove logos. This is the same component the drawing uses.</p>
            </div>

            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickLogo}/>

            {error && <div className="biz-error" role="alert">{error}</div>}

            <div className="biz-actions">
              <button type="button" className="pw-btn-plain" onClick={leave} disabled={busy}>{leaveLabel}</button>
              <button type="submit" className="pw-btn-teal" disabled={busy}>
                <Save size={17} strokeWidth={1.9}/>
                <span>{saved ? "Saved ✓" : busy ? "Saving…" : (onboarding ? "Save and continue" : "Save")}</span>
              </button>
            </div>

            <nav className="biz-legal" aria-label="Legal">
              <a href={LEGAL_LINKS.terms} target="_blank" rel="noopener noreferrer">Terms of Service</a>
              <a href={LEGAL_LINKS.privacy} target="_blank" rel="noopener noreferrer">Privacy Policy</a>
              <a href={LEGAL_LINKS.dataProcessing} target="_blank" rel="noopener noreferrer">Data Processing Terms</a>
            </nav>
          </form>
        )}
      </div>
    </div>
  );
}

const CSS = `
.pw-biz{position:fixed; inset:0; z-index:1; overflow:auto; padding:28px 20px 48px;
  --teal:#3FB7C9; --teal-600:#2C97A8; --teal-700:#22808F; --navy:#1A2530;
  --paper:#F4F6F9; --surface:#FFFFFF; --line:#E6EBF1; --ink:#0E141B; --ink-2:#3A4654; --muted:#697785;
  background:var(--paper); color:var(--ink);
  font-family:'Inter',system-ui,sans-serif; -webkit-font-smoothing:antialiased}
.pw-biz *{box-sizing:border-box; margin:0; padding:0}
html.dark .pw-biz{--paper:#0E141B; --surface:#16202B; --line:#263441; --ink:#E7EDF3; --ink-2:#C3CEDA; --muted:#8B99A8}

.pw-biz .biz-sheet{max-width:620px; margin:0 auto; background:var(--surface); border:1px solid var(--line); border-radius:18px; overflow:hidden}
.pw-biz .biz-head{display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:20px 22px; border-bottom:1px solid var(--line)}
.pw-biz .biz-head-l{display:flex; align-items:center; gap:13px}
.pw-biz .biz-ic{width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex:none; background:var(--teal-600); color:var(--navy)}
.pw-biz .biz-ic svg{display:block}
.pw-biz h1{font-family:'Space Grotesk',system-ui,sans-serif; font-size:18px; font-weight:600; letter-spacing:-.01em}
.pw-biz .biz-head p{font-size:12.5px; color:var(--muted); margin-top:2px}
.pw-biz .biz-close{width:40px; height:40px; flex:none; padding:0; border:0; line-height:0; border-radius:10px; display:flex; align-items:center; justify-content:center; background:var(--teal-600); color:var(--navy); cursor:pointer; transition:background .15s ease}
.pw-biz .biz-close:hover{background:var(--teal-700)}
.pw-biz .biz-close svg{display:block; margin:auto}

.pw-biz .biz-loading{padding:40px 22px; text-align:center; font-size:12px; letter-spacing:.2em; text-transform:uppercase; color:var(--muted)}
.pw-biz .biz-body{padding:22px; display:flex; flex-direction:column; gap:16px}
.pw-biz .biz-field{display:block}
.pw-biz .biz-label{display:block; font-size:12px; font-weight:600; color:var(--ink-2); margin-bottom:6px}
.pw-biz input, .pw-biz textarea{width:100%; font-family:inherit; font-size:14px; color:var(--ink); background:var(--paper); border:1px solid var(--line); border-radius:10px; padding:10px 12px; outline:none; transition:border-color .15s ease, box-shadow .15s ease}
.pw-biz textarea{resize:vertical; min-height:76px; line-height:1.45}
.pw-biz input:focus, .pw-biz textarea:focus{border-color:var(--teal); box-shadow:0 0 0 3px rgba(63,183,201,.18)}
.pw-biz input:disabled, .pw-biz textarea:disabled{opacity:.6}
.pw-biz .biz-hint{font-size:11.5px; color:var(--muted); margin-top:6px}

.pw-biz .biz-logo-row{display:flex; align-items:center; gap:14px; flex-wrap:wrap}
.pw-biz .biz-logo-prev{width:120px; height:64px; flex:none; border:1px dashed var(--line); border-radius:10px; background:var(--paper); display:flex; align-items:center; justify-content:center; overflow:hidden}
.pw-biz .biz-logo-prev img{max-width:100%; max-height:100%; object-fit:contain; display:block}
.pw-biz .biz-logo-empty{font-size:11px; color:var(--muted)}

.pw-biz .biz-error{font-size:12.5px; color:#c0392b}
.pw-biz .biz-actions{display:flex; justify-content:flex-end; gap:10px; margin-top:4px; padding-top:16px; border-top:1px solid var(--line)}
.pw-biz .biz-legal{display:flex; flex-wrap:wrap; justify-content:center; gap:6px 18px; margin-top:18px; font-size:12px}
.pw-biz .biz-legal a{color:var(--muted); text-decoration:none}
.pw-biz .biz-legal a:hover{color:var(--teal-700); text-decoration:underline}

/* App standard: solid teal with a dark navy icon. */
.pw-biz .pw-btn-teal{display:inline-flex; align-items:center; justify-content:center; gap:8px; height:40px; padding:0 16px; font-family:inherit; font-size:13px; font-weight:600; border:0; border-radius:10px; background:var(--teal-600); color:var(--navy); cursor:pointer; transition:background .15s ease}
.pw-biz .pw-btn-teal:hover:not(:disabled){background:var(--teal-700)}
.pw-biz .pw-btn-teal svg{display:block; flex:none}
.pw-biz .pw-btn-plain{height:40px; padding:0 16px; font-family:inherit; font-size:13px; font-weight:600; border:1px solid var(--line); border-radius:10px; background:transparent; color:var(--ink-2); cursor:pointer}
.pw-biz .pw-btn-plain:hover:not(:disabled){background:var(--paper)}
.pw-biz button:disabled{opacity:.55; cursor:not-allowed}
`;
