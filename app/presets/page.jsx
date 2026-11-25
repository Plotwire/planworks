"use client";

import React from "react";
import dynamic from "next/dynamic";
import { NeedsSignalBoundary } from "@/components/NeedsSignal";

// Presets & pricing, from the dashboard (components/PresetsPage.jsx).
const PresetsPage = dynamic(() => import("@/components/PresetsPage"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen flex items-center justify-center bg-[#F4F6F9] dark:bg-[#0B1117]">
      <div className="text-[10px] tracking-[0.3em] uppercase text-slate-400">Loading&hellip;</div>
    </div>
  ),
});

export default function Presets() {
  return <NeedsSignalBoundary><PresetsPage /></NeedsSignalBoundary>;
}
