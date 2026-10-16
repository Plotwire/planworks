"use client";

import { useCallback, useRef } from "react";

// The editor puts its drawing's address in the bar itself -- /drawing?id=<row>
// once a new drawing is first saved, or a save is kept as a new drawing -- with
// history.replaceState, which Next 14.2 passes on to usePathname and
// useSearchParams without a navigation. That change of id must not start a new
// editor: the one on screen already holds that drawing. Any other change of id
// (Back or Forward to another drawing's history entry) must, so the editor
// always shows the drawing the address names.
//
// id: the drawing id the page's address names now (null for a new drawing).
// Returns the key to mount the editor with, and its onProjectId.
export function useEditorAddress(id) {
  const ownRef = useRef(null); // the id the editor last put in the bar itself
  const seenRef = useRef({ id, key: 0 });
  if (id !== seenRef.current.id) {
    const own = Boolean(id) && id === ownRef.current;
    ownRef.current = null;
    seenRef.current = { id, key: own ? seenRef.current.key : seenRef.current.key + 1 };
  }
  const onProjectId = useCallback((newId) => {
    if (!newId || typeof window === "undefined") return;
    const shown = new URLSearchParams(window.location.search).get("id");
    if (window.location.pathname === "/drawing" && shown === newId) return;
    ownRef.current = newId;
    window.history.replaceState(null, "", `/drawing?id=${newId}`);
  }, []);
  return { key: seenRef.current.key, onProjectId };
}
