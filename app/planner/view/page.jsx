"use client";

import React, { Suspense } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

const WorkPlanner = dynamic(() => import("@/components/WorkPlanner"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen flex items-center justify-center bg-[#e9eef0] dark:bg-[#0E141B]">
      <div className="text-[10px] tracking-[0.3em] text-slate-400 uppercase">{"Loading planner\u2026"}</div>
    </div>
  ),
});

function SharedInner() {
  const sp = useSearchParams();
  const token = sp.get("t") || "";
  return <WorkPlanner sharedView shared={token} />;
}

export default function SharedPlannerPage() {
  return (
    <Suspense fallback={
      <div className="w-full h-screen flex items-center justify-center bg-[#e9eef0] dark:bg-[#0E141B]">
        <div className="text-[10px] tracking-[0.3em] text-slate-400 uppercase">{"Loading planner\u2026"}</div>
      </div>
    }>
      <SharedInner />
    </Suspense>
  );
}
