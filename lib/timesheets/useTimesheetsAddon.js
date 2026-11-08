"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

// Has this owner's account got Timesheets switched on? The database answers.
//   status: "checking" | "on" | "off" | "failed"
// A check that fails is "failed", never read as on or off.
export function useTimesheetsAddon(userId) {
  const [result, setResult] = useState({ uid: null, status: "checking" });
  const latest = useRef(0);

  const check = useCallback(async () => {
    const run = ++latest.current;
    setResult({ uid: userId, status: "checking" });
    if (!userId || !supabase) {
      setResult({ uid: userId, status: "off" });
      return;
    }
    const { data, error } = await supabase.rpc("timesheets_context");
    if (run !== latest.current) return;
    const on = data?.role === "owner" && data?.addon === true;
    setResult({ uid: userId, status: error ? "failed" : on ? "on" : "off" });
  }, [userId]);

  useEffect(() => { check(); }, [check]);

  return { status: result.uid === userId ? result.status : "checking", retry: check };
}
