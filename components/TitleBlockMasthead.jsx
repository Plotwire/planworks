"use client";

/* ============================================================================
 * TITLE BLOCK MASTHEAD
 * ----------------------------------------------------------------------------
 * Its own module so exactly one implementation renders in all three places it
 * appears: the working sheet, the print sheet the PDF export photographs, and
 * the live preview on the business information screen. Any drift between them
 * is drift the customer sees on a drawing.
 *
 * It fills whatever box the caller gives it -- the sheet positions it
 * absolutely, the preview scales it down -- and takes the title block as a
 * prop rather than reading the sheet's context, which is what lets the
 * business screen use it at all.
 * ========================================================================= */

import React from "react";
import { TRIAL_DRAWING_NUMBER } from "@/components/TryMode";

/* ----------------------------------------------------------------------------
 * TITLE BLOCK — masthead
 * ----------------------------------------------------------------------------
 * Built from the canvas artboard "Masthead - chosen" (page 1). Company identity
 * sits in a solid navy block reversed out in white, so the drawing reads as
 * company stationery before it reads as a drawing.
 *
 * Columns      1.5fr / 0.72fr / 0.95fr / 0.85fr
 * Type ramp    17 / 13 / 11 / 9 / 8 / 7.5px, plus the 6.5px the artboard uses
 *              for the two chip labels.
 * Body text    navy #2C3E50 -- never near-black.
 *
 * ONE component renders both the working sheet and the print sheet. The PDF
 * export photographs the print DOM with html2canvas, so anything allowed to
 * differ between them is a difference the customer sees; `editable` is the
 * only switch.
 * ------------------------------------------------------------------------- */
const MH = {
  navy: "#2C3E50",      // columns 3 and 4 body text
  teal: "#2C97A8",      // --teal-600, the panel and the chip. No other teal.
  ink: "#0E141B",       // everything ON the teal, panel and chip alike
  rule: "#DCE2E8",
  bodySoft: "#55636F",
  revLabel: "#8A94A0",
  radius: 9,            // the panel, as an inset card
  chipRadius: 7,        // chip and accreditation tiles
  ruleInset: 13,        // hairlines stop 13px short, top and bottom
};

/* Column rules are hairlines that stop short of the strip edges rather than
 * full-height borders, so the panel reads as a card sitting on the sheet. A
 * border can't be inset, so it's painted as a 1px background gradient. */
const MH_RULE = {
  backgroundImage: "linear-gradient(to bottom, transparent " + 13 + "px, " +
    "#DCE2E8 13px, #DCE2E8 calc(100% - 13px), transparent calc(100% - 13px))",
  backgroundSize: "1px 100%",
  backgroundPosition: "right center",
  backgroundRepeat: "no-repeat",
};
const MH_GROTESK = "var(--font-space-grotesk), system-ui, sans-serif";
const MH_MONO = "var(--font-jetbrains-mono), ui-monospace, monospace";

/** Section label: teal, 600, 0.12em tracking. */
function MhLabel({ children, size = 7.5, colour = MH.teal }) {
  return (
    <div style={{ fontSize: size, fontWeight: 600, letterSpacing: "0.12em",
                  textTransform: "uppercase", color: colour }}>{children}</div>
  );
}

const mhText = (d) => (d && d.value != null ? String(d.value).trim() : "");
const mhFind = (details, re) =>
  mhText((details || []).find((d) => d && re.test(String((d && d.label) || ""))));

/* Column 1 — the navy company block.
 * Fields are picked by the labels companyProfileToTitleBlock emits (Company,
 * Address, Tel, Email, Web). Anything else the merge carried through -- legacy
 * lines the profile doesn't model, a scheme registration -- is shown beneath
 * rather than dropped. */
function MastheadCompany({ tb }) {
  const details = Array.isArray(tb.details) ? tb.details : [];
  const known = /^(company|address|tel|phone|email|web|website)$/i;

  const name = mhFind(details, /^company$/i) || mhText(details[0]);
  const address = mhFind(details, /^address$/i);
  const phone = mhFind(details, /^(tel|phone)$/i);
  const web = mhFind(details, /^(web|website)$/i);
  const email = mhFind(details, /^email$/i);
  const reg = mhFind(details, /reg/i);

  const extras = details
    .filter((d) => d && !known.test(String(d.label || "")) &&
                   !/reg/i.test(String(d.label || "")) && mhText(d))
    .map((d) => [String(d.label || "").trim(), mhText(d)].filter(Boolean).join(" "));

  // The mark sits on a white tile rather than bare on the navy. The artboard's
  // mark is a flat two-colour glyph drawn for that background; a real uploaded
  // logo is usually full-colour with dark lettering and would disappear on
  // navy -- the same reason the accreditation column is white.
  const mark = (tb.logos || []).filter(Boolean)[0] || null;

  const line = (size, weight, colour) =>
    ({ fontSize: size, fontWeight: weight, color: colour, lineHeight: size <= 8 ? 1.3 : 1.35 });

  return (
    <div style={{ background: MH.teal, borderRadius: MH.radius, padding: "9px 16px", display: "flex",
                  flexDirection: "column", justifyContent: "space-between", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
        {mark && (
          <div style={{ width: 50, height: 50, flex: "none", background: "#FFFFFF",
                        borderRadius: 11, overflow: "hidden",
                        display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img src={mark} alt="" style={{ maxWidth: "100%", maxHeight: "100%",
                                            objectFit: "contain", display: "block" }} />
          </div>
        )}
        <div style={{ fontFamily: MH_GROTESK, fontSize: 19, fontWeight: 700, color: MH.ink,
                      letterSpacing: "-0.015em", lineHeight: 1.02, minWidth: 0,
                      overflowWrap: "anywhere" }}>{name}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        {address && <div style={line(9, 400, MH.ink)}>{address}</div>}
        {(phone || web) && (
          <div style={line(9, 600, MH.ink)}>{[phone, web].filter(Boolean).join("  ·  ")}</div>
        )}
        {(email || reg) && (
          <div style={line(8, 400, MH.ink)}>
            {[email, reg && (/^reg/i.test(reg) ? reg : "Reg. " + reg)].filter(Boolean).join("  ·  ")}
          </div>
        )}
        {extras.map((t, i) => <div key={i} style={line(8, 400, MH.ink)}>{t}</div>)}
      </div>
    </div>
  );
}

/* Column 2 — accreditation marks, always on white so full-colour scheme logos
 * stay legible. The company mark is index 0 and lives on the navy, so this is
 * everything after it. */
function MastheadAccreditations({ logos }) {
  const marks = (logos || []).filter(Boolean).slice(1);
  return (
    <div style={{ ...MH_RULE, background: "#FFFFFF", display: "flex", alignItems: "center",
                  gap: 10, padding: "0 16px" }}>
      {marks.map((src, i) => (
        // Fixed tile, sized the same whether there are one or two. objectFit
        // contain letterboxes a real logo inside rather than stretching it.
        <div key={i} style={{ width: 100, height: 70, flex: "none", background: "#FFFFFF",
                              border: "1px solid #E3E9ED", borderRadius: 8, overflow: "hidden",
                              display: "flex", alignItems: "center", justifyContent: "center" }}>
          <img src={src} alt="" style={{ maxWidth: "100%", maxHeight: "100%",
                                         objectFit: "contain", display: "block" }} />
        </div>
      ))}
    </div>
  );
}

/**
 * The masthead. `editable` swaps plain text for the inline fields used on the
 * working sheet; everything else is identical, by construction.
 */
// trial: Try mode on the working sheet (never the print sheet or the business
// preview) -- the drawing-number chip reads TRIAL – NOT FOR ISSUE.
export function Masthead({ tb, meta, editable = false, updateMeta, setSheet, trial = false }) {
  tb = tb || { details: [], logos: [] };
  // Index 0 is the company mark, on the panel. Anything after it is an
  // accreditation, and only those decide whether column 2 exists at all.
  const hasMarks = (tb.logos || []).filter(Boolean).length > 1;
  const upMeta = updateMeta || (() => {});
  const upSheet = setSheet || (() => {});

  const field = (text, onChange, { fontSize, weight, colour = MH.navy, family, placeholder }) =>
    editable
      ? <EditableField value={text} onChange={onChange} fontSize={fontSize} weight={weight}
                       placeholder={placeholder} colour={colour} family={family} />
      : <div style={{ fontFamily: family, fontSize, fontWeight: weight, color: colour,
                      lineHeight: 1.2, overflowWrap: "anywhere" }}>{text || "—"}</div>;

  return (
    <div style={{
      width: "100%",
      height: "100%",
      background: "#FFFFFF",
      // The 1px rule under the drawing area stays square -- it is the sheet's
      // own edge, not part of this card.
      borderTop: "1px solid " + MH.navy,
      display: "grid",
      // With no accreditations the column collapses entirely rather than
      // leaving a blank cell, which on a drawing reads as a mistake.
      // auto, not a fixed fraction: at 0.72fr a single mark sat centred in a
      // cell built for two and looked adrift. The cell now sizes to whatever
      // it holds, and the marks themselves never change size with the count.
      gridTemplateColumns: hasMarks ? "1.5fr auto 0.95fr 0.85fr" : "1.5fr 0.95fr 0.85fr",
      padding: "7px 9px",
      columnGap: 4,
      boxSizing: "border-box",
    }}>
      <MastheadCompany tb={tb} />
      {hasMarks && <MastheadAccreditations logos={tb.logos} />}

      {/* Column 3 — project over sheet */}
      <div style={{ ...MH_RULE, padding: "9px 16px", display: "flex",
                    flexDirection: "column", justifyContent: "space-between", overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <MhLabel>Project</MhLabel>
          {field(meta.projectName, (v) => upMeta({ projectName: v }),
                 { fontSize: 13, weight: 600, family: MH_GROTESK, placeholder: "Project name" })}
          {field(meta.plot, (v) => upMeta({ plot: v }),
                 { fontSize: 9, weight: 500, colour: MH.bodySoft, placeholder: "Plot / address" })}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <MhLabel>Sheet</MhLabel>
          {field(meta.sheetName, (v) => upSheet({ name: v }),
                 { fontSize: 11, weight: 600, family: MH_GROTESK })}
        </div>
      </div>

      {/* Column 4 — scale and date over the drawing-number chip */}
      <div style={{ padding: "9px 16px", display: "flex", flexDirection: "column",
                    justifyContent: "space-between", overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <MhLabel>Scale</MhLabel>
            {field(meta.scale, (v) => upMeta({ scale: v }), { fontSize: 11, weight: 500, family: MH_MONO })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <MhLabel>Date</MhLabel>
            {field(meta.date, (v) => upMeta({ date: v }), { fontSize: 11, weight: 500, family: MH_MONO })}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div style={{ background: MH.teal, borderRadius: MH.chipRadius, padding: "4px 10px", minWidth: 0,
                        display: "flex", flexDirection: "column" }}>
            <MhLabel size={6.5} colour={MH.ink}>Drawing no.</MhLabel>
            {/* Try mode: the chip reads TRIAL – NOT FOR ISSUE instead of the
                number (which is kept, just not shown or editable). */}
            {trial ? (
              <div style={{ fontSize: 11, fontWeight: 700, color: MH.ink, fontFamily: MH_MONO, letterSpacing: ".04em", whiteSpace: "nowrap" }}>
                {TRIAL_DRAWING_NUMBER}
              </div>
            ) : field(meta.drawingNumber, (v) => upSheet({ drawingNumber: v }),
                   { fontSize: 13, weight: 700, colour: MH.ink, family: MH_MONO,
                     placeholder: "WOE-0000-GF-L" })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            <MhLabel size={6.5} colour={MH.revLabel}>Rev</MhLabel>
            {field(meta.revision, (v) => upMeta({ revision: v }),
                   { fontSize: 15, weight: 700, family: MH_MONO })}
          </div>
        </div>
      </div>
    </div>
  );
}


function EditableField({ value, onChange, fontSize = 10, weight = 500, placeholder, align = "left", colour = "#2C3E50", family }) {
  return (
    <input
      type="text"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        fontSize, fontWeight: weight, color: colour,
        width: "100%", border: "none", background: "transparent",
        padding: 0, outline: "none", textAlign: align,
        fontFamily: family || "inherit",
      }}
      className="hover:bg-[#ECF8FA]/40 focus:bg-[#ECF8FA] transition-colors duration-150"
    />
  );
}
