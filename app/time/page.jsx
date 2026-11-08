"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// An operative never reaches this page: AppShell shows them their own screen
// here and at every other address. Anyone else has no use for it, so goes home.
export default function TimePage() {
  const router = useRouter();
  useEffect(() => { router.replace("/"); }, [router]);
  return null;
}
