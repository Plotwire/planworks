// The legal documents every account must accept: Terms of Service, Privacy
// Policy and Data Processing Terms. Their text lives in content/legal/*.md and
// is shown at the public pages below.

// The version of the documents a user accepts, as a date.
//
// >>> Changing this value makes EVERY user accept again. <<<
// Acceptances are recorded per version (public.terms_acceptances, one row per
// user per version), and the app lets nobody past the acceptance page without
// a row for the CURRENT version. So bump it whenever the wording changes in a
// way users must agree to, and leave it alone for typo fixes.
export const LEGAL_VERSION = "2026-10-01";

// Public pages, reachable signed out (see PUBLIC_PATHS in components/AppShell.jsx).
export const LEGAL_LINKS = {
  terms: "/terms",
  privacy: "/privacy",
  dataProcessing: "/data-processing",
};

// Wording of the two acknowledgements, shared by sign-up and the acceptance page.
export const NOT_DESIGN_TOOL_TEXT =
  "I understand Plotwire is not an electrical design tool, and that I must check all quantities, prices and calculations myself";
