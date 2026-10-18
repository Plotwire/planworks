"use client";

import React from "react";
import dynamic from "next/dynamic";
import { NeedsSignalBoundary } from "@/components/NeedsSignal";

const WorkPlanner = dynamic(() => import("@/components/WorkPlanner"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen flex items-center justify-center bg-[#e7eceb]">
      <div className="text-[10px] tracking-[0.3em] text-slate-400 uppercase">{"Loading planner\u2026"}</div>
    </div>
  ),
});

export default function PlannerPage() {
  return <NeedsSignalBoundary><WorkPlanner /></NeedsSignalBoundary>;
}

