"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/AppShell";
import { NeedsSignalBoundary } from "@/components/NeedsSignal";

const BusinessInfo = dynamic(() => import("@/components/BusinessInfo"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen flex items-center justify-center bg-[#F4F6F9] dark:bg-[#0B1117]">
      <div className="text-[10px] tracking-[0.3em] text-slate-400 uppercase">Loading&hellip;</div>
    </div>
  ),
});

export default function BusinessPage() {
  const router = useRouter();
  const { refreshCompany } = useApp();
  return <NeedsSignalBoundary><BusinessInfo onSaved={refreshCompany} onClose={() => router.push("/")} /></NeedsSignalBoundary>;
}
