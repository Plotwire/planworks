"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { NeedsSignalBoundary } from "@/components/NeedsSignal";

const TimesheetsHome = dynamic(() => import("@/components/timesheets/TimesheetsHome"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen flex items-center justify-center bg-[#F4F6F9] dark:bg-[#0B1117]">
      <div className="text-[10px] tracking-[0.3em] text-slate-400 uppercase">Loading&hellip;</div>
    </div>
  ),
});

export default function TimesheetsPage() {
  const router = useRouter();
  return (
    <NeedsSignalBoundary>
      <TimesheetsHome onClose={() => router.push("/")} onNotAllowed={() => router.replace("/")} />
    </NeedsSignalBoundary>
  );
}
