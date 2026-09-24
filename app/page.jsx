"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/AppShell";

const HomeScreen = dynamic(() => import("@/components/HomeScreen"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen flex items-center justify-center bg-[#F4F6F9] dark:bg-[#0B1117]">
      <div className="text-[10px] tracking-[0.3em] text-slate-400 uppercase">Loading…</div>
    </div>
  ),
});

export default function DashboardPage() {
  const router = useRouter();
  const { theme, toggleTheme, user, signOut } = useApp();
  return (
    <HomeScreen
      onOpenProject={(id) => router.push(`/drawing?id=${id}`)}
      onNewProject={() => router.push("/new")}
      onImport={() => router.push("/new?import=1")}
      onSketch={() => router.push("/sketch")}
      onPlanner={() => router.push("/planner")}
      onBusiness={() => router.push("/business")}
      theme={theme}
      onToggleTheme={toggleTheme}
      user={user}
      onSignOut={signOut}
    />
  );
}


