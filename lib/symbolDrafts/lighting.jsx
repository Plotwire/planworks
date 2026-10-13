/* ============================================================================
 * Newer symbols: Lighting, Emergency lighting, External lighting.
 * Drawn in-house with lib/symbolKit.jsx to UK layout-drawing conventions:
 * the emergency mark is a luminaire with its left half filled (BS 5266 style
 * layouts), exit signs carry the running-man pictogram and a direction arrow.
 * Approved as drawn on 13 Oct 2026 (see lib/symbolDrafts/index.js).
 * ========================================================================= */

"use client";

import React from "react";
import {
  STROKE, FEEDER, Txt, Ring, Dot, Box, Line, Path, Poly,
  HalfDisc, KeyMark, Arrow, Rays, LinearBody, BulkheadBody, RunningMan,
} from "../symbolKit";

const LT = "lighting", EM = "emergency", EX = "external";
const LUM = "Luminaires", EML = "Emergency luminaires & signs", EXL = "External luminaires";

// Emergency luminaire: ring with the left half filled, letters in the right half.
const EmLum = ({ label }) => (
  <g><Ring r={11}/><HalfDisc r={11}/><Txt x={30.3} y={label.length > 1 ? 26.2 : 27} s={label.length > 1 ? 5.8 : 8}>{label}</Txt></g>
);

// Small emergency badge (half-filled ring) for converted fittings.
const EmBadge = ({ cx = 39, cy = 9, r = 5 }) => (
  <g><Ring cx={cx} cy={cy} r={r} w={FEEDER}/><HalfDisc cx={cx} cy={cy} r={r}/></g>
);

// Exit sign: sign box, running man and a direction arrow.
const ExitSign = ({ dir }) => {
  const manX = dir === "left" ? 28 : 7;
  const arrow = {
    left: { x1: 23, y1: 24, x2: 6, y2: 24 },
    right: { x1: 24, y1: 24, x2: 42, y2: 24 },
    down: { x1: 34, y1: 15, x2: 34, y2: 33 },
    up: { x1: 34, y1: 33, x2: 34, y2: 15 },
  }[dir];
  return (
    <g>
      <Box x={2} y={11} w={44} h={26} r={1.5}/>
      <RunningMan x={manX} y={33}/>
      <Arrow {...arrow} h={4.5} w={STROKE}/>
    </g>
  );
};

// Wall line (the feeder-coloured wall the fitting is fixed to).
const Wall = ({ y = 42 }) => <Line x1={4} y1={y} x2={44} y2={y} feeder/>;

// Lantern body with roof and finial, centred on x = 24.
const Lantern = ({ top = 6 }) => (
  <g>
    <Poly pts={`17,${top + 7} 24,${top + 1} 31,${top + 7}`} closed/>
    <Poly pts={`18,${top + 7} 30,${top + 7} 28.5,${top + 23} 19.5,${top + 23}`} closed/>
    <Dot cx={24} cy={top + 15} r={2.4}/>
  </g>
);

export const LIGHTING_SYMBOLS = [
  /* ---- Lighting ----------------------------------------------------------- */
  { id: "lg_panel_600", name: "LED Panel 600 x 600", code: "LP6", category: LT, materials: LUM, height: "Ceiling (grid)",
    description: "Recessed LED Panel 600 x 600", svg: (
      <g><Box x={8} y={8} w={32} h={32} r={1}/><Box x={12} y={12} w={24} h={24} r={0.5} sw={FEEDER}/></g>
    )},
  { id: "lg_panel_1200", name: "LED Panel 1200 x 300", code: "LP12", category: LT, materials: LUM, height: "Ceiling (grid)",
    description: "Recessed LED Panel 1200 x 300", svg: (
      <g><Box x={2} y={17} w={44} h={14} r={1}/><Box x={5} y={20} w={38} h={8} r={0.5} sw={FEEDER}/></g>
    )},
  { id: "lg_linear", name: "Linear Luminaire (surface)", code: "LIN", category: LT, materials: LUM, height: "Ceiling",
    description: "Surface Linear LED Luminaire", svg: <LinearBody/> },
  { id: "lg_linear_recessed", name: "Linear Luminaire (recessed)", code: "LIN-R", category: LT, materials: LUM, height: "Ceiling",
    description: "Recessed Linear LED Luminaire", svg: (
      <g><Box x={2} y={16} w={44} h={16} r={1} sw={FEEDER} dash="2 1.5"/><LinearBody x={5} y={20} w={38} h={8}/></g>
    )},
  { id: "lg_linear_susp", name: "Linear Luminaire (suspended)", code: "LIN-S", category: LT, materials: LUM, height: "Suspended",
    description: "Suspended Linear LED Luminaire", svg: (
      <g>
        <LinearBody x={4} y={22} w={40} h={8}/>
        <Line x1={11} y1={22} x2={11} y2={10}/><Line x1={37} y1={22} x2={37} y2={10}/>
        <Dot cx={11} cy={9} r={1.6}/><Dot cx={37} cy={9} r={1.6}/>
      </g>
    )},
  { id: "lg_twin_batten", name: "Twin LED Batten", code: "LIN-2", category: LT, materials: LUM, height: "Ceiling",
    description: "Twin LED Batten", svg: (
      <g>
        <Box x={4} y={16} w={40} h={16} r={1}/>
        <Line x1={8} y1={21} x2={40} y2={21} w={STROKE}/><Line x1={8} y1={27} x2={40} y2={27} w={STROKE}/>
        <Line x1={8} y1={16} x2={8} y2={32}/><Line x1={40} y1={16} x2={40} y2={32}/>
      </g>
    )},
  { id: "lg_ip65_batten", name: "IP65 Anti-Corrosion Batten", code: "LIN-IP", category: LT, materials: LUM, height: "Ceiling",
    description: "IP65 Anti-Corrosion LED Batten", svg: (
      <g><LinearBody x={4} y={14} w={40} h={10}/><Txt y={38} s={7}>IP65</Txt></g>
    )},
  { id: "lg_highbay", name: "High Bay", code: "HB", category: LT, materials: LUM, height: "High level",
    description: "LED High Bay Luminaire", svg: (
      <g><Ring r={13}/><Ring r={8} w={FEEDER}/><Txt y={27} s={8}>HB</Txt></g>
    )},
  { id: "lg_spot", name: "Adjustable Spotlight", code: "SP", category: LT, materials: LUM, height: "Ceiling / wall",
    description: "Adjustable Spotlight", svg: (
      <g><Ring cx={15} cy={24} r={8}/><Dot cx={15} cy={24} r={2.6}/><Line x1={22} y1={20} x2={43} y2={11}/><Line x1={22} y1={28} x2={43} y2={37}/></g>
    )},
  { id: "lg_track", name: "Track with Spotlights", code: "TRK", category: LT, materials: LUM, height: "Ceiling",
    description: "Lighting Track with Spotlights", svg: (
      <g>
        <Line x1={4} y1={13} x2={44} y2={13} w={STROKE}/>
        {[12, 24, 36].map((x) => <g key={x}><Line x1={x} y1={13} x2={x} y2={20}/><Ring cx={x} cy={25} r={4.5}/><Dot cx={x} cy={25} r={1.4}/></g>)}
      </g>
    )},
  { id: "lg_gimbal", name: "Adjustable Downlight (gimbal)", code: "DL-A", category: LT, materials: LUM, height: "Ceiling",
    description: "Adjustable (gimbal) Downlight", svg: (
      <g><Ring r={8}/><Dot cx={26.5} cy={21.5} r={3}/><Arrow x1={30} y1={18} x2={40} y2={8} h={3.5}/></g>
    )},
  { id: "lg_downlight_fr", name: "Fire-Rated Downlight", code: "DL-F", category: LT, materials: LUM, height: "Ceiling",
    description: "Fire-Rated Downlight (30/60/90 min)", svg: (
      <g><Ring r={7.5}/><Dot r={3}/><Ring r={11} w={FEEDER}/><Txt x={40} y={13} s={7}>F</Txt></g>
    )},
  { id: "lg_wallwasher", name: "Wall Washer", code: "WW", category: LT, materials: LUM, height: "Ceiling, by wall",
    description: "Recessed Wall Washer", svg: (
      <g>
        <Line x1={4} y1={7} x2={44} y2={7} feeder/>
        <Path d="M 14 30 A 10 10 0 0 1 34 30 Z"/>
        <Arrow x1={18} y1={19} x2={14} y2={10} h={3}/><Arrow x1={24} y1={18} x2={24} y2={10} h={3}/><Arrow x1={30} y1={19} x2={34} y2={10} h={3}/>
      </g>
    )},
  { id: "lg_wall_up", name: "Wall Uplighter", code: "WU", category: LT, materials: LUM, height: "1800mm AFL",
    description: "Wall-mounted Uplighter", svg: (
      <g>
        <Wall/>
        <Path d="M 14 34 A 10 10 0 0 0 34 34 Z"/>
        <Arrow x1={18} y1={30} x2={14} y2={14} h={3}/><Arrow x1={24} y1={30} x2={24} y2={12} h={3}/><Arrow x1={30} y1={30} x2={34} y2={14} h={3}/>
      </g>
    )},
  { id: "lg_pendant_feature", name: "Feature Pendant", code: "PD-F", category: LT, materials: LUM, height: "Suspended",
    description: "Decorative / Feature Pendant", svg: (
      <g>
        <Line x1={24} y1={4} x2={24} y2={44}/><Line x1={4} y1={24} x2={44} y2={24}/>
        <Ring r={11}/><Ring r={5} w={FEEDER}/><Dot r={2}/>
      </g>
    )},
  { id: "lg_chandelier", name: "Chandelier / Cluster Pendant", code: "CHN", category: LT, materials: LUM, height: "Suspended",
    description: "Chandelier / Cluster Pendant", svg: (
      <g>
        <Dot r={3.2}/>
        {[0, 60, 120, 180, 240, 300].map((deg) => {
          const t = (deg * Math.PI) / 180, f = (n) => Math.round(n * 100) / 100;
          return <g key={deg}><Line x1={24} y1={24} x2={f(24 + 10.5 * Math.cos(t))} y2={f(24 + 10.5 * Math.sin(t))}/><Ring cx={f(24 + 14 * Math.cos(t))} cy={f(24 + 14 * Math.sin(t))} r={3.2} w={FEEDER + 0.2}/></g>;
        })}
      </g>
    )},
  { id: "lg_undercab", name: "Under-Cabinet Light", code: "UC", category: LT, materials: LUM, height: "Under wall units",
    description: "Under-Cabinet LED Light", svg: (
      <g><Box x={4} y={15} w={40} h={9} r={1}/>{[12, 24, 36].map((x) => <Dot key={x} cx={x} cy={19.5} r={1.8}/>)}<Rays cx={24} cy={24} r1={4} r2={9} angles={[60, 90, 120]}/><Txt y={44} s={6.5}>UC</Txt></g>
    )},
  { id: "lg_plinth", name: "Plinth Light", code: "PLN", category: LT, materials: LUM, height: "Kitchen plinth",
    description: "Plinth / Kick-board Light", svg: (
      <g><Line x1={4} y1={30} x2={44} y2={30} w={STROKE}/>{[14, 24, 34].map((x) => <g key={x}><Ring cx={x} cy={24} r={3.2} w={FEEDER + 0.3}/><Dot cx={x} cy={24} r={1}/></g>)}<Txt y={41} s={6.5}>PL</Txt></g>
    )},
  { id: "lg_mirror", name: "Mirror Light", code: "ML", category: LT, materials: LUM, height: "Above basin",
    description: "Illuminated Mirror / Mirror Light", svg: (
      <g><Box x={10} y={12} w={28} h={28} r={2}/><Line x1={13} y1={8} x2={35} y2={8} w={STROKE + 0.5}/><Rays cx={24} cy={8} r1={3} r2={6.5} angles={[60, 90, 120]}/><Txt y={31} s={8}>M</Txt></g>
    )},
  { id: "lg_cove", name: "Cove Lighting (LED in profile)", code: "CV", category: LT, materials: LUM, height: "Ceiling coffer / cove",
    description: "Cove Lighting, LED tape in aluminium profile", svg: (
      <g><Box x={2} y={20} w={44} h={8} r={1} dash="3 2"/>{[8, 14, 20, 26, 32, 38].map((x) => <Dot key={x} cx={x} cy={24} r={1.1}/>)}<Arrow x1={24} y1={18} x2={24} y2={9} h={3}/></g>
    )},
  { id: "lg_step", name: "Stair / Step Light (internal)", code: "STL", category: LT, materials: LUM, height: "Stair string / low level",
    description: "Internal Stair / Step Light", svg: (
      <g><Box x={13} y={15} w={22} h={18} r={1.5}/>{[20, 24.5, 29].map((y) => <Line key={y} x1={16} y1={y} x2={32} y2={y - 1.5}/>)}</g>
    )},
  { id: "lg_bulkhead", name: "Bulkhead (internal)", code: "BHI", category: LT, materials: LUM, height: "Ceiling / wall",
    description: "Internal Bulkhead Light", svg: <BulkheadBody/> },
  { id: "lg_oyster", name: "Surface Ceiling Fitting (flush)", code: "SCF", category: LT, materials: LUM, height: "Ceiling",
    description: "Flush / Surface Ceiling Fitting", svg: (
      <g><Ring r={11}/><Ring r={5.5} w={FEEDER}/></g>
    )},
  { id: "lg_driver", name: "LED Driver / Transformer", code: "DRV", category: LT, materials: LUM, height: "Ceiling void",
    description: "Remote LED Driver / Transformer", svg: (
      <g><Box x={9} y={14} w={30} h={20} r={1.5}/><Txt y={28} s={8}>DRV</Txt></g>
    )},
  { id: "lg_picture", name: "Picture Light", code: "PIC", category: LT, materials: LUM, height: "Above picture",
    description: "Picture Light", svg: (
      <g><Box x={9} y={22} w={30} h={18} r={0} sw={FEEDER}/><Line x1={14} y1={13} x2={34} y2={13} w={STROKE + 0.5}/><Rays cx={24} cy={13} r1={3} r2={7} angles={[60, 90, 120]}/></g>
    )},

  /* ---- Emergency lighting ------------------------------------------------ */
  { id: "em_nm", name: "Emergency Luminaire, Non-Maintained", code: "EL-NM", category: EM, materials: EML, height: "Ceiling",
    description: "Emergency Luminaire, self-contained, non-maintained 3hr", svg: <EmLum label="NM"/> },
  { id: "em_m", name: "Emergency Luminaire, Maintained", code: "EL-M", category: EM, materials: EML, height: "Ceiling",
    description: "Emergency Luminaire, self-contained, maintained 3hr", svg: <EmLum label="M"/> },
  { id: "em_selftest", name: "Emergency Luminaire, Self-Test", code: "EL-ST", category: EM, materials: EML, height: "Ceiling",
    description: "Emergency Luminaire, self-test, 3hr", svg: <EmLum label="ST"/> },
  { id: "em_addressable", name: "Emergency Luminaire, Addressable", code: "EL-A", category: EM, materials: EML, height: "Ceiling",
    description: "Emergency Luminaire, addressable / monitored", svg: <EmLum label="A"/> },
  { id: "em_central", name: "Emergency Luminaire, Central Battery", code: "EL-CB", category: EM, materials: EML, height: "Ceiling",
    description: "Emergency Luminaire on central battery system", svg: <EmLum label="CB"/> },
  { id: "em_downlight", name: "Emergency Downlight", code: "EL-DL", category: EM, materials: EML, height: "Ceiling",
    description: "Recessed Emergency Downlight, non-maintained", svg: (
      <g><Ring r={8}/><Dot r={3.2}/><EmBadge/></g>
    )},
  { id: "em_twin_spot", name: "Emergency Twin Spot", code: "EL-TS", category: EM, materials: EML, height: "High level",
    description: "Emergency Twin Spot (open areas / high risk)", svg: (
      <g>
        <Box x={13} y={22} w={22} h={14} r={1.5}/><Box x={13} y={22} w={11} h={14} r={1.5} solid/>
        <Line x1={16} y1={22} x2={12} y2={16}/><Line x1={32} y1={22} x2={36} y2={16}/>
        <Ring cx={10} cy={12} r={4.5}/><Ring cx={38} cy={12} r={4.5}/>
      </g>
    )},
  { id: "em_bulkhead", name: "Emergency Bulkhead", code: "EL-BH", category: EM, materials: EML, height: "Ceiling / wall",
    description: "Emergency Bulkhead, IP65, non-maintained 3hr", svg: (
      <g><BulkheadBody/><Path d="M 24 15 L 17 15 A 9 9 0 0 0 17 33 L 24 33 Z" solid/></g>
    )},
  { id: "em_linear", name: "Linear Luminaire with Emergency", code: "EL-LIN", category: EM, materials: EML, height: "Ceiling",
    description: "Linear Luminaire with emergency conversion", svg: (
      <g><LinearBody/><Box x={4} y={20} w={8} h={8} r={1} solid/></g>
    )},
  { id: "em_panel", name: "LED Panel with Emergency", code: "EL-PNL", category: EM, materials: EML, height: "Ceiling (grid)",
    description: "LED Panel with emergency conversion", svg: (
      <g><Box x={5} y={11} w={30} h={30} r={1}/><Box x={9} y={15} w={22} h={22} r={0.5} sw={FEEDER}/><EmBadge cx={39} cy={9}/></g>
    )},
  { id: "em_exit_l", name: "Exit Sign, Arrow Left", code: "EX-L", category: EM, materials: EML, height: "Above door / 2100mm AFL",
    description: "Emergency Exit Sign, running man, arrow left", svg: <ExitSign dir="left"/> },
  { id: "em_exit_r", name: "Exit Sign, Arrow Right", code: "EX-R", category: EM, materials: EML, height: "Above door / 2100mm AFL",
    description: "Emergency Exit Sign, running man, arrow right", svg: <ExitSign dir="right"/> },
  { id: "em_exit_d", name: "Exit Sign, Arrow Down", code: "EX-D", category: EM, materials: EML, height: "Above door / 2100mm AFL",
    description: "Emergency Exit Sign, running man, arrow down (straight on)", svg: <ExitSign dir="down"/> },
  { id: "em_exit_u", name: "Exit Sign, Arrow Up", code: "EX-U", category: EM, materials: EML, height: "Above door / 2100mm AFL",
    description: "Emergency Exit Sign, running man, arrow up (onward)", svg: <ExitSign dir="up"/> },
  { id: "em_exit_ds", name: "Exit Sign, Suspended Double-Sided", code: "EX-DS", category: EM, materials: EML, height: "Suspended",
    description: "Emergency Exit Sign, suspended, double-sided", svg: (
      <g>
        <Line x1={10} y1={4} x2={10} y2={13}/><Line x1={38} y1={4} x2={38} y2={13}/>
        <Box x={2} y={13} w={44} h={24} r={1.5}/>
        <RunningMan x={18} y={34}/>
        <Arrow x1={14} y1={25} x2={5} y2={25} h={3.5} w={STROKE}/><Arrow x1={34} y1={25} x2={43} y2={25} h={3.5} w={STROKE}/>
      </g>
    )},
  { id: "em_cbs", name: "Central Battery Cabinet", code: "CBS", category: EM, materials: EML, height: "Plant room",
    description: "Emergency Lighting Central Battery System", svg: (
      <g>
        <Box x={6} y={8} w={36} h={32} r={1.5}/>
        <Txt y={22} s={9}>CBS</Txt>
        <Box x={16} y={27} w={14} h={7} r={0.5} sw={FEEDER}/><Box x={30} y={29} w={2} h={3} r={0} solid/>
      </g>
    )},
  { id: "em_test_key", name: "Emergency Lighting Test Key Switch", code: "EL-TK", category: EM, materials: EML, height: "1200mm AFL",
    description: "Emergency Lighting Test Key Switch", svg: (
      <g><Box x={10} y={9} w={28} h={22} r={2.5}/><KeyMark x={15} y={20} s={1.3}/><Txt y={41} s={6.5}>EM TEST</Txt></g>
    )},
  { id: "em_external", name: "External Emergency Luminaire", code: "EL-EXT", category: EM, materials: EML, height: "Above final exit",
    description: "External Emergency Luminaire, IP65, final exit", svg: (
      <g><Box x={10} y={8} w={28} h={24} r={2}/><Box x={10} y={8} w={14} h={24} r={2} solid/><Txt y={42} s={6.5}>EXT</Txt></g>
    )},

  /* ---- External lighting -------------------------------------------------- */
  { id: "ex_bulkhead", name: "Bulkhead (IP65)", code: "BH", category: EX, materials: EXL, height: "Wall / soffit",
    description: "External Bulkhead, IP65", svg: (
      <g><BulkheadBody y={10}/><Txt y={42} s={6.5}>IP65</Txt></g>
    )},
  { id: "ex_bulkhead_pir", name: "Bulkhead with PIR", code: "BH-PIR", category: EX, materials: EXL, height: "Wall / soffit",
    description: "External Bulkhead with PIR sensor", svg: (
      <g><BulkheadBody y={10}/><Txt y={42} s={6.5}>PIR</Txt></g>
    )},
  { id: "ex_bulkhead_pc", name: "Bulkhead with Photocell", code: "BH-PC", category: EX, materials: EXL, height: "Wall / soffit",
    description: "External Bulkhead with photocell (dusk to dawn)", svg: (
      <g><BulkheadBody y={10}/><Txt y={42} s={6.5}>PC</Txt></g>
    )},
  { id: "ex_lantern", name: "Wall Lantern", code: "LAN", category: EX, materials: EXL, height: "1800mm AFL",
    description: "External Wall Lantern", svg: (
      <g><Lantern top={8}/><Line x1={24} y1={31} x2={24} y2={42}/><Wall/></g>
    )},
  { id: "ex_lantern_post", name: "Post Lantern", code: "LAN-P", category: EX, materials: EXL, height: "Post top",
    description: "External Post Lantern", svg: (
      <g><Lantern top={2}/><Line x1={24} y1={25} x2={24} y2={42} w={STROKE}/><Line x1={18} y1={43} x2={30} y2={43} w={STROKE}/></g>
    )},
  { id: "ex_bollard", name: "Bollard", code: "BOL", category: EX, materials: EXL, height: "Ground mounted",
    description: "External Bollard Light", svg: (
      <g><Ring r={9}/><Dot r={3.5}/><Rays r1={11.5} r2={15.5} angles={[45, 135, 225, 315]}/></g>
    )},
  { id: "ex_column", name: "Column Light", code: "COL", category: EX, materials: EXL, height: "Column, 4–6m",
    description: "Street / Car Park Column Light", svg: (
      <g><Dot cx={12} cy={36} r={3.5}/><Line x1={12} y1={36} x2={30} y2={18} w={STROKE}/><Box x={28} y={10} w={14} h={8} r={1.5}/><Rays cx={35} cy={18} r1={2} r2={7} angles={[60, 90, 120]}/></g>
    )},
  { id: "ex_column_twin", name: "Twin-Head Column Light", code: "COL-2", category: EX, materials: EXL, height: "Column, 4–6m",
    description: "Twin-Head Column Light", svg: (
      <g><Dot cx={24} cy={34} r={3.5}/><Line x1={24} y1={34} x2={24} y2={18} w={STROKE}/><Line x1={9} y1={18} x2={39} y2={18} w={STROKE}/><Box x={2} y={10} w={12} h={8} r={1.5}/><Box x={34} y={10} w={12} h={8} r={1.5}/></g>
    )},
  { id: "ex_flood", name: "Floodlight", code: "FL", category: EX, materials: EXL, height: "High level",
    description: "LED Floodlight", svg: (
      <g><Box x={5} y={15} w={11} h={18} r={1.5}/><Box x={5} y={15} w={4} h={18} r={1} solid/><Line x1={16} y1={17} x2={43} y2={7}/><Line x1={16} y1={31} x2={43} y2={41}/><Path d="M 38 9 A 18 18 0 0 1 38 39" w={FEEDER} dash="2 1.5"/></g>
    )},
  { id: "ex_flood_pir", name: "Floodlight with PIR", code: "FL-PIR", category: EX, materials: EXL, height: "High level",
    description: "LED Floodlight with PIR sensor", svg: (
      <g><Box x={5} y={12} w={11} h={18} r={1.5}/><Box x={5} y={12} w={4} h={18} r={1} solid/><Line x1={16} y1={14} x2={43} y2={5}/><Line x1={16} y1={28} x2={43} y2={37}/><Poly pts="6,34 15,38 6,42" closed/></g>
    )},
  { id: "ex_inground", name: "In-Ground Uplighter", code: "IGU", category: EX, materials: EXL, height: "Ground (walk-over)",
    description: "In-ground / Walk-over Uplighter", svg: (
      <g><Box x={10} y={10} w={28} h={28} r={1}/><Ring r={8}/><Dot r={2.6}/></g>
    )},
  { id: "ex_step", name: "Step / Brick Light (external)", code: "STP", category: EX, materials: EXL, height: "Low level",
    description: "External Step / Brick Light", svg: (
      <g><Box x={12} y={16} w={24} h={16} r={1}/>{[20.5, 24, 27.5].map((y) => <Line key={y} x1={15} y1={y} x2={33} y2={y} w={FEEDER}/>)}<Line x1={4} y1={38} x2={44} y2={38} feeder/></g>
    )},
  { id: "ex_spike", name: "Garden Spike Light", code: "SPK", category: EX, materials: EXL, height: "Ground",
    description: "Garden Spike Light", svg: (
      <g><Ring cx={24} cy={13} r={7}/><Dot cx={24} cy={13} r={2.2}/><Poly pts="20,21 28,21 24,42" closed/></g>
    )},
  { id: "ex_festoon", name: "Festoon Lighting", code: "FST", category: EX, materials: EXL, height: "Catenary",
    description: "Festoon Lighting on catenary", svg: (
      <g><Path d="M 4 10 Q 24 26 44 10" w={STROKE}/>{[[12, 15.5], [24, 18], [36, 15.5]].map(([x, y]) => <g key={x}><Line x1={x} y1={y} x2={x} y2={y + 5}/><Ring cx={x} cy={y + 9} r={4} w={FEEDER + 0.3}/></g>)}</g>
    )},
  { id: "ex_wall_down", name: "External Wall Downlight", code: "WDL", category: EX, materials: EXL, height: "Wall, 1800–2400mm",
    description: "External Wall Downlight (cylinder)", svg: (
      <g><Line x1={6} y1={6} x2={6} y2={42} feeder/><Line x1={6} y1={14} x2={16} y2={14}/><Box x={16} y={8} w={12} h={18} r={1.5}/><Rays cx={22} cy={26} r1={3} r2={14} angles={[65, 90, 115]}/></g>
    )},
  { id: "ex_pond", name: "Pond / Underwater Light", code: "PND", category: EX, materials: EXL, height: "Submerged",
    description: "Pond / Underwater Light (IP68)", svg: (
      <g><Ring cx={24} cy={19} r={9}/><Dot cx={24} cy={19} r={3}/><Path d="M 6 36 C 10 32 14 32 18 36 C 22 40 26 40 30 36 C 34 32 38 32 42 36" w={FEEDER + 0.3}/></g>
    )},
  { id: "ex_led_strip", name: "External LED Strip (IP67)", code: "LED-X", category: EX, materials: EXL, height: "Per location",
    description: "External LED Strip, IP67", svg: (
      <g><Box x={6} y={16} w={36} h={8} r={2}/>{[12, 18, 24, 30, 36].map((x) => <Dot key={x} cx={x} cy={20} r={1.2}/>)}<Txt y={37} s={7}>IP67</Txt></g>
    )},
  { id: "ex_sign", name: "Sign Light", code: "SGN", category: EX, materials: EXL, height: "Above sign",
    description: "Sign / Fascia Light", svg: (
      <g><Box x={5} y={20} w={38} h={18} r={1}/><Line x1={14} y1={11} x2={34} y2={11} w={STROKE + 0.5}/><Rays cx={24} cy={11} r1={3} r2={7} angles={[55, 90, 125]}/></g>
    )},
];
