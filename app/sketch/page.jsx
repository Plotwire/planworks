"use client";

import React, { Suspense } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

const CadSketch = dynamic(() => import("@/components/cad/CadSketch"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen flex items-center justify-center bg-[#18222D]">
      <div className="text-[10px] tracking-[0.3em] text-slate-400 uppercase">Loading sketch…</div>
    </div>
  ),
});

function SketchInner() {
  const sp = useSearchParams();
  return (
    <CadSketch
      openSketchId={sp.get("load") || null}
      linkProject={sp.get("project") || null}
      linkSheet={sp.get("sheet") || null}
      linkName={sp.get("name") || null}
    />
  );
}

export default function SketchPage() {
  return (
    <Suspense fallback={
      <div className="w-full h-screen flex items-center justify-center bg-[#18222D]">
        <div className="text-[10px] tracking-[0.3em] text-slate-400 uppercase">Loading sketch…</div>
      </div>
    }>
      <SketchInner />
    </Suspense>
  );
}
