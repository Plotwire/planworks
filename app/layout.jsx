import "./globals.css";
import AppShell from "@/components/AppShell";
import { Inter, Space_Grotesk, JetBrains_Mono, Barlow, Barlow_Condensed, Barlow_Semi_Condensed } from "next/font/google";

export const metadata = {
  title: "Plotwire — Electrical Layout Tool",
  description: "Drag-and-drop electrical symbols onto architectural drawings",
};

// Fonts are self-hosted: next/font downloads them at build time and serves
// them from this site, so no visitor's browser contacts Google. Same families
// and weights as the old Google Fonts link. Each is exposed as a CSS variable
// (e.g. var(--font-inter)), which is how every stylesheet and inline style in
// the app names it -- next/font gives the files their own generated family
// names, so the plain names ('Inter' etc.) would no longer match anything.
// Inter, Space Grotesk and JetBrains Mono are variable fonts (every weight,
// including Inter's 450). The Barlow family is used by the work planner.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], display: "swap", variable: "--font-space-grotesk" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-jetbrains-mono" });
const barlow = Barlow({ subsets: ["latin"], display: "swap", weight: ["400", "500", "600", "700"], variable: "--font-barlow" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], display: "swap", weight: ["500", "600", "700"], variable: "--font-barlow-condensed" });
const barlowSemi = Barlow_Semi_Condensed({ subsets: ["latin"], display: "swap", weight: ["600", "700"], variable: "--font-barlow-semi-condensed" });

const fontVars = [inter, spaceGrotesk, jetbrainsMono, barlow, barlowCondensed, barlowSemi].map((f) => f.variable).join(" ");

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={fontVars}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
