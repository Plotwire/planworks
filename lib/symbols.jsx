/* ============================================================================
 * SYMBOL LIBRARY — UK Architectural Plan Style
 * Drawn in-house to common UK residential electrical-plan conventions.
 *
 * Two layers:
 *   1. SYMBOLS — visual definitions, grouped by category
 *   2. SYMBOL_META — legend descriptions + mounting heights (AFL)
 * ========================================================================= */

"use client";

import React from "react";

const STROKE = 1.5;
const FEEDER = 1.0;

export const CATEGORY_COLOURS = {
  sockets:   { primary: "#1d4ed8", soft: "#93c5fd", label: "Blue"   },
  switches:  { primary: "#15803d", soft: "#86efac", label: "Green"  },
  lighting:  { primary: "#b45309", soft: "#fcd34d", label: "Amber"  },
  detectors: { primary: "#b91c1c", soft: "#fca5a5", label: "Red"    },
  security:  { primary: "#7c2d12", soft: "#fdba74", label: "Burnt"  },
  fixtures:  { primary: "#6d28d9", soft: "#c4b5fd", label: "Violet" },
  data:      { primary: "#0e7490", soft: "#67e8f9", label: "Cyan"   },
  heating:   { primary: "#0f172a", soft: "#94a3b8", label: "Slate"  },
};

// Small "H" mark used to differentiate high-level variants visually
const HighLevelMark = ({ x = 38, y = 10 }) => (
  <g>
    <circle cx={x} cy={y} r={4} fill="#ffffff" stroke="currentColor" strokeWidth={1}/>
    <text x={x} y={y + 2.7} fontSize="6" textAnchor="middle"
          fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700"
          fill="currentColor">H</text>
  </g>
);

export const SYMBOLS = {
  sockets: {
    label: "Sockets",
    items: [
      // ---- Low level (450mm AFL) ----
      { id: "sock_sso_ll", name: "Single Socket (LL)", svg: (
        <g>
          <path d="M 14 28 A 10 10 0 0 1 34 28 Z" fill="currentColor"/>
          <line x1="24" y1="20" x2="24" y2="12" stroke="var(--feeder)" strokeWidth={FEEDER} strokeLinecap="round"/>
        </g>
      )},
      { id: "sock_dso_ll", name: "Double Socket (LL)", svg: (
        <g>
          <path d="M 4 28 A 10 10 0 0 1 24 28 Z" fill="currentColor"/>
          <path d="M 24 28 A 10 10 0 0 1 44 28 Z" fill="currentColor"/>
          <line x1="14" y1="20" x2="14" y2="12" stroke="var(--feeder)" strokeWidth={FEEDER} strokeLinecap="round"/>
          <line x1="34" y1="20" x2="34" y2="12" stroke="var(--feeder)" strokeWidth={FEEDER} strokeLinecap="round"/>
        </g>
      )},
      { id: "sock_dso_usb_ll", name: "Double Socket USB-C (LL)", svg: (
        <g>
          <path d="M 4 28 A 10 10 0 0 1 24 28 Z" fill="currentColor"/>
          <path d="M 24 28 A 10 10 0 0 1 44 28 Z" fill="currentColor"/>
          <line x1="14" y1="20" x2="14" y2="12" stroke="var(--feeder)" strokeWidth={FEEDER} strokeLinecap="round"/>
          <text x="38" y="14" fontSize="5.5" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">USB-C</text>
        </g>
      )},

      // ---- High level (1100mm AFL) — same drawing + 'H' badge ----
      { id: "sock_sso_hl", name: "Single Socket (HL)", svg: (
        <g>
          <path d="M 14 28 A 10 10 0 0 1 34 28 Z" fill="currentColor"/>
          <line x1="24" y1="20" x2="24" y2="12" stroke="var(--feeder)" strokeWidth={FEEDER} strokeLinecap="round"/>
          <HighLevelMark/>
        </g>
      )},
      { id: "sock_dso_hl", name: "Double Socket (HL)", svg: (
        <g>
          <path d="M 4 28 A 10 10 0 0 1 24 28 Z" fill="currentColor"/>
          <path d="M 24 28 A 10 10 0 0 1 44 28 Z" fill="currentColor"/>
          <line x1="14" y1="20" x2="14" y2="12" stroke="var(--feeder)" strokeWidth={FEEDER} strokeLinecap="round"/>
          <line x1="34" y1="20" x2="34" y2="12" stroke="var(--feeder)" strokeWidth={FEEDER} strokeLinecap="round"/>
          <HighLevelMark x={44} y={6}/>
        </g>
      )},
      { id: "sock_dso_usb_hl", name: "Double Socket USB-C (HL)", svg: (
        <g>
          <path d="M 4 28 A 10 10 0 0 1 24 28 Z" fill="currentColor"/>
          <path d="M 24 28 A 10 10 0 0 1 44 28 Z" fill="currentColor"/>
          <line x1="14" y1="20" x2="14" y2="12" stroke="var(--feeder)" strokeWidth={FEEDER} strokeLinecap="round"/>
          <text x="38" y="14" fontSize="5.5" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">USB-C</text>
          <HighLevelMark x={44} y={22}/>
        </g>
      )},

      // ---- Specialist outlets ----
      { id: "sock_2a", name: "2A Socket", svg: (
        <g>
          <path d="M 14 28 A 10 10 0 0 1 34 28 Z" fill="currentColor" transform="scale(0.85) translate(4 5)"/>
        </g>
      )},
      { id: "sock_cooker", name: "Cooker Outlet", svg: (
        <g>
          <path d="M 6 30 A 14 14 0 0 1 42 30 Z" fill="currentColor"/>
          <line x1="24" y1="20" x2="24" y2="10" stroke="var(--feeder)" strokeWidth={FEEDER} strokeLinecap="round"/>
        </g>
      )},
      { id: "sock_shaver", name: "Shaver Socket", svg: (
        <g>
          <rect x="10" y="10" width="28" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <circle cx="18" cy="16" r="1.6" fill="currentColor"/>
          <circle cx="30" cy="16" r="1.6" fill="currentColor"/>
          <line x1="14" y1="22" x2="14" y2="28" stroke="currentColor" strokeWidth={FEEDER}/>
          <line x1="34" y1="22" x2="34" y2="28" stroke="currentColor" strokeWidth={FEEDER}/>
        </g>
      )},
      { id: "sock_tv", name: "TV Point", svg: (
        <g>
          <rect x="14" y="10" width="20" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <text x="24" y="20" fontSize="9" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="600">TV</text>
          <line x1="34" y1="17" x2="44" y2="17" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
        </g>
      )},
      { id: "sock_fcu", name: "Switched Fused Spur", svg: (
        <g>
          <rect x="14" y="8" width="20" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <text x="24" y="18" fontSize="8" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="600">FCU</text>
          <circle cx="15" cy="34" r="1.8" fill="currentColor"/>
          <line x1="15" y1="34" x2="30" y2="28" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round"/>
        </g>
      )},
      { id: "spur_unsw", name: "Unswitched Fused Spur", svg: (
        <g>
          <rect x="14" y="8" width="20" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <text x="24" y="18" fontSize="8" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="600">FCU</text>
          <rect x="19" y="28" width="10" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth={FEEDER}/>
          <line x1="19" y1="31.5" x2="29" y2="31.5" stroke="currentColor" strokeWidth={FEEDER}/>
        </g>
      )},
    ],
  },

  switches: {
    label: "Switches",
    items: [
      { id: "sw_light", name: "Light Switch", svg: (
        <g>
          <circle cx="14" cy="28" r="2.6" fill="currentColor"/>
          <line x1="14" y1="28" x2="32" y2="14" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round"/>
        </g>
      )},
      { id: "sw_2g", name: "2 Gang Switch", svg: (
        <g>
          <circle cx="13" cy="30" r="2.6" fill="currentColor"/>
          <line x1="13" y1="30" x2="29" y2="16" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round"/>
          <text x="37" y="20" fontSize="11" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">2</text>
        </g>
      )},
      { id: "sw_3g", name: "3 Gang Switch", svg: (
        <g>
          <circle cx="13" cy="30" r="2.6" fill="currentColor"/>
          <line x1="13" y1="30" x2="29" y2="16" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round"/>
          <text x="37" y="20" fontSize="11" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">3</text>
        </g>
      )},
      { id: "sw_4g", name: "4 Gang Switch", svg: (
        <g>
          <circle cx="13" cy="30" r="2.6" fill="currentColor"/>
          <line x1="13" y1="30" x2="29" y2="16" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round"/>
          <text x="37" y="20" fontSize="11" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">4</text>
        </g>
      )},
      { id: "sw_grid", name: "Grid Switch", svg: (
        <g>
          <rect x="12" y="12" width="24" height="24" rx="3" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <line x1="24" y1="12" x2="24" y2="36" stroke="currentColor" strokeWidth={FEEDER}/>
          <line x1="12" y1="24" x2="36" y2="24" stroke="currentColor" strokeWidth={FEEDER}/>
        </g>
      )},
      { id: "sw_2way", name: "2-Way Switch", svg: (
        <g>
          <circle cx="14" cy="28" r="2.6" fill="currentColor"/>
          <line x1="14" y1="28" x2="32" y2="14" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round"/>
          <text x="38" y="18" fontSize="8" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="600">2</text>
        </g>
      )},
      { id: "sw_intermediate", name: "Intermediate", svg: (
        <g>
          <circle cx="14" cy="28" r="2.6" fill="currentColor"/>
          <line x1="14" y1="28" x2="32" y2="14" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round"/>
          <text x="40" y="18" fontSize="6.5" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="600">int</text>
        </g>
      )},
      { id: "sw_dimmer", name: "Dimmer Switch", forceColor: "#dc2626", svg: (
        <g>
          <circle cx="14" cy="28" r="3" fill="currentColor"/>
          <line x1="14" y1="28" x2="32" y2="14" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round"/>
        </g>
      )},
      { id: "sw_pull", name: "Pull Switch", svg: (
        <g>
          <circle cx="24" cy="10" r="2.6" fill="currentColor"/>
          <line x1="24" y1="10" x2="24" y2="38" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round"/>
          <polyline points="20,34 24,40 28,34" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round"/>
        </g>
      )},
      { id: "sw_pir_light", name: "PIR Light Sensor", svg: (
        <g>
          <path d="M 12 14 L 32 22 L 12 30 Z" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
        </g>
      )},
      { id: "sw_keycard", name: "Keycard Switch", svg: (
        <g>
          <rect x="12" y="10" width="24" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <line x1="18" y1="17" x2="30" y2="17" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
        </g>
      )},
    ],
  },

  lighting: {
    label: "Lighting",
    items: [
      { id: "lt_pendant", name: "Pendant Light", svg: (
        <g>
          <circle cx="24" cy="24" r="8" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          <line x1="24" y1="6" x2="24" y2="42" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
          <line x1="6" y1="24" x2="42" y2="24" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
        </g>
      )},
      { id: "lt_downlight", name: "Downlighter", svg: (
        <g>
          <circle cx="24" cy="24" r="7.5" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          <circle cx="24" cy="24" r="3" fill="currentColor"/>
        </g>
      )},
      { id: "lt_downlight_ip", name: "Downlighter IP-rated", svg: (
        <g>
          <circle cx="24" cy="24" r="7.5" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          <circle cx="24" cy="24" r="3" fill="currentColor"/>
          <circle cx="24" cy="24" r="11" fill="none" stroke="currentColor" strokeWidth={FEEDER * 0.8} strokeDasharray="2 1.5"/>
          <text x="40" y="14" fontSize="6" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">IP</text>
        </g>
      )},
      { id: "lt_2d", name: "2D Fitting", svg: (
        <g>
          <circle cx="24" cy="24" r="11" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          <rect x="18" y="18" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth={FEEDER}/>
          <text x="24" y="27" fontSize="6.5" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">2D</text>
        </g>
      )},
      { id: "lt_batten", name: "Batten Holder", svg: (
        <g>
          <line x1="24" y1="6" x2="24" y2="42" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
          <line x1="6" y1="24" x2="42" y2="24" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
          <circle cx="24" cy="24" r="6" fill="currentColor"/>
        </g>
      )},
      { id: "lt_wall", name: "Wall Light", svg: (
        <g>
          <line x1="4" y1="42" x2="44" y2="42" stroke="var(--feeder)" strokeWidth={FEEDER} strokeLinecap="round"/>
          <circle cx="24" cy="24" r="8" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          <line x1="24" y1="6" x2="24" y2="42" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
          <line x1="10" y1="24" x2="38" y2="24" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
        </g>
      )},
      { id: "lt_strip", name: "LED Strip", svg: (
        <g>
          <rect x="6" y="20" width="36" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          {[12, 18, 24, 30, 36].map(cx => <circle key={cx} cx={cx} cy="24" r="1.2" fill="currentColor"/>)}
        </g>
      )},
      { id: "lt_emergency", name: "Emergency Light", svg: (
        <g>
          <circle cx="24" cy="24" r="11" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          <text x="24" y="28" fontSize="11" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">E</text>
        </g>
      )},
      { id: "lt_external", name: "External Light", svg: (
        <g>
          <circle cx="24" cy="24" r="8" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          <circle cx="24" cy="24" r="2.5" fill="currentColor"/>
          <line x1="24" y1="6" x2="24" y2="42" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
          <line x1="6" y1="24" x2="42" y2="24" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
          <text x="40" y="44" fontSize="6" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="600">EXT</text>
        </g>
      )},
      { id: "lt_external_updown", name: "External Up/Down (D/D)", svg: (
        <g>
          {/* bowtie — light projecting up and down */}
          <path d="M 24 24 L 12 8 L 36 8 Z" fill="currentColor"/>
          <path d="M 24 24 L 12 40 L 36 40 Z" fill="currentColor"/>
          <circle cx="24" cy="24" r="2.5" fill="currentColor"/>
        </g>
      )},
    ],
  },

  detectors: {
    label: "Detectors",
    items: [
      { id: "det_smoke", name: "Smoke Detector", svg: (
        <g>
          <line x1="24" y1="6" x2="24" y2="42" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
          <circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          <text x="36" y="20" fontSize="7" textAnchor="start" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="600">S</text>
        </g>
      )},
      { id: "det_heat", name: "Heat Detector", svg: (
        <g>
          <line x1="24" y1="6" x2="24" y2="42" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
          <circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          <text x="36" y="20" fontSize="7" textAnchor="start" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="600">H</text>
        </g>
      )},
      { id: "det_co", name: "CO Detector", svg: (
        <g>
          <line x1="24" y1="6" x2="24" y2="42" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
          <circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          <text x="36" y="20" fontSize="6.5" textAnchor="start" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="600">CO</text>
        </g>
      )},
      { id: "det_combined", name: "Smoke/Heat/CO", svg: (
        <g>
          <line x1="24" y1="6" x2="24" y2="42" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
          <circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          <text x="36" y="22" fontSize="6.5" textAnchor="start" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="600">S/H/C</text>
        </g>
      )},
      { id: "det_thermostat", name: "Thermostat", svg: (
        <g>
          <circle cx="24" cy="24" r="11" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          <line x1="16" y1="19" x2="32" y2="19" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round"/>
          <line x1="24" y1="19" x2="24" y2="31" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round"/>
        </g>
      )},
    ],
  },

  security: {
    label: "Security",
    items: [
      { id: "sec_pir", name: "Intruder PIR", svg: (
        <g>
          <path d="M 12 14 L 36 24 L 12 34 Z" fill="currentColor"/>
          <text x="22" y="26" fontSize="7" textAnchor="middle" fill="white"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">IR</text>
        </g>
      )},
      { id: "sec_keypad", name: "Alarm Keypad", svg: (
        <g>
          <rect x="12" y="8" width="24" height="32" rx="2" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          {/* small screen */}
          <rect x="15" y="11" width="18" height="5" fill="currentColor" opacity="0.85"/>
          {/* 3x3 keypad dots */}
          {[19, 24, 29].map((cx, i) => (
            <g key={i}>
              <circle cx={cx} cy={22} r={1.4} fill="currentColor"/>
              <circle cx={cx} cy={28} r={1.4} fill="currentColor"/>
              <circle cx={cx} cy={34} r={1.4} fill="currentColor"/>
            </g>
          ))}
        </g>
      )},
      { id: "sec_hub", name: "Alarm Hub", svg: (
        <g>
          <rect x="6" y="16" width="36" height="16" rx="1.5" fill="currentColor"/>
          <text x="24" y="27" fontSize="8" textAnchor="middle" fill="white"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700" letterSpacing="0.5">ALARM</text>
        </g>
      )},
      { id: "sec_bell", name: "Alarm Sounder (Bell)", svg: (
        <g>
          <rect x="13" y="11" width="22" height="20" rx="3" fill="currentColor"/>
          <path d="M 20 26 Q 20 17 24 17 Q 28 17 28 26 Z" fill="white"/>
          <circle cx="24" cy="28.5" r="1.4" fill="white"/>
          <path d="M 33 14 Q 37 18 33 22" fill="none" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
        </g>
      )},
      { id: "sec_door", name: "Door Sensor", svg: (
        <g>
          {/* two small contact bodies side-by-side */}
          <rect x="6" y="20" width="16" height="8" fill="currentColor"/>
          <rect x="26" y="20" width="16" height="8" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          {/* the gap symbol */}
          <line x1="22" y1="24" x2="26" y2="24" stroke="currentColor" strokeWidth={FEEDER} strokeDasharray="1 1"/>
        </g>
      )},
      { id: "sec_cctv", name: "CCTV Camera", svg: (
        <g>
          <line x1="8" y1="14" x2="40" y2="14" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
          <path d="M 10 14 A 14 14 0 0 0 38 14 Z" fill="currentColor"/>
          <circle cx="24" cy="22" r="5" fill="white"/>
          <circle cx="24" cy="22" r="2.6" fill="currentColor"/>
          <circle cx="22.5" cy="20.5" r="0.9" fill="white"/>
        </g>
      )},
    ],
  },

  fixtures: {
    label: "Fixtures",
    items: [
      { id: "fx_extractor", name: "Ceiling Extract", svg: (
        <g>
          <circle cx="24" cy="24" r="11" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          <line x1="16.2" y1="16.2" x2="31.8" y2="31.8" stroke="currentColor" strokeWidth={STROKE}/>
          <line x1="31.8" y1="16.2" x2="16.2" y2="31.8" stroke="currentColor" strokeWidth={STROKE}/>
        </g>
      )},
      { id: "fx_extractor_wall", name: "Wall Extract (SA)", svg: (
        <g>
          <rect x="10" y="14" width="28" height="20" fill="currentColor"/>
          <line x1="14" y1="18" x2="34" y2="30" stroke="white" strokeWidth={STROKE}/>
          <line x1="34" y1="18" x2="14" y2="30" stroke="white" strokeWidth={STROKE}/>
          <text x="40" y="14" fontSize="6" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">SA</text>
        </g>
      )},
      { id: "fx_ext_tap", name: "External Tap", svg: (
        <g>
          <path d="M 6 14 L 24 24 L 6 34 Z" fill="currentColor"/>
          <path d="M 42 14 L 24 24 L 42 34 Z" fill="currentColor"/>
        </g>
      )},
      { id: "fx_doorbell", name: "Door Bell", svg: (
        <g>
          <path d="M 14 14 Q 14 8 24 8 Q 34 8 34 14 L 34 28 L 14 28 Z"
                fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <circle cx="24" cy="34" r="2.5" fill="currentColor"/>
        </g>
      )},
      { id: "fx_motor", name: "Motor", svg: (
        <g>
          <circle cx="24" cy="24" r="11" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          <text x="24" y="28" fontSize="11" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">M</text>
        </g>
      )},
      { id: "fx_consumer", name: "Consumer Unit", svg: (
        <g>
          <rect x="3" y="14" width="42" height="22" rx="1.5" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <line x1="3" y1="22" x2="45" y2="22" stroke="currentColor" strokeWidth={FEEDER * 0.7}/>
          <rect x="5" y="24" width="6" height="10" fill="currentColor"/>
          {[14, 19, 24, 29, 34, 39].map((cx, i) => (
            <rect key={i} x={cx} y="25" width="3" height="8" fill="none" stroke="currentColor" strokeWidth={FEEDER * 0.8}/>
          ))}
          <text x="24" y="11" fontSize="7" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700" letterSpacing="0.5">CU</text>
        </g>
      )},
      { id: "fx_meter", name: "Electrical Meter Box", svg: (
        <g>
          <rect x="6" y="10" width="36" height="28" rx="3" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <rect x="10" y="14" width="28" height="14" fill="none" stroke="currentColor" strokeWidth={FEEDER}/>
          <line x1="16" y1="32" x2="32" y2="32" stroke="currentColor" strokeWidth={FEEDER}/>
          <line x1="20" y1="35" x2="28" y2="35" stroke="currentColor" strokeWidth={FEEDER}/>
          <text x="24" y="25" fontSize="9" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">M</text>
        </g>
      )},
      { id: "fx_isolator", name: "Isolator", svg: (
        <g>
          <rect x="14" y="10" width="20" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <line x1="18" y1="20" x2="28" y2="14" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
          <circle cx="18" cy="20" r="1.4" fill="currentColor"/>
        </g>
      )},
      { id: "iso_dp", name: "1G DP Isolator", svg: (
        <g>
          <rect x="11" y="11" width="26" height="26" rx="3" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <text x="24" y="22" fontSize="8.5" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">DP</text>
          <circle cx="16" cy="31" r="1.6" fill="currentColor"/>
          <line x1="16" y1="31" x2="30" y2="26" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round"/>
        </g>
      )},
      { id: "iso_rotary", name: "Rotary Isolator", svg: (
        <g>
          <rect x="11" y="11" width="26" height="26" rx="3" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <circle cx="24" cy="24" r="6.5" fill="none" stroke="currentColor" strokeWidth={FEEDER}/>
          <line x1="24" y1="24" x2="24" y2="18.5" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round"/>
          <path d="M 31 19 A 9 9 0 0 1 31 29" fill="none" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
          <polyline points="29.5,28 31,29.5 32.5,27.8" fill="none" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round" strokeLinejoin="round"/>
        </g>
      )},
      { id: "iso_cooker", name: "Cooker Control Unit (45A)", svg: (
        <g>
          <rect x="8" y="10" width="32" height="18" rx="2.5" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <text x="21" y="22" fontSize="8" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">45A</text>
          <circle cx="33" cy="15" r="2.2" fill="currentColor"/>
          <circle cx="15" cy="36" r="1.6" fill="currentColor"/>
          <line x1="15" y1="36" x2="29" y2="31" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round"/>
        </g>
      )},
      { id: "ev_charger", name: "EV Charge Point", svg: (
        <g>
          <rect x="13" y="8" width="22" height="28" rx="3.5" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <text x="24" y="20" fontSize="9" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">EV</text>
          <path d="M 26 23 L 21 31 L 24.5 31 L 22 38" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round"/>
        </g>
      )},
      { id: "fx_domed", name: "Domed Compact Fitting", svg: (
        <g>
          <circle cx="24" cy="24" r="7" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
          <circle cx="24" cy="24" r="2.4" fill="currentColor"/>
          {[0,45,90,135,180,225,270,315].map((a,i) => {
            const r1 = 9.5, r2 = 13, rad = (a * Math.PI) / 180;
            return <line key={i}
              x1={24 + r1*Math.cos(rad)} y1={24 + r1*Math.sin(rad)}
              x2={24 + r2*Math.cos(rad)} y2={24 + r2*Math.sin(rad)}
              stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>;
          })}
        </g>
      )},
      { id: "mk_csp", name: "CSP Location", svg: (
        <g>
          <path d="M 24 12 L 32 30 L 16 30 Z" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <circle cx="24" cy="25" r="2" fill="currentColor"/>
          <text x="24" y="41" fontSize="7.5" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700" letterSpacing="0.5">CSP</text>
        </g>
      )},
    ],
  },

  data: {
    label: "Data",
    items: [
      { id: "data_point", name: "Data Point (Cat5/6)", svg: (
        <g>
          <path d="M 14 28 A 10 10 0 0 1 34 28 Z" fill="none" stroke="currentColor" strokeWidth={STROKE}/>
        </g>
      )},
      { id: "data_internet", name: "Internet Connection Point", svg: (
        <g>
          <rect x="10" y="12" width="28" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <text x="24" y="23" fontSize="8" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">ICP</text>
        </g>
      )},
      { id: "data_ont", name: "Fibre Optic (ONT)", svg: (
        <g>
          <rect x="8" y="16" width="32" height="16" rx="1.5" fill="currentColor"/>
          <text x="24" y="27" fontSize="8.5" textAnchor="middle" fill="white"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700" letterSpacing="0.5">ONT</text>
        </g>
      )},
    ],
  },

  heating: {
    label: "Heating",
    items: [
      { id: "ht_towel", name: "Towel Rail", forceColor: "#dc2626", svg: (
        <g>
          <rect x="2" y="20" width="44" height="8" fill="currentColor"/>
          <rect x="20" y="20" width="8" height="8" fill="white"/>
        </g>
      )},
      { id: "ht_radiator", name: "Radiator", forceColor: "#2563eb", svg: (
        <g>
          <rect x="2" y="20" width="44" height="8" fill="currentColor"/>
          <rect x="20" y="20" width="8" height="8" fill="white"/>
        </g>
      )},
      { id: "ht_uf", name: "Underfloor Heating", svg: (
        <g>
          <rect x="4" y="10" width="40" height="28" fill="none" stroke="currentColor" strokeWidth={FEEDER} strokeDasharray="3 2"/>
          <text x="24" y="28" fontSize="8" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="600">UFH</text>
        </g>
      )},
      { id: "ht_wiring_centre", name: "Heating Wiring Centre", svg: (
        <g>
          <rect x="7" y="13" width="34" height="20" rx="2.5" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round"/>
          <text x="24" y="26" fontSize="8" textAnchor="middle" fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">HWC</text>
          {[12, 18, 24, 30, 36].map(cx => (
            <line key={cx} x1={cx} y1="33" x2={cx} y2="37" stroke="currentColor" strokeWidth={FEEDER} strokeLinecap="round"/>
          ))}
        </g>
      )},
    ],
  },
};

export const VIEWBOX = "0 0 48 48";

/* ----------------------------------------------------------------------------
 * SYMBOL_META — descriptions + mounting heights, phrased to match industry-
 * standard UK residential MEP legends.
 * ------------------------------------------------------------------------- */
export const SYMBOL_META = {
  // Sockets — low level
  sock_sso_ll:     { description: "Single Socket Low Level",                height: "450mm AFL" },
  sock_dso_ll:     { description: "Double Socket Low Level",                height: "450mm AFL" },
  sock_dso_usb_ll: { description: "Double Socket Low Level (USB-C)",        height: "450mm AFL" },

  // Sockets — high level
  sock_sso_hl:     { description: "Single Socket High Level",               height: "1100mm AFL" },
  sock_dso_hl:     { description: "Double Socket High Level",               height: "1100mm AFL" },
  sock_dso_usb_hl: { description: "Double Socket High Level (USB-C)",       height: "1100mm AFL" },

  // Sockets — specialist
  sock_2a:         { description: "2A Socket Outlet",                       height: "450mm AFL" },
  sock_cooker:     { description: "Cooker Outlet",                          height: "1100mm AFL" },
  sock_shaver:     { description: "Shaver Socket",                          height: "1200mm AFL" },
  sock_tv:         { description: "TV Point",                               height: "450mm AFL" },
  sock_fcu:        { description: "Switched Fused Spur",                      height: "Above worktop / per location" },

  // Switches
  sw_light:        { description: "Light Switch",                            height: "1200mm AFL" },
  sw_2g:           { description: "2 Gang Light Switch",                      height: "1200mm AFL" },
  sw_3g:           { description: "3 Gang Light Switch",                      height: "1200mm AFL" },
  sw_4g:           { description: "4 Gang Light Switch",                      height: "1200mm AFL" },
  sw_grid:         { description: "Grid Switch",                             height: "1200mm AFL" },
  sw_2way:         { description: "2-Way Light Switch",                      height: "1200mm AFL" },
  sw_intermediate: { description: "Intermediate Light Switch",               height: "1200mm AFL" },
  sw_dimmer:       { description: "Dimmer Switch",                           height: "1200mm AFL" },
  sw_pull:         { description: "Pull Cord Switch",                        height: "Ceiling (cord to 1000mm)" },
  sw_pir_light:    { description: "Passive Infrared Lighting Sensor",        height: "Ceiling" },
  sw_keycard:      { description: "Keycard Switch",                          height: "1200mm AFL" },

  // Lighting
  lt_pendant:        { description: "Pendant Light",                                 height: "Ceiling" },
  lt_downlight:      { description: "Ceiling mounted downlight",                     height: "Ceiling" },
  lt_downlight_ip:   { description: "Ceiling or under cabinet mounted downlight IP Rated", height: "Ceiling / under cabinet" },
  lt_batten:         { description: "Light fitting — Batten Holder (Ceiling / Wall)", height: "Ceiling / wall" },
  lt_wall:           { description: "Wall Light",                                    height: "1800mm AFL" },
  lt_strip:          { description: "LED Strip Lighting",                            height: "Per location" },
  lt_emergency:      { description: "Emergency Lighting",                            height: "Ceiling" },
  lt_external:       { description: "External Light",                                height: "1800mm AFL" },
  lt_external_updown:{ description: "External Up and Down Light (dusk till dawn)",   height: "1800mm AFL" },

  // Detectors
  det_smoke:       { description: "Smoke Detector (Grade D2, Cat LD3)",     height: "Ceiling" },
  det_heat:        { description: "Heat Detector",                          height: "Ceiling" },
  det_co:          { description: "Carbon Monoxide Detector",               height: "Per manufacturer" },
  det_combined:    { description: "Smoke / Heat / CO Combined",             height: "Ceiling" },
  det_thermostat:  { description: "Thermostat",                             height: "1500mm AFL" },

  // Security
  sec_pir:         { description: "Passive Infrared Detector",              height: "2100mm AFL" },
  sec_keypad:      { description: "Security Alarm Keypad",                  height: "1500mm AFL" },
  sec_hub:         { description: "Security Alarm Hub Unit",                height: "Per location" },
  sec_door:        { description: "Door Sensor",                            height: "Door frame" },
  sec_cctv:        { description: "CCTV Camera",                            height: "2400mm AFL" },

  // Fixtures
  fx_extractor:      { description: "Ceiling Mounted Extract",                                          height: "Ceiling" },
  fx_extractor_wall: { description: "Sound attenuated wall mounted extractor (Part F & SAP Part O)",    height: "High wall" },
  fx_ext_tap:        { description: "External Tap (electrically isolated)",                              height: "Per location" },
  fx_doorbell:       { description: "Door Bell Push",                                                    height: "1200mm AFL" },
  fx_motor:          { description: "Motor / Plant Connection",                                          height: "Per location" },
  fx_consumer:       { description: "Consumer Unit — switches to between",                               height: "1350–1450mm AFL" },
  fx_meter:          { description: "Electrical Meter Box (refer to site plans for plot locations)",     height: "Per site plan" },
  fx_isolator:       { description: "Isolator Switch",                                                   height: "1500mm AFL" },
  fx_domed:          { description: "Domed compact fitting (chrome collar)",                             height: "Ceiling" },
  mk_csp:            { description: "CSP location — as set out on the site plan",                         height: "Per site plan" },

  // Data
  data_point:    { description: "Data Point (Cat5e / Cat6)",                 height: "450mm AFL" },
  data_internet: { description: "Internet Connection Point",                 height: "450mm AFL" },
  data_ont:      { description: "Fibre Optic (ONT)",                         height: "Per location" },

  // Heating
  ht_towel:      { description: "Heated Towel Rail (electric)",              height: "Per location" },
  ht_radiator:   { description: "Radiator",                                  height: "Per location" },
  ht_uf:         { description: "Underfloor Heating Zone",                   height: "Floor" },
  ht_wiring_centre:{ description: "Heating Wiring Centre",                  height: "Per location" },

  // Added — isolators, spurs & services
  spur_unsw:       { description: "Unswitched Fused Spur",                  height: "Above worktop / per location" },
  lt_2d:           { description: "2D Surface Fitting",                     height: "Ceiling" },
  iso_dp:          { description: "1 Gang Double Pole Isolator",            height: "1500mm AFL" },
  iso_rotary:      { description: "Rotary Isolator (IP65)",                 height: "Per location" },
  iso_cooker:      { description: "Cooker Control Unit (45A DP)",           height: "1100\u20131450mm AFL" },
  ev_charger:      { description: "EV Charge Point",                        height: "Per manufacturer" },
  sec_bell:        { description: "External Alarm Sounder (Bell Box)",      height: "High level (eaves)" },
};

/* ============================================================================
 * Helpers
 * ========================================================================= */

// Map legacy symbol IDs to their current equivalents so old saved projects
// don't break when the library evolves.
const ID_ALIASES = {
  sock_sso:         "sock_sso_ll",
  sock_dso:         "sock_dso_ll",
  sock_usbc:        "sock_dso_usb_ll",
  sock_sso_2a:      "sock_2a",
  sock_cat5:        "data_point",
  sw_pir:           "sw_pir_light",
  lt_ceiling:       "lt_batten",
  det_alarm_panel:  "sec_hub",
  det_pir_intruder: "sec_pir",
  fx_camera:        "sec_cctv",
};

function resolveId(id) {
  return ID_ALIASES[id] || id;
}

export function findSymbol(id) {
  id = resolveId(id);
  for (const cat of Object.values(SYMBOLS)) {
    const s = cat.items.find(i => i.id === id);
    if (s) return s;
  }
  return null;
}

export function findCategory(id) {
  id = resolveId(id);
  for (const [key, cat] of Object.entries(SYMBOLS)) {
    if (cat.items.find(i => i.id === id)) return key;
  }
  return null;
}

export function resolveColours(symbolId, mode) {
  symbolId = resolveId(symbolId);
  const sym = findSymbol(symbolId);
  if (!sym) return { body: "#e7e5e4", feeder: "#a8a29e" };
  if (sym.forceColor) return { body: sym.forceColor, feeder: "#9a3412" };
  if (mode === "mono") return { body: "#0a0a0a", feeder: "#737373" };
  if (mode === "red")  return { body: "#cc1418", feeder: "#e88a8a" };
  const cat = findCategory(symbolId);
  const palette = CATEGORY_COLOURS[cat] || CATEGORY_COLOURS.fixtures;
  return { body: palette.primary, feeder: palette.soft };
}

/* ============================================================================
 * PALETTE_GROUPS — user-facing subcategories. The palette renders these as
 * labelled sections; search flattens across all of them.
 * ========================================================================= */
export const PALETTE_GROUPS = [
  { label: "Sockets & Data",        ids: ["sock_sso_ll", "sock_dso_ll", "sock_dso_usb_ll", "sock_tv", "data_point"] },
  { label: "Switches",              ids: ["sw_light", "sw_2g", "sw_3g", "sw_4g", "sw_grid"] },
  { label: "Lighting",              ids: ["lt_downlight", "lt_pendant", "lt_2d", "lt_wall", "lt_strip", "lt_external"] },
  { label: "Isolators & Spurs",     ids: ["iso_dp", "sock_fcu", "spur_unsw", "iso_rotary", "iso_cooker"] },
  { label: "Detection & Security",  ids: ["det_smoke", "det_co", "det_heat", "sec_pir", "sec_bell", "sec_cctv"] },
  { label: "Appliances & Services", ids: ["sock_cooker", "sock_shaver", "fx_extractor", "fx_extractor_wall", "ev_charger", "fx_consumer", "ht_wiring_centre"] },
];

// Grouped palette: [{ label, items: [{ sym, meta, category }] }]
export function getPaletteGroups() {
  return PALETTE_GROUPS
    .map(g => ({
      label: g.label,
      items: g.ids
        .map(id => {
          const sym = findSymbol(id);
          if (!sym) return null;
          return { sym, meta: SYMBOL_META[id] || {}, category: findCategory(id) };
        })
        .filter(Boolean),
    }))
    .filter(g => g.items.length);
}

// Flat list (used for search). Mirrors the grouped set.
export function getPaletteSymbols() {
  return getPaletteGroups().flatMap(g => g.items);
}
