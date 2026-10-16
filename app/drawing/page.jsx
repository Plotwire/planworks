"use client";

import React, { Suspense, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/components/AppShell";
import { useEditorAddress } from "@/lib/useEditorAddress";

const Editor = dynamic(() => import("@/components/ElectricalPlanTool"), { ssr: false });
import EditorErrorBoundary from "@/components/EditorErrorBoundary";

function Loading() {
  return (
    <div className="w-full h-screen flex items-center justify-center bg-[#F4F6F9] dark:bg-[#0B1117]">
      <div className="text-[10px] tracking-[0.3em] text-slate-400 uppercase">Loading drawing…</div>
    </div>
  );
}

function DrawingInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { theme, toggleTheme } = useApp();
  const id = sp.get("id");
  // A new editor for each drawing the address names, except when the editor
  // itself moved the address on to a new drawing it saved (useEditorAddress).
  const { key, onProjectId } = useEditorAddress(id);

  useEffect(() => { if (!id) router.replace("/"); }, [id, router]);
  if (!id) return <Loading />;

  return (
    <EditorErrorBoundary>
    <Editor
      key={key}
      initialTarget={{ mode: "open", projectId: id, key: id }}
      onHome={() => router.push("/")}
      onProjectId={onProjectId}
      onOpenAsNew={() => router.push("/new?restore=1")}
      onOpenFloorPlan={(q) => router.push("/sketch?" + q)}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
    </EditorErrorBoundary>
  );
}

export default function DrawingPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DrawingInner />
    </Suspense>
  );
}

