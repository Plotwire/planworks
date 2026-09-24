// A public legal page: Terms of Service, Privacy Policy or Data Processing
// Terms. Server component -- the markdown in content/legal/ is read and
// rendered at build time, so the pages are static and need nobody signed in.
// They are listed in PUBLIC_PATHS (components/AppShell.jsx), which keeps them
// outside the login, Coming Soon, acceptance and paywall gates.

import fs from "fs";
import path from "path";
import { marked } from "marked";
import { LEGAL_VERSION, LEGAL_LINKS } from "@/lib/legal";

export const LEGAL_DOCS = {
  terms:            { file: "terms.md",           title: "Terms of Service",      href: LEGAL_LINKS.terms },
  privacy:          { file: "privacy.md",         title: "Privacy Policy",        href: LEGAL_LINKS.privacy },
  "data-processing": { file: "data-processing.md", title: "Data Processing Terms", href: LEGAL_LINKS.dataProcessing },
};

export default function LegalDocument({ doc }) {
  const { file, title } = LEGAL_DOCS[doc];
  const markdown = fs.readFileSync(path.join(process.cwd(), "content", "legal", file), "utf8");
  // Our own files, not user input, so rendering their HTML is safe.
  const html = marked.parse(markdown, { async: false });

  return (
    <div className="legal-root">
      <style>{CSS}</style>
      <header className="legal-top">
        <a href="/" className="legal-brand" aria-label="Plotwire home">
          <svg viewBox="0 0 128 128" width="28" height="28" aria-hidden>
            <rect width="128" height="128" rx="37" fill="#2C97A8" />
            <path d="M67 24 L41 61.5 h12 L50 104 L76 66.5 h-12 z" fill="#1A2530" />
          </svg>
          <span>Plot<b>wire</b></span>
        </a>
        <nav className="legal-nav" aria-label="Legal documents">
          {Object.entries(LEGAL_DOCS).map(([key, d]) => (
            <a key={key} href={d.href} aria-current={key === doc ? "page" : undefined}>{d.title}</a>
          ))}
        </nav>
      </header>

      <main className="legal-main">
        <h1>{title}</h1>
        <p className="legal-version">Version {LEGAL_VERSION}</p>
        <article className="legal-body" dangerouslySetInnerHTML={{ __html: html }} />
      </main>
    </div>
  );
}

const CSS = `
.legal-root{min-height:100vh; background:#F4F6F9; color:#1A2530; font-family:'Inter',system-ui,sans-serif}
.legal-top{display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; padding:16px 24px; background:#fff; border-bottom:1px solid #E6EBF1}
.legal-brand{display:flex; align-items:center; gap:10px; text-decoration:none; color:#1A2530; font-family:'Space Grotesk',sans-serif; font-size:19px; font-weight:500}
.legal-brand b{color:#2C97A8; font-weight:700}
.legal-nav{display:flex; gap:18px; flex-wrap:wrap}
.legal-nav a{color:#3A4654; text-decoration:none; font-size:13.5px}
.legal-nav a:hover{color:#22808F; text-decoration:underline}
.legal-nav a[aria-current="page"]{color:#22808F; font-weight:600}
.legal-main{max-width:760px; margin:0 auto; padding:40px 24px 72px}
.legal-main h1{font-family:'Space Grotesk',sans-serif; font-size:30px; font-weight:600; letter-spacing:-.02em}
.legal-version{margin-top:6px; color:#697785; font-size:13px}
.legal-body{margin-top:28px; font-size:15px; line-height:1.7; color:#26313D}
.legal-body h2{font-family:'Space Grotesk',sans-serif; font-size:19px; font-weight:600; margin:30px 0 8px; color:#1A2530}
.legal-body h3{font-size:16px; font-weight:600; margin:22px 0 6px}
.legal-body p{margin:0 0 12px}
.legal-body ul,.legal-body ol{margin:0 0 12px 22px}
.legal-body li{margin:4px 0}
.legal-body a{color:#22808F}
.legal-body blockquote{margin:0 0 20px; padding:12px 16px; border-left:3px solid #2C97A8; background:#fff; border-radius:0 10px 10px 0}
.legal-body blockquote p{margin:0}
.legal-body table{border-collapse:collapse; margin:0 0 16px; width:100%}
.legal-body th,.legal-body td{border:1px solid #E6EBF1; padding:6px 10px; text-align:left; vertical-align:top}
@media (max-width:560px){ .legal-main{padding:28px 16px 56px} .legal-top{padding:14px 16px} }
`;
