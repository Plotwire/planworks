"use client";

// The Presets & pricing page (app/presets), opened from the dashboard's
// Presets & pricing section. Edits the account's presets in place: the same
// saved settings as before (boqTemplate, boqPrefs), so everything already set
// carries over. It waits until the account's presets are known (presetsReady),
// so nobody ever starts typing over the built-in defaults by mistake.

import React from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/AppShell";
import { BoqTemplateEditor } from "@/components/SheetParts";

export default function PresetsPage() {
  const router = useRouter();
  const { boqTemplate, boqPrefs, saveBoqTemplate, presetsReady = false, presetsFrom = null } = useApp();
  const home = () => router.push("/");

  if (!presetsReady) {
    // "none": no copy on this device and no signal. Never show the built-in
    // defaults as if they were this account's presets.
    const offline = presetsFrom === "none";
    return (
      <div className="min-h-screen bg-[#F4F6F9] flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="text-[11px] tracking-[0.3em] uppercase text-slate-500">Presets &amp; pricing</div>
          <p className="mt-3 text-[15px] text-slate-700">
            {offline
              ? "Your presets haven't been downloaded to this device yet, and there's no signal. Try again when you have signal."
              : "Loading your presets…"}
          </p>
          {offline && (
            <button onClick={home}
              className="mt-5 h-11 px-5 rounded-lg bg-[var(--action)] text-[color:var(--action-ink)] hover:bg-[var(--action-hover)] text-[13px] font-semibold">
              Back to dashboard
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <BoqTemplateEditor
      saved={boqTemplate}
      savedPrefs={boqPrefs}
      onSave={async (tpl, prefs) => { await saveBoqTemplate?.(tpl, prefs); }}
      onClose={home}
    />
  );
}
