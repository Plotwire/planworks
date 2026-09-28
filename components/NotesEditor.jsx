"use client";

/* ============================================================================
 * INSTALLATION NOTES EDITOR
 * ----------------------------------------------------------------------------
 * A TipTap (ProseMirror) rich-text editor for the per-drawing installation
 * notes. It replaced a contentEditable + document.execCommand implementation,
 * which was deprecated and produced inconsistent markup across browsers.
 *
 * STORAGE IS UNCHANGED: notes are an HTML string on the sheet (sheets[].notes),
 * saved through the normal project save path. TipTap reads HTML in via
 * setContent and writes HTML out via getHTML(), so the stored shape is exactly
 * what it always was.
 *
 * PRESERVING OLD NOTES
 * Notes written by the old editor carry execCommand-era markup. Two kinds:
 *
 *   1. <span style="font-size: x-large; color: rgb(...)">
 *      Handled natively -- TipTap's FontSize and Color extensions parse
 *      element.style.fontSize / element.style.color, keyword sizes included,
 *      and render the same style back out.
 *
 *   2. <font size="5" color="#dc2626">
 *      NOT in TipTap's schema, so the tag would be dropped and its formatting
 *      lost. fontTagsToSpans() below rewrites these to styled spans before the
 *      content ever reaches the editor.
 *
 * New sizes deliberately use the same CSS keywords the old editor emitted
 * (small / medium / x-large) so old and new notes render identically.
 * ========================================================================= */

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color, FontSize } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { X, Bold, Italic, List, Heading2, Heading3, RemoveFormatting } from "lucide-react";

/** The size keywords the old execCommand editor produced, so nothing shifts. */
const SIZES = [
  { label: "A", value: "small",   px: 11, title: "Small text" },
  { label: "A", value: "medium",  px: 13, title: "Normal text" },
  { label: "A", value: "x-large", px: 16, title: "Large text" },
];

const COLOURS = [
  { label: "Black", value: "#262626" },
  { label: "Red",   value: "#dc2626" },
  { label: "Blue",  value: "#1d4ed8" },
  { label: "Green", value: "#15803d" },
];

// <font size="1..7"> used the same scale as execCommand's fontSize argument.
const FONT_TAG_SIZES = {
  1: "xx-small", 2: "x-small", 3: "small", 4: "medium",
  5: "large", 6: "x-large", 7: "xx-large",
};

/**
 * Rewrite legacy <font> tags as styled spans so their formatting survives.
 * Anything TipTap already understands is left completely alone.
 */
export function fontTagsToSpans(html) {
  if (!html || typeof html !== "string" || !/<font\b/i.test(html)) return html;
  try {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    doc.body.querySelectorAll("font").forEach((el) => {
      const span = doc.createElement("span");
      const size = el.getAttribute("size");
      const colour = el.getAttribute("color");
      const face = el.getAttribute("face");
      if (size && FONT_TAG_SIZES[size]) span.style.fontSize = FONT_TAG_SIZES[size];
      if (colour) span.style.color = colour;
      if (face) span.style.fontFamily = face;
      while (el.firstChild) span.appendChild(el.firstChild);
      el.replaceWith(span);
    });
    return doc.body.innerHTML;
  } catch {
    return html; // never lose the note over a parsing problem
  }
}

const BTN = {
  minWidth: 30, height: 30, padding: "0 8px", borderRadius: 7,
  border: "1px solid #e2e8f0", background: "#fff", color: "#334155",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", lineHeight: 0,
};
const BTN_ON = { ...BTN, background: "#2C97A8", borderColor: "#2C97A8", color: "#1A2530" };

function ToolBtn({ active, title, onClick, children, style }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={Boolean(active)}
      onClick={onClick}
      style={{ ...(active ? BTN_ON : BTN), ...style }}
    >
      {children}
    </button>
  );
}

export default function NotesEditor({ notes, updateNotes, onClose }) {
  const editor = useEditor({
    // No SSR here (the editor is inside a client-only tree), and the toolbar
    // needs to re-render as the selection moves so its active states stay true.
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      TextStyle,
      Color,
      FontSize,
      Placeholder.configure({ placeholder: "Type notes here..." }),
    ],
    content: fontTagsToSpans(notes || ""),
    editorProps: {
      attributes: { class: "pw-notes notes-tiptap" },
    },
    onUpdate: ({ editor }) => updateNotes(editor.getHTML()),
  });

  // Re-load if the sheet changes underneath the open editor.
  useEffect(() => {
    if (!editor) return;
    const incoming = fontTagsToSpans(notes || "");
    if (incoming !== editor.getHTML()) editor.commands.setContent(incoming, { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const chain = () => editor?.chain().focus();

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}>
      <div className="bg-white dark:bg-[#16202B] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 h-12 bg-[#2C3E50] shrink-0">
          <div className="text-white font-semibold tracking-wide" style={{ fontFamily: "var(--font-space-grotesk), sans-serif" }}>Installation Notes</div>
          <button onClick={onClose} className="text-slate-300 hover:text-white transition-colors" aria-label="Close"><X size={18}/></button>
        </div>

        {/* Formatting toolbar. preventDefault on mousedown keeps the selection,
            so Bold then Colour can be chained without re-highlighting. */}
        <div className="px-5 py-3 border-b border-slate-200 dark:border-[#263441] flex items-center gap-2 flex-wrap shrink-0"
          onMouseDown={(e) => e.preventDefault()}>

          <ToolBtn title="Bold" active={editor?.isActive("bold")} onClick={() => chain()?.toggleBold().run()}>
            <Bold size={15} strokeWidth={2.4}/>
          </ToolBtn>
          <ToolBtn title="Italic" active={editor?.isActive("italic")} onClick={() => chain()?.toggleItalic().run()}>
            <Italic size={15} strokeWidth={2.2}/>
          </ToolBtn>

          <span style={{ width: 1, height: 18, background: "#d4d4d4", margin: "0 3px" }}/>

          <ToolBtn title="Heading" active={editor?.isActive("heading", { level: 2 })}
            onClick={() => chain()?.toggleHeading({ level: 2 }).run()}>
            <Heading2 size={15} strokeWidth={2.2}/>
          </ToolBtn>
          <ToolBtn title="Sub-heading" active={editor?.isActive("heading", { level: 3 })}
            onClick={() => chain()?.toggleHeading({ level: 3 }).run()}>
            <Heading3 size={15} strokeWidth={2.2}/>
          </ToolBtn>
          <ToolBtn title="Bullet list" active={editor?.isActive("bulletList")}
            onClick={() => chain()?.toggleBulletList().run()}>
            <List size={15} strokeWidth={2.2}/>
          </ToolBtn>

          <span style={{ width: 1, height: 18, background: "#d4d4d4", margin: "0 3px" }}/>

          {SIZES.map((s) => (
            <ToolBtn key={s.value} title={s.title}
              active={editor?.isActive("textStyle", { fontSize: s.value })}
              onClick={() => chain()?.setFontSize(s.value).run()}
              style={{ fontSize: s.px, fontWeight: 600, lineHeight: 1 }}>
              {s.label}
            </ToolBtn>
          ))}

          <span style={{ width: 1, height: 18, background: "#d4d4d4", margin: "0 3px" }}/>
          <span className="text-[10px] uppercase tracking-wider text-slate-400 mr-0.5">Colour</span>
          {COLOURS.map((c) => (
            <button key={c.value} type="button" title={`${c.label} text`} aria-label={`${c.label} text`}
              onClick={() => chain()?.setColor(c.value).run()}
              style={{ width: 18, height: 18, borderRadius: "50%", background: c.value,
                       border: "1px solid rgba(0,0,0,0.18)", cursor: "pointer", padding: 0 }}/>
          ))}

          <ToolBtn title="Clear formatting"
            onClick={() => chain()?.unsetAllMarks().clearNodes().run()}
            style={{ marginLeft: "auto" }}>
            <RemoveFormatting size={15} strokeWidth={2.2}/>
          </ToolBtn>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4" style={{ background: "#fff", minHeight: 260 }}>
          <EditorContent editor={editor} />
        </div>

        <div className="px-5 py-3 border-t border-slate-200 dark:border-[#263441] flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-400">Notes apply to the current drawing.</span>
          <button onClick={onClose}
            className="px-4 py-2 rounded-md text-[11px] uppercase tracking-wider font-semibold bg-[#2C97A8] text-[#1A2530] hover:bg-[#22808F] transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
