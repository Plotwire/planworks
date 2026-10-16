"use client";

import React, { Suspense } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/components/AppShell";
import { useEditorAddress } from "@/lib/useEditorAddress";

const Editor = dynamic(() => import("@/components/ElectricalPlanTool"), { ssr: false });
import EditorErrorBoundary from "@/components/EditorErrorBoundary";

function Loading() {
  return (
    <div className="w-full h-screen flex items-center justify-center bg-[#F4F6F9] dark:bg-[#0B1117]">
      <div className="text-[10px] tracking-[0.3em] text-slate-400 uppercase">New drawing…</div>
    </div>
  );
}

function NewInner() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { theme, toggleTheme } = useApp();
  // When the new drawing is first saved it gets a real id, and the editor puts
  // /drawing?id=… in the address bar (useEditorAddress) so it is linkable,
  // without a reload. Next keeps that history entry as this page, so Back or
  // Forward -- or the app being shown again after signing back in -- can bring
  // this page up with that address: the drawing it names is opened then,
  // never a blank new one in its place.
  const openId = pathname === "/drawing" ? sp.get("id") : null;
  const { key, onProjectId } = useEditorAddress(openId);
  const target = openId
    ? { mode: "open", projectId: openId }
    : { mode: sp.get("import") ? "import" : "new", restoreUnsaved: sp.get("restore") === "1" };

  return (
    <EditorErrorBoundary>
    <Editor
      key={key}
      initialTarget={target}
      onHome={() => router.push("/")}
      onProjectId={onProjectId}
      onOpenAsNew={() => router.push("/new?restore=1")}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
    </EditorErrorBoundary>
  );
}

export default function NewPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewInner />
    </Suspense>
  );
}
