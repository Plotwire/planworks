"use client";

import React from "react";
import { LEGAL_LINKS, NOT_DESIGN_TOOL_TEXT } from "@/lib/legal";

// The two acknowledgements every account must give, used on the sign-up form
// and on the acceptance page. Both start unticked; the caller keeps its submit
// button disabled until both are ticked. Styled by the .consent rules in
// components/LoginScreen.jsx (both screens use its AuthFrame).
export default function TermsCheckboxes({ agreed, onAgreedChange, acknowledged, onAcknowledgedChange, disabled = false }) {
  return (
    <div className="consent">
      <label className="consent-row">
        <input type="checkbox" checked={agreed} disabled={disabled}
               onChange={(e) => onAgreedChange(e.target.checked)} />
        <span>
          I agree to the{" "}
          <a href={LEGAL_LINKS.terms} target="_blank" rel="noopener noreferrer">Terms of Service</a>
          {" "}and{" "}
          <a href={LEGAL_LINKS.privacy} target="_blank" rel="noopener noreferrer">Privacy Policy</a>
        </span>
      </label>
      <label className="consent-row">
        <input type="checkbox" checked={acknowledged} disabled={disabled}
               onChange={(e) => onAcknowledgedChange(e.target.checked)} />
        <span>{NOT_DESIGN_TOOL_TEXT}</span>
      </label>
    </div>
  );
}
