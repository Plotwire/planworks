/* ============================================================================
 * Draft symbols: Switching & controls, Heating & ventilation.
 * Drawn in-house with lib/symbolKit.jsx to UK layout-drawing conventions:
 * switches keep the original pivot-and-lever mark, with key, timer and
 * sensor variants marked beside it.
 * Drafts are hidden from users until approved (see lib/symbolDrafts/index.js).
 * ========================================================================= */

"use client";

import React from "react";
import {
  STROKE, FEEDER, Txt, Ring, Dot, Box, Line, Path, Poly,
  Lever, KeyMark, Arrow, Rays, Fan, Waves,
} from "../symbolKit";

const SC = "switching", HV = "hvac";
const WA = "Wiring accessories", LC = "Lighting controls", HC = "Heating & controls", VAC = "Ventilation & air conditioning";

// The original switch mark: pivot at (14, 28), lever to (32, 14).
const Sw = () => <Lever/>;
// Gang number beside the lever, as the original 2/3/4 gang switches.
const Gang = ({ n }) => <Txt x={37} y={20} s={11}>{n}</Txt>;

// Small clock face (ring and hands).
const Clock = ({ cx, cy, r }) => (
  <g>
    <Ring cx={cx} cy={cy} r={r} w={FEEDER + 0.2}/>
    <Line x1={cx} y1={cy} x2={cx} y2={cy - r * 0.65}/>
    <Line x1={cx} y1={cy} x2={cx + r * 0.5} y2={cy + r * 0.25}/>
  </g>
);

// Round sensor head with lettering.
const Sensor = ({ label, s = 8 }) => (
  <g><Ring r={11}/><Txt y={24 + s * 0.36} s={s}>{label}</Txt></g>
);

// Plate with lettering (controllers, modules).
const Module = ({ label, s = 8, x = 7, y = 13, w = 34, h = 22 }) => (
  <g><Box x={x} y={y} w={w} h={h} r={1.5}/><Txt y={y + h / 2 + s * 0.36} s={s}>{label}</Txt></g>
);

export const CONTROL_SYMBOLS = [
  /* ---- Switching & controls ----------------------------------------------- */
  { id: "sc_key_1g", name: "Key Switch, 1 Gang", code: "KS-1G", category: SC, materials: WA, height: "1200mm AFL",
    description: "Key-operated Light Switch, 1 gang", svg: (
      <g><Sw/><KeyMark x={29} y={33} s={1.1}/></g>
    )},
  { id: "sc_key_2g", name: "Key Switch, 2 Gang", code: "KS-2G", category: SC, materials: WA, height: "1200mm AFL",
    description: "Key-operated Light Switch, 2 gang", svg: (
      <g><Sw/><Gang n="2"/><KeyMark x={29} y={35} s={1.1}/></g>
    )},
  { id: "sc_retractive", name: "Retractive / Push Switch", code: "PB", category: SC, materials: WA, height: "1200mm AFL",
    description: "Retractive (push-to-make) Switch", svg: (
      <g><Ring cx={24} cy={21} r={8}/><Dot cx={24} cy={21} r={3.5}/><Txt y={41} s={7}>PB</Txt></g>
    )},
  { id: "sc_wp_switch", name: "Weatherproof Switch (IP66)", code: "SW-WP", category: SC, materials: WA, height: "1200mm AFL",
    description: "Weatherproof Light Switch IP66", svg: (
      <g><Box x={8} y={6} w={32} h={28} r={2}/><Lever x={15} y={27} x2={31} y2={13}/><Txt y={43} s={6.5}>IP66</Txt></g>
    )},
  { id: "sc_dimmer_2g", name: "Dimmer Switch, 2 Gang", code: "DIM-2G", category: SC, materials: WA, height: "1200mm AFL",
    description: "Dimmer Switch, 2 gang (trailing edge)", svg: (
      <g><Lever r={3.4}/><Gang n="2"/><Txt x={37} y={33} s={6}>DIM</Txt></g>
    )},
  { id: "sc_timer", name: "Time-Lag Switch", code: "SW-T", category: SC, materials: LC, height: "1200mm AFL",
    description: "Time-lag (timer) Light Switch", svg: (
      <g><Sw/><Clock cx={38} cy={31} r={5.5}/></g>
    )},
  { id: "sc_timeclock", name: "Time Clock", code: "TC", category: SC, materials: LC, height: "Per location",
    description: "Lighting Time Clock", svg: (
      <g><Box x={9} y={9} w={30} h={30} r={2}/><Clock cx={24} cy={24} r={9}/></g>
    )},
  { id: "sc_photocell", name: "Photocell", code: "PEC", category: SC, materials: LC, height: "External, high level",
    description: "Photoelectric Cell (dusk to dawn)", svg: (
      <g><Ring cx={28} cy={28} r={9}/><Dot cx={28} cy={28} r={2.5}/><Arrow x1={6} y1={6} x2={17} y2={17} h={3.5}/><Arrow x1={14} y1={4} x2={23} y2={14} h={3.5}/></g>
    )},
  { id: "sc_presence", name: "Presence / Absence Detector", code: "PD", category: SC, materials: LC, height: "Ceiling",
    description: "Ceiling Presence / Absence Detector", svg: <Sensor label="PD"/> },
  { id: "sc_microwave", name: "Microwave Sensor", code: "MW", category: SC, materials: LC, height: "Ceiling",
    description: "Microwave Occupancy Sensor", svg: <Sensor label="MW" s={7.5}/> },
  { id: "sc_wall_pir", name: "Wall PIR Switch", code: "SW-PIR", category: SC, materials: LC, height: "1200mm AFL",
    description: "Wall Switch with PIR sensor", svg: (
      <g><Sw/><Path d="M 33 26 L 43 31 L 33 36 Z"/></g>
    )},
  { id: "sc_wireless", name: "Wireless Switch", code: "SW-RF", category: SC, materials: LC, height: "1200mm AFL",
    description: "Wireless / battery Light Switch", svg: (
      <g><Sw/><Waves x={33} y={30} n={3} gap={2.6}/></g>
    )},
  { id: "sc_2g_2way", name: "2 Gang 2-Way Switch", code: "SW-2G2W", category: SC, materials: WA, height: "1200mm AFL",
    description: "2 Gang 2-Way Light Switch", svg: (
      <g><Sw/><Gang n="2"/><Txt x={37} y={34} s={6.5}>2W</Txt></g>
    )},
  { id: "sc_grid_plate", name: "Grid Switch Plate (6 module)", code: "GRID-6", category: SC, materials: WA, height: "1200mm AFL",
    description: "Grid Switch Plate, 6 module", svg: (
      <g><Box x={6} y={10} w={36} h={28} r={2.5}/><Line x1={18} y1={10} x2={18} y2={38}/><Line x1={30} y1={10} x2={30} y2={38}/><Line x1={6} y1={24} x2={42} y2={24}/></g>
    )},
  { id: "sc_pull_45a", name: "Pull Cord Switch 45A (shower)", code: "PC-45", category: SC, materials: WA, height: "Ceiling (cord to 1000mm)",
    description: "Ceiling Pull Cord Switch 45A DP (shower)", svg: (
      <g><Dot cx={18} cy={9} r={2.6}/><Line x1={18} y1={9} x2={18} y2={36} w={STROKE}/><Poly pts="14,32 18,38 22,32"/><Txt x={35} y={26} s={8}>45A</Txt></g>
    )},
  { id: "sc_blind", name: "Blind / Curtain Control", code: "BLD", category: SC, materials: LC, height: "1200mm AFL",
    description: "Motorised Blind / Curtain Switch", svg: (
      <g><Box x={14} y={6} w={20} h={36} r={2.5}/><Poly pts="24,11 30,19 18,19" closed solid/><Poly pts="24,37 30,29 18,29" closed solid/></g>
    )},
  { id: "sc_fan_boost", name: "Fan Boost Switch", code: "SW-F", category: SC, materials: WA, height: "1200mm AFL",
    description: "Extract Fan Boost Switch", svg: (
      <g><Sw/><Txt x={38} y={36} s={9}>F</Txt></g>
    )},
  { id: "sc_scene", name: "Scene Control Plate", code: "SCN", category: SC, materials: LC, height: "1200mm AFL",
    description: "Lighting Scene Control Plate", svg: (
      <g><Box x={12} y={7} w={24} h={34} r={2.5}/>{[[15.5, 11], [25, 11], [15.5, 20], [25, 20], [15.5, 29], [25, 29]].map(([x, y]) => <Box key={x + "-" + y} x={x} y={y} w={7.5} h={6} r={1} sw={FEEDER}/>)}</g>
    )},
  { id: "sc_lcm", name: "Lighting Control Module (DALI)", code: "LCM", category: SC, materials: LC, height: "Ceiling void",
    description: "Lighting Control Module (DALI)", svg: (
      <g><Module label="LCM"/>{[12, 18, 24, 30, 36].map((x) => <Line key={x} x1={x} y1={35} x2={x} y2={40}/>)}</g>
    )},
  { id: "sc_contactor", name: "Contactor", code: "CON", category: SC, materials: LC, height: "Distribution board",
    description: "Lighting Contactor", svg: (
      <g><Box x={10} y={8} w={28} h={32} r={1.5}/><Box x={17} y={13} w={14} h={9} r={0.5} sw={FEEDER}/><Line x1={17} y1={22} x2={31} y2={13}/><Line x1={18} y1={34} x2={30} y2={34}/><Line x1={20} y1={34} x2={28} y2={28} w={STROKE}/></g>
    )},
  { id: "sc_relay", name: "Relay Module", code: "RLY", category: SC, materials: LC, height: "Per location",
    description: "Relay / Interface Module", svg: <Module label="RLY"/> },
  { id: "sc_bms", name: "BMS Interface", code: "BMS", category: SC, materials: LC, height: "Per location",
    description: "Building Management System Interface", svg: <Module label="BMS"/> },
  { id: "sc_estop", name: "Emergency Stop Button", code: "ESB", category: SC, materials: WA, height: "1200mm AFL",
    description: "Emergency Stop Button (mushroom head)", svg: (
      <g><Box x={9} y={9} w={30} h={30} r={2}/><Ring r={10} w={FEEDER}/><Dot r={6.5}/></g>
    )},

  /* ---- Heating & ventilation --------------------------------------------- */
  { id: "hv_prog_stat", name: "Programmable Room Thermostat", code: "PRT", category: HV, materials: HC, height: "1500mm AFL",
    description: "Programmable Room Thermostat", svg: (
      <g><Box x={10} y={9} w={28} h={30} r={3}/><Box x={14} y={13} w={20} h={9} r={0.5} sw={FEEDER}/><Txt y={34} s={9}>T</Txt></g>
    )},
  { id: "hv_programmer", name: "Heating Programmer", code: "PRG", category: HV, materials: HC, height: "1500mm AFL",
    description: "Central Heating Programmer / Timer", svg: (
      <g><Box x={5} y={12} w={38} h={24} r={2}/><Ring cx={16} cy={24} r={6.5} w={FEEDER + 0.2}/><Line x1={16} y1={24} x2={16} y2={19.5}/><Line x1={16} y1={24} x2={19.5} y2={26}/><Box x={27} y={17} w={11} h={5} r={1} sw={FEEDER}/><Box x={27} y={26} w={11} h={5} r={1} sw={FEEDER}/></g>
    )},
  { id: "hv_zone_valve", name: "Motorised Zone Valve", code: "ZV", category: HV, materials: HC, height: "Per location",
    description: "Motorised Zone Valve (2 or 3 port)", svg: (
      <g><Poly pts="8,20 24,28 8,36" closed/><Poly pts="40,20 24,28 40,36" closed/><Line x1={24} y1={28} x2={24} y2={16}/><Box x={17} y={6} w={14} h={10} r={1}/><Txt y={14} s={7}>M</Txt></g>
    )},
  { id: "hv_boiler", name: "Boiler", code: "BLR", category: HV, materials: "Services (non-electrical)", height: "Per location",
    description: "Boiler (fused spur supply)", svg: (
      <g><Box x={11} y={5} w={26} h={38} r={2}/><Txt y={22} s={10}>B</Txt><Path d="M 24 37 C 19 33 22 30 24 27 C 26 30 29 33 24 37 Z" w={FEEDER + 0.2}/></g>
    )},
  { id: "hv_cylinder", name: "Hot Water Cylinder with Immersion", code: "CYL", category: HV, materials: HC, height: "Airing cupboard",
    description: "Hot Water Cylinder with immersion heater", svg: (
      <g><Ring r={14}/><Txt y={22} s={8}>HW</Txt><Path d="M 16 29 L 19 32 L 22 29 L 25 32 L 28 29 L 31 32" w={FEEDER + 0.2}/></g>
    )},
  { id: "hv_immersion", name: "Immersion Heater Switch", code: "IMM", category: HV, materials: WA, height: "Per location",
    description: "Immersion Heater Switch, 20A DP (bath / sink)", svg: (
      <g><Box x={10} y={10} w={28} h={28} r={3}/><Txt y={21} s={7.5}>IMM</Txt><Lever x={16} y={32} x2={30} y2={27} r={1.6}/></g>
    )},
  { id: "hv_storage", name: "Storage Heater", code: "SH", category: HV, materials: HC, height: "Low level",
    description: "Night Storage Heater", svg: (
      <g><Box x={2} y={16} w={44} h={16} r={1}/>{[8, 15, 22, 29, 36].map((x) => <Line key={x} x1={x} y1={32} x2={x + 7} y2={16}/>)}</g>
    )},
  { id: "hv_panel_heater", name: "Panel Heater / Convector", code: "PH", category: HV, materials: HC, height: "Low level",
    description: "Electric Panel Heater / Convector", svg: (
      <g><Box x={3} y={17} w={42} h={14} r={1.5}/>{[9, 14, 19, 24, 29, 34, 39].map((x) => <Line key={x} x1={x} y1={20} x2={x} y2={28}/>)}</g>
    )},
  { id: "hv_fan_heater", name: "Fan Heater (wall)", code: "FH", category: HV, materials: HC, height: "High level",
    description: "Wall-mounted Fan Heater", svg: (
      <g><Box x={7} y={10} w={34} h={28} r={2}/><Fan cx={24} cy={24} r={9}/></g>
    )},
  { id: "hv_infrared", name: "Infrared Heating Panel", code: "IR", category: HV, materials: HC, height: "Ceiling / wall",
    description: "Infrared Heating Panel", svg: (
      <g><Box x={5} y={9} w={38} h={30} r={1}/>{[17, 24, 31].map((y) => <Path key={y} d={`M 10 ${y} C 13 ${y - 3} 16 ${y - 3} 19 ${y} C 22 ${y + 3} 25 ${y + 3} 28 ${y} C 31 ${y - 3} 34 ${y - 3} 38 ${y}`} w={FEEDER}/>)}</g>
    )},
  { id: "hv_frost", name: "Frost Thermostat", code: "FRS", category: HV, materials: HC, height: "Per location",
    description: "Frost Protection Thermostat", svg: (
      <g><Ring r={12}/><Rays r1={0} r2={7.5} angles={[90, 270, 30, 210, 150, 330]} w={STROKE}/></g>
    )},
  { id: "hv_humidistat", name: "Humidistat", code: "HUM", category: HV, materials: VAC, height: "Per location",
    description: "Humidistat (humidity-controlled fan)", svg: <Sensor label="RH"/> },
  { id: "hv_co2", name: "CO2 / Air Quality Sensor", code: "CO2", category: HV, materials: VAC, height: "1500mm AFL",
    description: "CO2 / Air Quality Sensor", svg: <Sensor label="CO2" s={7}/> },
  { id: "hv_inline_fan", name: "Inline Duct Fan", code: "IEF", category: HV, materials: VAC, height: "Ceiling void",
    description: "Inline Extract Fan (in duct)", svg: (
      <g><Line x1={2} y1={16} x2={14} y2={16} w={STROKE}/><Line x1={2} y1={32} x2={14} y2={32} w={STROKE}/><Line x1={34} y1={16} x2={46} y2={16} w={STROKE}/><Line x1={34} y1={32} x2={46} y2={32} w={STROKE}/><Ring r={10}/><Fan r={7}/></g>
    )},
  { id: "hv_mvhr", name: "MVHR Unit", code: "MVHR", category: HV, materials: VAC, height: "Loft / cupboard",
    description: "Mechanical Ventilation with Heat Recovery unit", svg: (
      <g><Box x={4} y={8} w={40} h={32} r={1.5}/><Arrow x1={10} y1={14} x2={38} y2={34} h={3.5}/><Arrow x1={38} y1={14} x2={10} y2={34} h={3.5}/></g>
    )},
  { id: "hv_hood", name: "Cooker Hood", code: "CH", category: HV, materials: VAC, height: "Above hob",
    description: "Cooker Hood (extract)", svg: (
      <g><Poly pts="8,36 40,36 32,20 16,20" closed/><Box x={19} y={9} w={10} h={11} r={0.5}/><Arrow x1={24} y1={30} x2={24} y2={4} h={3.5}/></g>
    )},
  { id: "hv_ac_cassette", name: "AC Cassette (indoor)", code: "ACC", category: HV, materials: VAC, height: "Ceiling",
    description: "Air Conditioning Ceiling Cassette", svg: (
      <g><Box x={6} y={6} w={36} h={36} r={1}/><Box x={17} y={17} w={14} h={14} r={1} sw={FEEDER}/><Line x1={14} y1={11} x2={34} y2={11} w={STROKE}/><Line x1={14} y1={37} x2={34} y2={37} w={STROKE}/><Line x1={11} y1={14} x2={11} y2={34} w={STROKE}/><Line x1={37} y1={14} x2={37} y2={34} w={STROKE}/></g>
    )},
  { id: "hv_ac_wall", name: "AC Wall Unit (indoor)", code: "ACW", category: HV, materials: VAC, height: "High level",
    description: "Air Conditioning Wall-mounted Unit", svg: (
      <g><Box x={3} y={13} w={42} h={18} r={4}/><Txt x={14} y={25} s={7.5}>AC</Txt>{[22, 25.5].map((y) => <Line key={y} x1={24} y1={y} x2={40} y2={y}/>)}</g>
    )},
  { id: "hv_ac_outdoor", name: "AC Outdoor Unit", code: "ACO", category: HV, materials: VAC, height: "External",
    description: "Air Conditioning / Condensing Outdoor Unit", svg: (
      <g><Box x={3} y={8} w={42} h={32} r={2}/><Fan cx={17} cy={24} r={10}/><Txt x={36} y={27} s={8}>AC</Txt></g>
    )},
  { id: "hv_air_curtain", name: "Air Curtain", code: "AIR", category: HV, materials: VAC, height: "Above door",
    description: "Air Curtain (above entrance)", svg: (
      <g><Box x={3} y={8} w={42} h={10} r={1.5}/>{[12, 24, 36].map((x) => <Arrow key={x} x1={x} y1={20} x2={x} y2={38} h={3.5}/>)}</g>
    )},
  { id: "hv_water_heater", name: "Instantaneous Water Heater", code: "WH", category: HV, materials: HC, height: "Under sink / per location",
    description: "Instantaneous / Point-of-use Water Heater", svg: (
      <g><Box x={12} y={6} w={24} h={26} r={2}/><Txt y={23} s={9}>WH</Txt><Line x1={18} y1={32} x2={18} y2={42} w={STROKE}/><Line x1={30} y1={32} x2={30} y2={42} w={STROKE}/></g>
    )},
  { id: "hv_shower", name: "Electric Shower", code: "SHW", category: HV, materials: HC, height: "Per manufacturer",
    description: "Electric Shower Unit", svg: (
      <g><Ring cx={24} cy={15} r={9}/>{[[20, 12], [24, 12], [28, 12], [22, 16.5], [26, 16.5], [24, 20]].map(([x, y]) => <Dot key={x + "-" + y} cx={x} cy={y} r={1.1}/>)}{[16, 24, 32].map((x) => <Line key={x} x1={x} y1={28} x2={x - 2} y2={40} dash="2.5 2.5"/>)}</g>
    )},
  { id: "hv_ufh_stat", name: "UFH Thermostat (floor probe)", code: "UFT", category: HV, materials: HC, height: "1500mm AFL",
    description: "Underfloor Heating Thermostat with floor probe", svg: (
      <g><Box x={12} y={5} w={24} h={22} r={3}/><Txt y={21} s={9}>T</Txt><Path d="M 24 27 C 20 31 28 33 24 37 L 24 42" w={FEEDER}/><Line x1={8} y1={43} x2={40} y2={43} feeder dash="3 2"/></g>
    )},
];
