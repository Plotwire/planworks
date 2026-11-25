"use client";

import JoinInvite from "@/components/timesheets/JoinInvite";

// A worker's invite link lands here (/time/join?invite=<code>). Public: no
// Coming Soon page, terms or customer set-up (components/AppShell.jsx).
export default function JoinPage() {
  return <JoinInvite />;
}
