/* ============================================================================
 * Draft symbols: Sockets & power, Distribution, EV & renewables.
 * Drawn in-house with lib/symbolKit.jsx to UK layout-drawing conventions.
 * Drafts are hidden from users until approved (see lib/symbolDrafts/index.js).
 * ========================================================================= */

"use client";

import React from "react";
import {
  STROKE, FEEDER, Txt, Ring, Dot, Box, Line, Path, Poly,
  SocketHalf, Stem, Lever, KeyMark, Arrow, Flash, EarthMark, Fan,
} from "../symbolKit";

const POWER = "power", DIST = "distribution", EV = "ev";
const WA = "Wiring accessories", CIP = "Commercial & industrial power";

// Two sockets side by side, as the original double socket draws them.
const DoubleHalves = ({ r = 10, base = 28, stems = true }) => (
  <g>
    <SocketHalf cx={24 - r} base={base} r={r}/>
    <SocketHalf cx={24 + r} base={base} r={r}/>
    {stems && <Stem x={24 - r} y1={base - r * 0.8} y2={base - r * 1.6}/>}
    {stems && <Stem x={24 + r} y1={base - r * 0.8} y2={base - r * 1.6}/>}
  </g>
);

// The fused connection unit plate with its lettering (as sock_fcu draws it).
const FcuPlate = ({ label = "FCU" }) => (
  <g>
    <Box x={14} y={8} w={20} h={14}/>
    <Txt y={18} s={8} w={600}>{label}</Txt>
  </g>
);

// Square switch plate with a lever and lettering (as iso_dp draws it).
const DpPlate = ({ label, neon = false }) => (
  <g>
    <Box x={11} y={11} w={26} h={26} r={3}/>
    <Txt y={22} s={label.length > 2 ? 7.5 : 8.5}>{label}</Txt>
    <Lever x={16} y={31} x2={30} y2={26} r={1.6}/>
    {neon && <Ring cx={33} cy={31} r={2} w={FEEDER}/>}
    {neon && <Dot cx={33} cy={31} r={0.8}/>}
  </g>
);

// BS EN 60309 industrial socket face: a ring with its pin dots.
const IndustrialFace = ({ pins = 3 }) => {
  const pts = Array.from({ length: pins }, (_, i) => {
    const t = (-90 + (360 / pins) * i) * Math.PI / 180;
    return [24 + 5.5 * Math.cos(t), 21 + 5.5 * Math.sin(t)].map((n) => Math.round(n * 100) / 100);
  });
  return (
    <g>
      <Ring cx={24} cy={21} r={10}/>
      {pts.map(([x, y], i) => <Dot key={i} cx={x} cy={y} r={1.5}/>)}
    </g>
  );
};

// Distribution board: a box with its lower-right half filled (the BS board mark).
const BoardBody = ({ x = 6, y = 12, w = 36, h = 24 }) => (
  <g>
    <Box x={x} y={y} w={w} h={h} r={1}/>
    <Poly pts={`${x},${y + h} ${x + w},${y} ${x + w},${y + h}`} closed solid/>
  </g>
);

// Isolator plate with a lever and a small label above the lever.
const IsoPlate = ({ label }) => (
  <g>
    <Box x={10} y={10} w={28} h={28} r={3}/>
    <Txt y={21} s={label.length > 2 ? 7 : 8.5}>{label}</Txt>
    <Lever x={16} y={32} x2={31} y2={26} r={1.7}/>
  </g>
);

// EV charge point body: rounded box, EV lettering and a small charge flash.
const EvBody = ({ x = 13, y = 4, w = 22, h = 27 }) => (
  <g>
    <Box x={x} y={y} w={w} h={h} r={3.5}/>
    <Txt x={x + w / 2} y={y + 11} s={8}>EV</Txt>
    <Flash x={x + w / 2 - 2} y={y + 14} s={0.85}/>
  </g>
);

export const POWER_SYMBOLS = [
  /* ---- Sockets & power ---------------------------------------------------- */
  { id: "pw_sso_unsw", name: "Single Socket Unswitched", code: "SSO-U", category: POWER, materials: WA, height: "450mm AFL",
    description: "Single Socket Unswitched", svg: (
      <g><SocketHalf/><Stem/><Txt x={39} y={16} s={7.5}>U</Txt></g>
    )},
  { id: "pw_dso_unsw", name: "Double Socket Unswitched", code: "DSO-U", category: POWER, materials: WA, height: "450mm AFL",
    description: "Double Socket Unswitched", svg: (
      <g><DoubleHalves/><Txt y={39} s={7.5}>U</Txt></g>
    )},
  { id: "pw_sso_wp", name: "Weatherproof Single Socket (IP66)", code: "SSO-WP", category: POWER, materials: WA, height: "450mm above ground",
    description: "Weatherproof Single Socket IP66 (external)", svg: (
      <g><Box x={10} y={13} w={28} h={18} r={2}/><SocketHalf cx={24} base={28} r={8}/><Txt y={40} s={6.5}>IP66</Txt></g>
    )},
  { id: "pw_dso_wp", name: "Weatherproof Double Socket (IP66)", code: "DSO-WP", category: POWER, materials: WA, height: "450mm above ground",
    description: "Weatherproof Double Socket IP66 (external)", svg: (
      <g><Box x={4} y={14} w={40} h={17} r={2}/><SocketHalf cx={15} base={28} r={8}/><SocketHalf cx={33} base={28} r={8}/><Txt y={40} s={6.5}>IP66</Txt></g>
    )},
  { id: "pw_dso_rcd", name: "Double Socket with RCD", code: "DSO-RCD", category: POWER, materials: WA, height: "450mm AFL",
    description: "Double Socket with integral RCD", svg: (
      <g><DoubleHalves/><Txt y={39} s={7}>RCD</Txt></g>
    )},
  { id: "pw_sso_usb", name: "Single Socket with USB", code: "SSO-USB", category: POWER, materials: WA, height: "450mm AFL",
    description: "Single Socket with USB-A/C outlets", svg: (
      <g><SocketHalf/><Stem/><Txt x={39} y={14} s={5.5}>USB</Txt></g>
    )},
  { id: "pw_dso_clean", name: "Double Socket, Clean Earth", code: "DSO-CE", category: POWER, materials: CIP, height: "450mm AFL",
    description: "Double Socket on dedicated clean-earth circuit", svg: (
      <g><DoubleHalves/><Txt y={39} s={7}>CE</Txt></g>
    )},
  { id: "pw_dso_ups", name: "Double Socket, UPS Supply", code: "DSO-UPS", category: POWER, materials: CIP, height: "450mm AFL",
    description: "Double Socket on UPS-backed supply", svg: (
      <g><DoubleHalves/><Txt y={39} s={7}>UPS</Txt></g>
    )},
  { id: "pw_floorbox", name: "Floor Box (power + data)", code: "FB", category: POWER, materials: CIP, height: "Floor",
    description: "Floor Box, power and data compartments", svg: (
      <g>
        <Box x={8} y={8} w={32} h={32} r={1.5}/>
        <SocketHalf cx={17} base={25} r={6}/>
        <SocketHalf cx={31} base={25} r={5} outline/>
        <Txt y={36} s={7}>FB</Txt>
      </g>
    )},
  { id: "pw_floor_socket", name: "Floor Socket Outlet", code: "FSO", category: POWER, materials: CIP, height: "Floor",
    description: "Flush Floor Socket Outlet", svg: (
      <g><Box x={11} y={11} w={26} h={26} r={1.5}/><Line x1={11} y1={31} x2={37} y2={31}/><SocketHalf cx={24} base={27} r={8}/></g>
    )},
  { id: "pw_dado", name: "Dado Trunking Outlet", code: "DTO", category: POWER, materials: CIP, height: "Dado level",
    description: "Double Socket in Dado / Perimeter Trunking", svg: (
      <g><Box x={2} y={27} w={44} h={9} r={0.5}/><Line x1={2} y1={31.5} x2={46} y2={31.5}/><SocketHalf cx={16} base={27} r={7}/><SocketHalf cx={32} base={27} r={7}/></g>
    )},
  { id: "pw_power_pole", name: "Power Pole", code: "PP", category: POWER, materials: CIP, height: "Floor to ceiling",
    description: "Power / Service Pole (floor to ceiling)", svg: (
      <g><Ring r={12}/><Dot r={4}/><Line x1={24} y1={4} x2={24} y2={12}/><Line x1={24} y1={36} x2={24} y2={44}/></g>
    )},
  { id: "pw_ind_16", name: "Industrial Socket 16A 230V", code: "IND-16", category: POWER, materials: CIP, height: "Per location",
    description: "Industrial Socket 16A 230V (BS EN 60309, blue)", svg: (
      <g><IndustrialFace pins={3}/><Txt y={42} s={7}>16A</Txt></g>
    )},
  { id: "pw_ind_32_3p", name: "Industrial Socket 32A 400V 3-Phase", code: "IND-32-3P", category: POWER, materials: CIP, height: "Per location",
    description: "Industrial Socket 32A 400V 3-phase (BS EN 60309, red)", svg: (
      <g><IndustrialFace pins={5}/><Txt y={42} s={6.5}>32A 3P</Txt></g>
    )},
  { id: "pw_ind_110", name: "Industrial Socket 16A 110V", code: "IND-110", category: POWER, materials: CIP, height: "Per location",
    description: "Industrial Socket 16A 110V (BS EN 60309, yellow)", svg: (
      <g><IndustrialFace pins={3}/><Txt y={42} s={7}>110V</Txt></g>
    )},
  { id: "pw_fcu_neon", name: "Switched Fused Spur with Neon", code: "FCU-SN", category: POWER, materials: WA, height: "Above worktop / per location",
    description: "Switched Fused Spur with neon indicator", svg: (
      <g><FcuPlate/><Lever x={15} y={34} x2={30} y2={28} r={1.8}/><Ring cx={37} cy={33} r={2.4} w={FEEDER}/><Dot cx={37} cy={33} r={0.9}/></g>
    )},
  { id: "pw_fcu_flex", name: "Fused Spur with Flex Outlet", code: "FCU-F", category: POWER, materials: WA, height: "Per location",
    description: "Switched Fused Spur with flex outlet", svg: (
      <g><FcuPlate/><Path d="M 24 22 C 19 26 29 29 24 33 L 24 37" w={FEEDER}/><Ring cx={24} cy={40} r={2.5} w={FEEDER}/></g>
    )},
  { id: "pw_fcu_key", name: "Lockable Fused Spur (key switch)", code: "FCU-K", category: POWER, materials: WA, height: "Per location",
    description: "Key-switched (lockable) Fused Spur", svg: (
      <g><FcuPlate/><KeyMark x={17} y={33} s={1.2}/></g>
    )},
  { id: "pw_dp20_neon", name: "20A DP Switch with Neon", code: "DP20-N", category: POWER, materials: WA, height: "Per location",
    description: "20A Double Pole Switch with neon", svg: <DpPlate label="20A" neon/> },
  { id: "pw_dp45", name: "45A DP Switch (shower / cooker)", code: "DP45", category: POWER, materials: WA, height: "Per location",
    description: "45A Double Pole Switch with neon", svg: <DpPlate label="45A" neon/> },
  { id: "pw_iso_3p", name: "3-Pole Fan Isolator", code: "ISO-3P", category: POWER, materials: WA, height: "1500mm AFL / above door",
    description: "3-Pole Fan Isolator Switch", svg: (
      <g><Box x={14} y={10} w={20} h={14}/><Txt y={20.5} s={8}>3P</Txt><Lever x={16} y={34} x2={30} y2={29} r={1.6}/></g>
    )},
  { id: "pw_flex_outlet", name: "Flex Outlet Plate", code: "FO", category: POWER, materials: WA, height: "Per location",
    description: "Flex Outlet Plate", svg: (
      <g><Box x={14} y={10} w={20} h={14}/><Ring cx={24} cy={17} r={2.6} w={FEEDER}/><Path d="M 24 24 C 20 28 28 31 24 35 L 24 40" w={FEEDER}/></g>
    )},
  { id: "pw_hand_dryer", name: "Hand Dryer", code: "HDR", category: POWER, materials: CIP, height: "Per manufacturer",
    description: "Hand Dryer (fused spur supply)", svg: (
      <g>
        <Box x={10} y={7} w={28} h={20} r={3}/>
        <Txt y={20} s={8}>HD</Txt>
        {[17, 24, 31].map((x) => <Path key={x} d={`M ${x} 30 C ${x - 2.5} 33 ${x + 2.5} 35 ${x} 38 L ${x} 41`} w={FEEDER}/>)}
      </g>
    )},
  { id: "pw_ccu_socket", name: "Cooker Control Unit with Socket", code: "CCU-S", category: POWER, materials: WA, height: "1100–1450mm AFL",
    description: "Cooker Control Unit 45A with 13A socket", svg: (
      <g>
        <Box x={5} y={10} w={38} h={18} r={2.5}/>
        <Txt x={16} y={22} s={7.5}>45A</Txt>
        <SocketHalf cx={34} base={24} r={5.5}/>
        <Lever x={14} y={37} x2={28} y2={32} r={1.6}/>
      </g>
    )},
  { id: "pw_clock", name: "Clock Connector", code: "CLK", category: POWER, materials: WA, height: "Per location",
    description: "Clock Connector (fused)", svg: (
      <g><Ring r={11}/><Line x1={24} y1={24} x2={24} y2={16} w={STROKE}/><Line x1={24} y1={24} x2={30} y2={27} w={STROKE}/><Dot r={1.4}/></g>
    )},

  /* ---- Distribution ------------------------------------------------------- */
  { id: "db_spn", name: "Distribution Board (SP&N)", code: "DB", category: DIST, materials: "Distribution & metering", height: "Per location",
    description: "Distribution Board, single phase & neutral", svg: (
      <g><BoardBody/><Txt y={9} s={7}>DB</Txt></g>
    )},
  { id: "db_tpn", name: "Distribution Board (TP&N)", code: "DB-TP", category: DIST, materials: "Distribution & metering", height: "Per location",
    description: "Distribution Board, three phase & neutral", svg: (
      <g><BoardBody/>{[17, 21, 25].map((y) => <Line key={y} x1={10} y1={y} x2={18} y2={y}/>)}<Txt y={9} s={7}>DB-TP</Txt></g>
    )},
  { id: "db_msb", name: "Main Switchboard / Panelboard", code: "MSB", category: DIST, materials: "Distribution & metering", height: "Floor standing",
    description: "Main Switchboard / Panelboard", svg: (
      <g><BoardBody x={2} y={14} w={44} h={22}/><Line x1={14} y1={14} x2={14} y2={36}/><Txt y={10} s={7}>MSB</Txt></g>
    )},
  { id: "db_cu_sub", name: "Sub Consumer Unit (garage / outbuilding)", code: "CU-S", category: DIST, materials: "Distribution & metering", height: "1350–1450mm AFL",
    description: "Sub-main Consumer Unit (garage / outbuilding)", svg: (
      <g>
        <Box x={8} y={16} w={32} h={18} r={1.5}/>
        <Line x1={8} y1={22} x2={40} y2={22} w={0.7}/>
        <Box x={10.5} y={24} w={5} h={8} r={0} solid/>
        {[19, 24, 29, 34].map((x) => <Box key={x} x={x} y={25} w={3} h={6} r={0} sw={0.8}/>)}
        <Txt y={12} s={6.5}>SUB CU</Txt>
      </g>
    )},
  { id: "db_switch_fuse", name: "Switch Fuse", code: "SF", category: DIST, materials: "Distribution & metering", height: "Per location",
    description: "Switch Fuse (fused isolator)", svg: (
      <g>
        <Box x={6} y={12} w={36} h={24} r={1.5}/>
        <Lever x={12} y={28} x2={22} y2={20} r={1.7}/>
        <Box x={26} y={21} w={11} h={7} r={0.5} sw={FEEDER}/>
        <Line x1={23} y1={24.5} x2={40} y2={24.5}/>
      </g>
    )},
  { id: "db_main_iso", name: "Main Isolator / Switch-Disconnector", code: "MI", category: DIST, materials: "Distribution & metering", height: "Per location",
    description: "Main Isolator (switch-disconnector)", svg: <IsoPlate label="MI"/> },
  { id: "db_mccb", name: "MCCB / Feeder Pillar Way", code: "MCCB", category: DIST, materials: "Distribution & metering", height: "Per location",
    description: "Moulded Case Circuit Breaker (MCCB)", svg: (
      <g>
        <Box x={6} y={13} w={36} h={22} r={1.5}/>
        <Txt y={22} s={7}>MCCB</Txt>
        <Line x1={12} y1={29} x2={20} y2={29}/><Line x1={28} y1={29} x2={36} y2={29}/>
        <Line x1={20} y1={29} x2={28} y2={25} w={STROKE}/>
      </g>
    )},
  { id: "db_cutout", name: "Service Cut-out (DNO)", code: "SCO", category: DIST, materials: "Distribution & metering", height: "Meter position",
    description: "Service Head / Cut-out (DNO supply)", svg: (
      <g>
        <Box x={12} y={5} w={24} h={32} r={1}/>
        <Box x={19} y={10} w={10} h={15} r={0.5} sw={FEEDER}/>
        <Line x1={24} y1={7} x2={24} y2={28}/>
        <Txt y={34} s={6}>DNO</Txt>
        <Line x1={24} y1={37} x2={24} y2={44} feeder/>
      </g>
    )},
  { id: "db_meter_ct", name: "CT-Operated Meter", code: "MTR-CT", category: DIST, materials: "Distribution & metering", height: "Meter position",
    description: "CT-operated Electricity Meter", svg: (
      <g><Ring cx={24} cy={19} r={11}/><Txt y={22} s={6.5}>kWh</Txt><Line x1={4} y1={38} x2={44} y2={38}/><Ring cx={24} cy={38} r={4} w={STROKE}/><Line x1={24} y1={30} x2={24} y2={34} feeder/></g>
    )},
  { id: "db_submeter", name: "Sub-Meter", code: "SM", category: DIST, materials: "Distribution & metering", height: "Per location",
    description: "Electricity Sub-Meter (kWh)", svg: (
      <g><Box x={10} y={10} w={28} h={28} r={2}/><Box x={14} y={14} w={20} h={8} r={0.5} sw={FEEDER}/><Txt y={33} s={7.5}>kWh</Txt></g>
    )},
  { id: "db_met", name: "Main Earthing Terminal", code: "MET", category: DIST, materials: "Earthing & protection", height: "Beside consumer unit",
    description: "Main Earthing Terminal (MET)", svg: (
      <g>
        <Box x={8} y={5} w={32} h={6} r={1}/>
        {[13, 19.5, 28.5, 35].map((x) => <Dot key={x} cx={x} cy={8} r={1.1}/>)}
        <EarthMark x={24} y={11} s={0.85}/>
        <Txt y={42} s={7}>MET</Txt>
      </g>
    )},
  { id: "db_earth_rod", name: "Earth Electrode / Test Pit", code: "EE", category: DIST, materials: "Earthing & protection", height: "External, ground",
    description: "Earth Electrode with inspection pit", svg: (
      <g><Ring r={15}/><EarthMark x={24} y={13} s={0.85}/></g>
    )},
  { id: "db_bond", name: "Bonding Clamp (BS 951)", code: "EB", category: DIST, materials: "Earthing & protection", height: "At service entry",
    description: "Main Equipotential Bonding Clamp", svg: (
      <g>
        <Line x1={6} y1={9} x2={42} y2={9}/><Line x1={6} y1={15} x2={42} y2={15}/>
        <Box x={20} y={6.5} w={8} h={11} r={0.5} solid/>
        <EarthMark x={24} y={17.5} s={0.85}/>
      </g>
    )},
  { id: "db_spd", name: "Surge Protection Device", code: "SPD", category: DIST, materials: "Earthing & protection", height: "At distribution board",
    description: "Surge Protection Device (SPD)", svg: (
      <g><Box x={12} y={7} w={24} h={26} r={2}/><Flash x={21} y={12} s={1.3}/><Txt y={42} s={7}>SPD</Txt></g>
    )},
  { id: "db_changeover", name: "Changeover Switch (generator)", code: "C/O", category: DIST, materials: "Distribution & metering", height: "Per location",
    description: "Generator Changeover Switch", svg: (
      <g>
        <Box x={6} y={10} w={36} h={28} r={1.5}/>
        <Dot cx={13} cy={24} r={1.8}/>
        <Line x1={13} y1={24} x2={31} y2={17} w={STROKE}/>
        <Ring cx={34} cy={16} r={1.8} w={FEEDER}/><Ring cx={34} cy={32} r={1.8} w={FEEDER}/>
      </g>
    )},
  { id: "db_generator", name: "Generator", code: "GEN", category: DIST, materials: "Distribution & metering", height: "External / plant room",
    description: "Standby Generator", svg: (
      <g><Ring r={13}/><Txt y={27} s={11}>G</Txt><Path d="M 18 33 C 20 30.5 22 30.5 24 33 C 26 35.5 28 35.5 30 33" w={FEEDER}/></g>
    )},
  { id: "db_busbar", name: "Busbar Chamber", code: "BB", category: DIST, materials: "Distribution & metering", height: "Per location",
    description: "Busbar Chamber", svg: (
      <g><Box x={4} y={12} w={40} h={24} r={1}/>{[18, 24, 30].map((y) => <Line key={y} x1={8} y1={y} x2={40} y2={y} w={STROKE}/>)}</g>
    )},
  { id: "db_jb", name: "Junction Box", code: "JB", category: DIST, materials: "Distribution & metering", height: "Per location",
    description: "Junction Box (maintenance-free where concealed)", svg: (
      <g><Ring r={10}/><Txt y={27} s={8}>JB</Txt><Line x1={4} y1={24} x2={14} y2={24} feeder/><Line x1={34} y1={24} x2={44} y2={24} feeder/></g>
    )},
  { id: "db_lp_test", name: "Lightning Protection Test Point", code: "LPT", category: DIST, materials: "Earthing & protection", height: "External, ground level",
    description: "Lightning Protection Test Point", svg: (
      <g><Box x={13} y={13} w={22} h={22} r={1}/><Flash x={21} y={6} s={1.1}/><Line x1={24} y1={22} x2={24} y2={30}/><Line x1={19} y1={30} x2={29} y2={30} w={STROKE}/></g>
    )},
  { id: "db_ups", name: "UPS (central)", code: "UPS-C", category: DIST, materials: "Distribution & metering", height: "Floor standing",
    description: "Central Uninterruptible Power Supply", svg: (
      <g>
        <Box x={6} y={8} w={36} h={32} r={1.5}/>
        <Txt y={22} s={9}>UPS</Txt>
        <Box x={16} y={27} w={14} h={7} r={0.5} sw={FEEDER}/>
        <Box x={30} y={29} w={2} h={3} r={0} solid/>
      </g>
    )},

  /* ---- EV & renewables ---------------------------------------------------- */
  { id: "ev_7kw", name: "EV Charge Point 7kW", code: "EV-7", category: EV, materials: "EV & renewables", height: "Per manufacturer",
    description: "EV Charge Point 7kW (single phase)", svg: (
      <g><EvBody/><Txt y={42} s={7}>7kW</Txt></g>
    )},
  { id: "ev_22kw", name: "EV Charge Point 22kW", code: "EV-22", category: EV, materials: "EV & renewables", height: "Per manufacturer",
    description: "EV Charge Point 22kW (three phase)", svg: (
      <g><EvBody/><Txt y={42} s={7}>22kW</Txt></g>
    )},
  { id: "ev_twin", name: "Twin EV Charge Point (pedestal)", code: "EV-2", category: EV, materials: "EV & renewables", height: "Floor mounted",
    description: "Twin EV Charge Point on pedestal", svg: (
      <g>
        <EvBody x={3} y={6} w={19} h={26}/>
        <EvBody x={26} y={6} w={19} h={26}/>
        <Line x1={4} y1={40} x2={44} y2={40} w={STROKE}/><Line x1={24} y1={32} x2={24} y2={40}/>
      </g>
    )},
  { id: "ev_rapid", name: "Rapid DC Charger", code: "EV-DC", category: EV, materials: "EV & renewables", height: "Floor mounted",
    description: "Rapid DC EV Charger", svg: (
      <g><Box x={12} y={3} w={24} h={36} r={2}/><Txt y={14} s={8}>DC</Txt><Flash x={21} y={18} s={1.3}/><Line x1={8} y1={43} x2={40} y2={43} w={STROKE}/></g>
    )},
  { id: "ev_iso", name: "EV Supply Isolator", code: "EV-ISO", category: EV, materials: "EV & renewables", height: "Beside charge point",
    description: "EV Charge Point Supply Isolator", svg: <IsoPlate label="EV"/> },
  { id: "re_pv_array", name: "Solar PV Array", code: "PV", category: EV, materials: "EV & renewables", height: "Roof",
    description: "Solar PV Array (roof mounted)", svg: (
      <g>
        <Poly pts="8,12 44,12 40,36 4,36" closed/>
        <Line x1={20} y1={12} x2={16} y2={36}/><Line x1={32} y1={12} x2={28} y2={36}/><Line x1={6} y1={24} x2={42} y2={24}/>
      </g>
    )},
  { id: "re_inverter", name: "PV Inverter", code: "INV", category: EV, materials: "EV & renewables", height: "Per location",
    description: "Solar PV Inverter", svg: (
      <g>
        <Box x={8} y={8} w={32} h={32} r={1.5}/>
        <Line x1={8} y1={40} x2={40} y2={8}/>
        <Line x1={13} y1={15} x2={21} y2={15} w={STROKE}/><Line x1={13} y1={19} x2={21} y2={19} w={STROKE}/>
        <Path d="M 26 32 C 28 28 31 28 31 31 C 31 34 34 34 36 30" w={STROKE}/>
      </g>
    )},
  { id: "re_dc_iso", name: "PV DC Isolator", code: "DC-ISO", category: EV, materials: "EV & renewables", height: "Beside inverter",
    description: "Solar PV DC Isolator", svg: <IsoPlate label="DC"/> },
  { id: "re_ac_iso", name: "PV AC Isolator", code: "AC-ISO", category: EV, materials: "EV & renewables", height: "Beside inverter",
    description: "Solar PV AC Isolator", svg: <IsoPlate label="AC"/> },
  { id: "re_battery", name: "Battery Storage", code: "BAT", category: EV, materials: "EV & renewables", height: "Per manufacturer",
    description: "Battery Energy Storage Unit", svg: (
      <g>
        <Box x={6} y={14} w={32} h={20} r={2}/>
        <Box x={38} y={20} w={4} h={8} r={0.5} solid/>
        {[11, 18, 25].map((x) => <Box key={x} x={x} y={18} w={5} h={12} r={0.5} solid/>)}
      </g>
    )},
  { id: "re_gen_meter", name: "Generation Meter", code: "GMT", category: EV, materials: "EV & renewables", height: "Beside inverter",
    description: "Generation Meter (kWh)", svg: (
      <g><Box x={10} y={10} w={28} h={28} r={2}/><Box x={14} y={14} w={20} h={8} r={0.5} sw={FEEDER}/><Txt y={33} s={7.5}>GEN</Txt></g>
    )},
  { id: "re_ashp", name: "Air Source Heat Pump", code: "ASHP", category: EV, materials: "EV & renewables", height: "External, ground",
    description: "Air Source Heat Pump (outdoor unit)", svg: (
      <g><Box x={3} y={8} w={42} h={32} r={2}/><Fan cx={17} cy={24} r={10}/><Txt x={36} y={27} s={8}>HP</Txt></g>
    )},
  { id: "re_gshp", name: "Ground Source Heat Pump", code: "GSHP", category: EV, materials: "EV & renewables", height: "Plant room",
    description: "Ground Source Heat Pump", svg: (
      <g>
        <Box x={8} y={5} w={32} h={24} r={2}/><Txt y={20} s={7.5}>GSHP</Txt>
        <Line x1={4} y1={34} x2={44} y2={34} w={STROKE}/>
        {[8, 16, 24, 32, 40].map((x) => <Line key={x} x1={x} y1={34} x2={x - 4} y2={40}/>)}
      </g>
    )},
  { id: "re_solar_thermal", name: "Solar Thermal Collector", code: "STC", category: EV, materials: "EV & renewables", height: "Roof",
    description: "Solar Thermal (hot water) Collector", svg: (
      <g><Box x={4} y={10} w={40} h={28} r={1}/><Path d="M 9 15 L 39 15 L 39 21 L 9 21 L 9 27 L 39 27 L 39 33 L 9 33" w={FEEDER}/></g>
    )},
  { id: "re_wind", name: "Small Wind Turbine", code: "WT", category: EV, materials: "EV & renewables", height: "Mast",
    description: "Small Wind Turbine", svg: (
      <g>
        <Dot cx={24} cy={16} r={2.2}/>
        <Path d="M 24 16 L 22 3 L 26 4 Z" solid/>
        <Path d="M 24 16 L 35 23 L 32 26 Z" solid/>
        <Path d="M 24 16 L 13 24 L 12 20 Z" solid/>
        <Line x1={24} y1={18} x2={24} y2={44} w={STROKE}/><Line x1={18} y1={44} x2={30} y2={44} w={STROKE}/>
      </g>
    )},
  { id: "re_diverter", name: "PV Diverter (immersion)", code: "DIV", category: EV, materials: "EV & renewables", height: "Per location",
    description: "Solar PV Diverter to Immersion Heater", svg: (
      <g><Box x={8} y={9} w={32} h={20} r={2}/><Txt y={22} s={8}>DIV</Txt><Arrow x1={24} y1={29} x2={24} y2={42}/></g>
    )},
  { id: "re_export_ct", name: "Export Limiter CT Clamp", code: "CT", category: EV, materials: "EV & renewables", height: "At meter tails",
    description: "Export Limiting CT Clamp", svg: (
      <g><Line x1={4} y1={30} x2={44} y2={30}/><Ring cx={24} cy={30} r={6}/><Txt y={16} s={8}>CT</Txt></g>
    )},
];
