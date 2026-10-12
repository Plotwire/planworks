/* ============================================================================
 * Draft symbols: Fire alarm, Data & comms, Security & access, Care/nurse call.
 * Drawn in-house with lib/symbolKit.jsx to UK layout-drawing conventions:
 * BS 5839-1 style fire alarm devices (call point as a square with a filled
 * centre, detectors as circles lettered by type), nurse call and disabled
 * toilet alarm devices lettered NC / DT.
 * Drafts are hidden from users until approved (see lib/symbolDrafts/index.js).
 * ========================================================================= */

"use client";

import React from "react";
import {
  STROKE, FEEDER, Txt, Ring, Dot, Box, Line, Path, Poly,
  SocketHalf, Arrow, Rays, Speaker, WifiArcs, Waves,
} from "../symbolKit";

const FA = "fire", DC = "data", SA = "security", NC = "care";
const FDA = "Fire detection & alarm", DAV = "Data & AV", SEC = "Security & access", NCC = "Nurse call & care";

// Detector head: a circle lettered by type.
const Detector = ({ label, s }) => {
  const size = s || (label.length > 1 ? 8.5 : 12);
  return <g><Ring r={12}/><Txt y={24 + size * 0.36} s={size}>{label}</Txt></g>;
};

// Lettered plate (panels, modules, controllers).
const Panel = ({ label, s = 8, x = 5, y = 12, w = 38, h = 24 }) => (
  <g><Box x={x} y={y} w={w} h={h} r={1.5}/><Txt y={y + h / 2 + s * 0.36} s={s}>{label}</Txt></g>
);

// Sounder horn, mouth facing right, centred on y = 24.
const Horn = ({ x = 10, w = 18 }) => (
  <Poly pts={`${x},19 ${x + 7},19 ${x + w},11 ${x + w},37 ${x + 7},29 ${x},29`} closed/>
);

// Ceiling pull cord (as the original pull switch draws it) with lettering.
const PullCord = ({ label }) => (
  <g>
    <Dot cx={18} cy={9} r={2.6}/>
    <Line x1={18} y1={9} x2={18} y2={36} w={STROKE}/>
    <Poly pts="14,32 18,38 22,32"/>
    <Txt x={35} y={27} s={9}>{label}</Txt>
  </g>
);

// Wall call / reset plate with lettering and a round button.
const CallPlate = ({ label, button = true, s = 7 }) => (
  <g>
    <Box x={10} y={7} w={28} h={34} r={2.5}/>
    {button && <Ring cx={24} cy={18} r={5}/>}
    {button && <Dot cx={24} cy={18} r={2.2}/>}
    <Txt y={button ? 35 : 28} s={button ? s : s + 3}>{label}</Txt>
  </g>
);

// Over-door light: a dome on the door head, with light rays.
const OverDoor = ({ label }) => (
  <g>
    <Line x1={4} y1={32} x2={44} y2={32} feeder/>
    <Path d="M 14 32 A 10 10 0 0 1 34 32 Z" solid/>
    <Rays cx={24} cy={32} r1={13} r2={17} angles={[200, 235, 270, 305, 340]}/>
    {label && <Txt y={44} s={7}>{label}</Txt>}
  </g>
);

// Handset (door entry / refuge phone) drawn inside a plate.
const Handset = ({ x = 18, y = 12 }) => (
  <Path d={`M ${x} ${y} L ${x + 5} ${y} L ${x + 5} ${y + 4} L ${x + 3} ${y + 5} L ${x + 3} ${y + 15} L ${x + 5} ${y + 16} L ${x + 5} ${y + 20} L ${x} ${y + 20} C ${x - 2} ${y + 14} ${x - 2} ${y + 6} ${x} ${y} Z`} solid/>
);

// CCTV dome: a filled half dome on its mounting line, with a lens.
const Dome = ({ cy = 18 }) => (
  <g>
    <Line x1={8} y1={cy} x2={40} y2={cy}/>
    <Path d={`M 11 ${cy} A 13 13 0 0 0 37 ${cy} Z`} solid/>
    <Ring cx={24} cy={cy + 6} r={3.6} w={FEEDER}/>
  </g>
);

export const SYSTEM_SYMBOLS = [
  /* ---- Fire alarm ---------------------------------------------------------- */
  { id: "fa_mcp", name: "Manual Call Point", code: "MCP", category: FA, materials: FDA, height: "1400mm AFL",
    description: "Fire Alarm Manual Call Point", svg: (
      <g><Box x={11} y={11} w={26} h={26} r={1}/><Dot r={6.5}/></g>
    )},
  { id: "fa_mcp_wp", name: "Manual Call Point (weatherproof)", code: "MCP-WP", category: FA, materials: FDA, height: "1400mm AFL",
    description: "Fire Alarm Manual Call Point, weatherproof IP67", svg: (
      <g><Box x={12} y={5} w={24} h={24} r={1}/><Dot cx={24} cy={17} r={6}/><Txt y={42} s={7}>IP67</Txt></g>
    )},
  { id: "fa_smoke", name: "Optical Smoke Detector", code: "FD-S", category: FA, materials: FDA, height: "Ceiling",
    description: "Optical Smoke Detector (addressable)", svg: <Detector label="S"/> },
  { id: "fa_heat_rr", name: "Heat Detector, Rate of Rise", code: "FD-HR", category: FA, materials: FDA, height: "Ceiling",
    description: "Heat Detector, rate of rise (A1R)", svg: <Detector label="HR"/> },
  { id: "fa_heat_fixed", name: "Heat Detector, Fixed Temperature", code: "FD-HF", category: FA, materials: FDA, height: "Ceiling",
    description: "Heat Detector, fixed temperature (CS)", svg: <Detector label="HF"/> },
  { id: "fa_multi", name: "Multi-Sensor Detector", code: "FD-M", category: FA, materials: FDA, height: "Ceiling",
    description: "Multi-Sensor Detector (optical / heat)", svg: <Detector label="M"/> },
  { id: "fa_beam_tx", name: "Beam Detector, Transmitter", code: "BM-TX", category: FA, materials: FDA, height: "High level",
    description: "Optical Beam Detector, transmitter", svg: (
      <g><Box x={3} y={15} w={13} h={18} r={1}/><Txt x={9.5} y={27} s={6.5}>TX</Txt><Line x1={16} y1={24} x2={40} y2={24} dash="3 2"/><Arrow x1={38} y1={24} x2={45} y2={24} h={3.5}/></g>
    )},
  { id: "fa_beam_rx", name: "Beam Detector, Receiver", code: "BM-RX", category: FA, materials: FDA, height: "High level",
    description: "Optical Beam Detector, receiver", svg: (
      <g><Line x1={3} y1={24} x2={25} y2={24} dash="3 2"/><Arrow x1={24} y1={24} x2={31} y2={24} h={3.5}/><Box x={32} y={15} w={13} h={18} r={1}/><Txt x={38.5} y={27} s={6.5}>RX</Txt></g>
    )},
  { id: "fa_duct", name: "Duct Smoke Detector", code: "FD-D", category: FA, materials: FDA, height: "On duct",
    description: "Duct Smoke Detector (sampling unit)", svg: (
      <g><Line x1={2} y1={12} x2={46} y2={12}/><Line x1={2} y1={36} x2={46} y2={36}/><Ring r={9}/><Txt y={28} s={10}>D</Txt></g>
    )},
  { id: "fa_asd", name: "Aspirating Smoke Detector", code: "ASD", category: FA, materials: FDA, height: "Per location",
    description: "Aspirating Smoke Detection unit", svg: (
      <g><Box x={4} y={20} w={24} h={20} r={1.5}/><Txt x={16} y={33} s={7.5}>ASD</Txt><Line x1={16} y1={20} x2={16} y2={10}/><Line x1={16} y1={10} x2={44} y2={10} w={STROKE}/>{[24, 32, 40].map((x) => <Line key={x} x1={x} y1={10} x2={x} y2={14}/>)}</g>
    )},
  { id: "fa_sounder", name: "Fire Alarm Sounder", code: "SNDR", category: FA, materials: FDA, height: "Wall, 2100mm AFL+",
    description: "Fire Alarm Sounder (electronic)", svg: (
      <g><Horn/><Waves x={30} y={24} n={2} gap={4}/></g>
    )},
  { id: "fa_bell", name: "Fire Alarm Bell", code: "BELL", category: FA, materials: FDA, height: "Wall, 2100mm AFL+",
    description: "Fire Alarm Bell", svg: (
      <g><Path d="M 11 32 A 13 13 0 0 1 37 32 Z"/><Line x1={8} y1={32} x2={40} y2={32} w={STROKE}/><Dot cx={24} cy={37} r={2.6}/><Line x1={24} y1={19} x2={24} y2={13}/></g>
    )},
  { id: "fa_vad", name: "Visual Alarm Device (beacon)", code: "VAD", category: FA, materials: FDA, height: "Wall / ceiling",
    description: "Visual Alarm Device / Beacon (EN 54-23)", svg: (
      <g><Ring r={8}/><Dot r={4}/><Rays r1={11} r2={16} angles={[0, 45, 90, 135, 180, 225, 270, 315]}/></g>
    )},
  { id: "fa_sounder_vad", name: "Sounder Beacon", code: "SB-VAD", category: FA, materials: FDA, height: "Wall, 2100mm AFL+",
    description: "Combined Sounder and Visual Alarm Device", svg: (
      <g><Horn x={6} w={16}/><Dot cx={33} cy={24} r={3.5}/><Rays cx={33} cy={24} r1={6} r2={10} angles={[-60, -20, 20, 60, 90, -90]}/></g>
    )},
  { id: "fa_panel", name: "Fire Alarm Control Panel", code: "FACP", category: FA, materials: FDA, height: "1500mm AFL (eye level)",
    description: "Fire Alarm Control and Indicating Panel", svg: (
      <g><Panel label="FACP"/><Box x={5} y={12} w={6} h={24} r={1} solid/></g>
    )},
  { id: "fa_repeater", name: "Fire Alarm Repeater Panel", code: "FRP", category: FA, materials: FDA, height: "1500mm AFL (eye level)",
    description: "Fire Alarm Repeater Panel", svg: <Panel label="FRP"/> },
  { id: "fa_interface", name: "Input / Output Interface", code: "I/O", category: FA, materials: FDA, height: "Per location",
    description: "Fire Alarm Input / Output Interface Unit", svg: <Panel label="I/O" x={9} y={13} w={30} h={22} s={9}/> },
  { id: "fa_sci", name: "Short-Circuit Isolator", code: "SCI", category: FA, materials: FDA, height: "Per location",
    description: "Loop Short-Circuit Isolator", svg: (
      <g><Line x1={2} y1={24} x2={12} y2={24} feeder/><Line x1={36} y1={24} x2={46} y2={24} feeder/><Panel label="SCI" x={12} y={14} w={24} h={20} s={7.5}/></g>
    )},
  { id: "fa_door_holder", name: "Magnetic Door Holder", code: "DH", category: FA, materials: FDA, height: "Door / wall, high level",
    description: "Electromagnetic Door Holder (releases on alarm)", svg: (
      <g><Box x={6} y={12} w={12} h={24} r={1} solid/><Line x1={21} y1={12} x2={21} y2={36} w={STROKE + 0.5}/><Path d="M 21 24 A 18 18 0 0 1 39 6" w={FEEDER} dash="2.5 2"/><Txt x={35} y={36} s={8}>DH</Txt></g>
    )},
  { id: "fa_flow_switch", name: "Sprinkler Flow Switch", code: "FS", category: FA, materials: FDA, height: "On sprinkler main",
    description: "Sprinkler Flow Switch (monitored)", svg: (
      <g><Line x1={2} y1={30} x2={46} y2={30} w={STROKE + 1}/><Ring cx={24} cy={16} r={9}/><Txt y={19} s={8}>FS</Txt><Line x1={24} y1={25} x2={24} y2={30}/></g>
    )},
  { id: "fa_gas_valve", name: "Gas Shut-Off Valve Interlock", code: "GSV", category: FA, materials: FDA, height: "Per location",
    description: "Gas Solenoid Valve interlock (fire / ventilation)", svg: (
      <g><Poly pts="6,22 24,30 6,38" closed/><Poly pts="42,22 24,30 42,38" closed/><Line x1={24} y1={30} x2={24} y2={18}/><Box x={16} y={6} w={16} h={12} r={1}/><Txt y={15.5} s={7.5}>G</Txt></g>
    )},
  { id: "fa_psu", name: "Fire Alarm Power Supply", code: "PSU", category: FA, materials: FDA, height: "Per location",
    description: "Fire Alarm Power Supply Unit (EN 54-4)", svg: <Panel label="PSU"/> },
  { id: "fa_evc", name: "Refuge EVC Outstation", code: "EVC", category: FA, materials: FDA, height: "1200mm AFL",
    description: "Disabled Refuge Emergency Voice Communication outstation", svg: (
      <g><Box x={8} y={5} w={32} h={38} r={2}/><Handset x={15} y={10}/><Txt x={31} y={22} s={7}>EVC</Txt><Box x={25} y={28} w={11} h={8} r={1} sw={FEEDER}/></g>
    )},
  { id: "fa_vibrating_pad", name: "Vibrating Pad (deaf alerter)", code: "VP", category: FA, materials: FDA, height: "Under pillow / bed",
    description: "Vibrating Pad for deaf / hard of hearing alert", svg: (
      <g><Box x={12} y={14} w={24} h={20} r={3}/><Txt y={27} s={8}>VP</Txt><Path d="M 7 15 L 4 19 L 7 23 L 4 27 L 7 31" w={FEEDER}/><Path d="M 41 15 L 44 19 L 41 23 L 44 27 L 41 31" w={FEEDER}/></g>
    )},
  { id: "fa_remote_led", name: "Remote Indicator", code: "RIL", category: FA, materials: FDA, height: "Above door",
    description: "Detector Remote Indicator LED", svg: (
      <g><Box x={14} y={12} w={20} h={18} r={2}/><Ring cx={24} cy={21} r={4} w={FEEDER}/><Dot cx={24} cy={21} r={1.6}/><Rays cx={24} cy={12} r1={2} r2={6} angles={[225, 270, 315]}/><Txt y={42} s={7.5}>RI</Txt></g>
    )},

  /* ---- Data & comms -------------------------------------------------------- */
  { id: "dc_double", name: "Data Point, Double", code: "D2", category: DC, materials: DAV, height: "450mm AFL",
    description: "Double Data Outlet (Cat6)", svg: (
      <g><SocketHalf cx={14} outline/><SocketHalf cx={34} outline/></g>
    )},
  { id: "dc_quad", name: "Data Point, Quad", code: "D4", category: DC, materials: DAV, height: "450mm AFL",
    description: "Quad Data Outlet (Cat6)", svg: (
      <g><SocketHalf cx={14} outline/><SocketHalf cx={34} outline/><Txt y={40} s={9}>4</Txt></g>
    )},
  { id: "dc_cat6a", name: "Data Point, Cat6A", code: "D6A", category: DC, materials: DAV, height: "450mm AFL",
    description: "Data Outlet, Cat6A", svg: (
      <g><SocketHalf outline/><Txt x={40} y={15} s={7}>6A</Txt></g>
    )},
  { id: "dc_fibre", name: "Fibre Outlet", code: "DF", category: DC, materials: DAV, height: "450mm AFL",
    description: "Fibre Optic Outlet", svg: (
      <g><SocketHalf outline/><Txt x={39} y={15} s={8}>F</Txt></g>
    )},
  { id: "dc_tel", name: "Telephone Outlet", code: "TEL", category: DC, materials: DAV, height: "450mm AFL",
    description: "Telephone Outlet (secondary)", svg: (
      <g><SocketHalf outline/><Txt x={39} y={15} s={8}>T</Txt></g>
    )},
  { id: "dc_wap", name: "Wireless Access Point", code: "WAP", category: DC, materials: DAV, height: "Ceiling",
    description: "Wireless Access Point (Wi-Fi)", svg: (
      <g><Ring r={14}/><WifiArcs cx={24} cy={30}/></g>
    )},
  { id: "dc_nte", name: "Master Socket / NTE", code: "NTE", category: DC, materials: DAV, height: "Per location",
    description: "Openreach Master Socket / Network Terminating Equipment", svg: <Panel label="NTE" x={8} y={13} w={32} h={22}/> },
  { id: "dc_tv_sat", name: "TV / FM / Satellite Outlet", code: "TVS", category: DC, materials: DAV, height: "450mm AFL",
    description: "TV / FM / Satellite Outlet Plate", svg: (
      <g><Box x={4} y={14} w={40} h={20} r={2.5}/><Txt y={27} s={7.5}>TV/SAT</Txt></g>
    )},
  { id: "dc_hdmi", name: "AV / HDMI Outlet", code: "AV", category: DC, materials: DAV, height: "Per location",
    description: "AV / HDMI Wall Outlet", svg: (
      <g><Box x={6} y={14} w={36} h={20} r={2.5}/><Txt y={27} s={7.5}>HDMI</Txt></g>
    )},
  { id: "dc_spk_ceiling", name: "Ceiling Speaker", code: "SPK-C", category: DC, materials: DAV, height: "Ceiling",
    description: "Ceiling Speaker", svg: (
      <g><Ring r={14}/><Speaker x={16} y={18}/></g>
    )},
  { id: "dc_spk_wall", name: "Wall Speaker", code: "SPK-W", category: DC, materials: DAV, height: "High level",
    description: "Wall-mounted Speaker", svg: (
      <g><Line x1={8} y1={6} x2={8} y2={42} feeder/><Speaker x={12} y={18}/><Waves x={27} y={24} n={2} gap={4}/></g>
    )},
  { id: "dc_vol", name: "Volume Control", code: "VOL", category: DC, materials: DAV, height: "1200mm AFL",
    description: "Audio Volume Control", svg: (
      <g><Box x={10} y={10} w={28} h={28} r={2.5}/><Ring r={7}/><Line x1={24} y1={24} x2={24} y2={18} w={STROKE}/><Path d="M 15 33 A 12 12 0 0 1 13 20" w={FEEDER}/></g>
    )},
  { id: "dc_cabinet", name: "Comms Cabinet / Rack", code: "RACK", category: DC, materials: DAV, height: "Floor / wall",
    description: "Data Communications Cabinet / Rack", svg: (
      <g><Box x={11} y={4} w={26} h={40} r={1.5}/>{[11, 17, 23, 29, 35].map((y) => <Line key={y} x1={14} y1={y} x2={34} y2={y}/>)}</g>
    )},
  { id: "dc_patch", name: "Patch Panel", code: "PPN", category: DC, materials: DAV, height: "In cabinet",
    description: "Data Patch Panel", svg: (
      <g><Box x={2} y={17} w={44} h={14} r={1}/>{[7, 12.5, 18, 23.5, 29, 34.5, 40].map((x) => <Box key={x} x={x - 1.8} y={21.5} w={3.6} h={5} r={0.4} sw={FEEDER * 0.8}/>)}</g>
    )},
  { id: "dc_aerial", name: "TV Aerial", code: "AER", category: DC, materials: DAV, height: "Roof / loft",
    description: "TV Aerial", svg: (
      <g><Line x1={24} y1={14} x2={24} y2={44} w={STROKE}/><Line x1={6} y1={14} x2={42} y2={14} w={STROKE}/>{[10, 17, 31, 38].map((x) => <Line key={x} x1={x} y1={7} x2={x} y2={21}/>)}</g>
    )},
  { id: "dc_dish", name: "Satellite Dish", code: "DSH", category: DC, materials: DAV, height: "External wall / roof",
    description: "Satellite Dish", svg: (
      <g><Path d="M 10 8 A 20 20 0 0 0 26 40 Z"/><Line x1={18} y1={24} x2={36} y2={16}/><Box x={35} y={12} w={6} h={7} r={1} solid/><Line x1={18} y1={30} x2={18} y2={44} w={STROKE}/></g>
    )},
  { id: "dc_hearing_loop", name: "Hearing (Induction) Loop", code: "IL", category: DC, materials: DAV, height: "Reception / counter",
    description: "Audio Frequency Induction Loop (hearing loop)", svg: (
      <g><Ring r={14} dash="3 2"/><Txt y={28} s={11}>T</Txt></g>
    )},

  /* ---- Security & access -------------------------------------------------- */
  { id: "sa_entry_panel", name: "Door Entry Panel (audio)", code: "DEP", category: SA, materials: SEC, height: "1400mm AFL",
    description: "Door Entry Panel, audio", svg: (
      <g><Box x={12} y={4} w={24} h={40} r={2}/>{[10, 13.5, 17].map((y) => <Line key={y} x1={17} y1={y} x2={31} y2={y}/>)}<Ring cx={24} cy={30} r={4}/><Dot cx={24} cy={30} r={1.6}/></g>
    )},
  { id: "sa_entry_video", name: "Door Entry Panel (video)", code: "DEP-V", category: SA, materials: SEC, height: "1400mm AFL",
    description: "Door Entry Panel, video", svg: (
      <g><Box x={12} y={4} w={24} h={40} r={2}/><Ring cx={24} cy={12} r={4}/><Dot cx={24} cy={12} r={1.8}/>{[21, 24.5].map((y) => <Line key={y} x1={17} y1={y} x2={31} y2={y}/>)}<Ring cx={24} cy={34} r={3.5}/></g>
    )},
  { id: "sa_handset", name: "Door Entry Handset", code: "DEH", category: SA, materials: SEC, height: "1400mm AFL",
    description: "Door Entry Handset (indoor)", svg: (
      <g><Box x={10} y={6} w={28} h={36} r={2}/><Handset x={17} y={11}/><Dot cx={31} cy={20} r={1.8}/><Dot cx={31} cy={27} r={1.8}/></g>
    )},
  { id: "sa_monitor", name: "Video Entry Monitor", code: "DEM", category: SA, materials: SEC, height: "1400mm AFL",
    description: "Video Door Entry Monitor (indoor)", svg: (
      <g><Box x={6} y={8} w={36} h={30} r={2}/><Box x={10} y={12} w={21} h={16} r={0.5} sw={FEEDER}/>{[15, 22, 29].map((y) => <Dot key={y} cx={36.5} cy={y} r={1.6}/>)}</g>
    )},
  { id: "sa_reader", name: "Access Control Reader", code: "ACR", category: SA, materials: SEC, height: "1100mm AFL",
    description: "Access Control Card / Proximity Reader", svg: (
      <g><Box x={10} y={8} w={18} h={32} r={2}/><Box x={14} y={14} w={10} h={6} r={1} sw={FEEDER}/><Waves x={28} y={24} n={3} gap={3}/></g>
    )},
  { id: "sa_keypad_access", name: "Access Control Keypad", code: "AKP", category: SA, materials: SEC, height: "1100mm AFL",
    description: "Access Control Keypad", svg: (
      <g><Box x={13} y={5} w={22} h={38} r={2}/>{[11, 18, 25, 32].map((y) => [19, 24, 29].map((x) => <Dot key={x + "-" + y} cx={x} cy={y} r={1.4}/>))}<Line x1={17} y1={38} x2={31} y2={38}/></g>
    )},
  { id: "sa_maglock", name: "Magnetic Lock", code: "MAG", category: SA, materials: SEC, height: "Door head",
    description: "Electromagnetic Door Lock (fail-safe)", svg: (
      <g><Box x={3} y={17} w={26} h={14} r={1} solid/><Box x={32} y={17} w={13} h={14} r={1}/><Txt x={16} y={27} s={8} fill="#ffffff">M</Txt></g>
    )},
  { id: "sa_strike", name: "Electric Strike / Release", code: "ESR", category: SA, materials: SEC, height: "Door frame",
    description: "Electric Strike / Door Release", svg: (
      <g><Line x1={10} y1={4} x2={10} y2={44} w={STROKE}/><Box x={10} y={14} w={14} h={20} r={1}/><Path d="M 24 20 L 30 20 L 30 28 L 24 28" w={FEEDER}/><Txt x={37} y={27} s={7}>ES</Txt></g>
    )},
  { id: "sa_rex", name: "Request-to-Exit Button", code: "REX", category: SA, materials: SEC, height: "1100mm AFL",
    description: "Request-to-Exit (push to exit) Button", svg: (
      <g><Box x={10} y={10} w={28} h={28} r={2}/><Ring r={9.5} w={FEEDER}/><Txt y={26.2} s={6}>EXIT</Txt></g>
    )},
  { id: "sa_door_release", name: "Emergency Door Release (green)", code: "BGU", category: SA, materials: SEC, height: "1100mm AFL",
    description: "Emergency Door Release, green break-glass", svg: (
      <g><Box x={10} y={10} w={28} h={28} r={1}/><Line x1={10} y1={38} x2={38} y2={10}/><Line x1={18} y1={38} x2={38} y2={18}/><Txt x={18} y={21} s={7.5}>DR</Txt></g>
    )},
  { id: "sa_dual_tech", name: "Dual-Technology Detector", code: "DT", category: SA, materials: SEC, height: "2100mm AFL",
    description: "Dual-Technology (PIR / microwave) Intruder Detector", svg: (
      <g><Path d="M 12 12 L 38 24 L 12 36 Z" solid/><Txt x={21} y={26.5} s={7} fill="#ffffff">DT</Txt></g>
    )},
  { id: "sa_panic", name: "Panic / Personal Attack Button", code: "PA", category: SA, materials: SEC, height: "Under desk / per location",
    description: "Personal Attack (panic) Button", svg: (
      <g><Ring r={12}/><Txt y={27} s={9}>PA</Txt></g>
    )},
  { id: "sa_glassbreak", name: "Glass Break Detector", code: "GBD", category: SA, materials: SEC, height: "Ceiling / wall",
    description: "Acoustic Glass Break Detector", svg: (
      <g><Ring r={12}/><Txt y={27} s={9}>GB</Txt><Path d="M 33 7 L 37 12 L 34 14 L 40 20" w={FEEDER}/></g>
    )},
  { id: "sa_cctv_dome", name: "CCTV Dome Camera", code: "CCTV-D", category: SA, materials: SEC, height: "Ceiling / soffit",
    description: "CCTV Dome Camera", svg: <Dome/> },
  { id: "sa_cctv_bullet", name: "CCTV Bullet Camera", code: "CCTV-B", category: SA, materials: SEC, height: "2400mm AFL",
    description: "CCTV Bullet Camera", svg: (
      <g><Line x1={6} y1={6} x2={6} y2={42} feeder/><Line x1={6} y1={30} x2={14} y2={30} w={STROKE}/><Line x1={14} y1={30} x2={18} y2={24} w={STROKE}/><Box x={14} y={14} w={22} h={10} r={2} solid/><Box x={36} y={15.5} w={5} h={7} r={1}/></g>
    )},
  { id: "sa_cctv_ptz", name: "CCTV PTZ Camera", code: "PTZ", category: SA, materials: SEC, height: "High level / column",
    description: "CCTV Pan-Tilt-Zoom Camera", svg: (
      <g><Dome cy={14}/><Path d="M 6 36 A 22 22 0 0 0 42 36" w={FEEDER}/><Arrow x1={14} y1={41} x2={7} y2={37} h={3}/><Arrow x1={34} y1={41} x2={41} y2={37} h={3}/></g>
    )},
  { id: "sa_nvr", name: "CCTV Recorder (NVR)", code: "NVR", category: SA, materials: SEC, height: "In cabinet",
    description: "CCTV Network Video Recorder", svg: <Panel label="NVR"/> },
  { id: "sa_ext_beam", name: "External Beam Detector Pair", code: "XB", category: SA, materials: SEC, height: "External",
    description: "External Active Infrared Beam (transmitter / receiver)", svg: (
      <g><Box x={3} y={16} w={9} h={16} r={1} solid/><Box x={36} y={16} w={9} h={16} r={1} solid/><Line x1={12} y1={21} x2={36} y2={21} dash="3 2"/><Line x1={12} y1={27} x2={36} y2={27} dash="3 2"/></g>
    )},
  { id: "sa_gate", name: "Gate Motor / Automation", code: "GTE", category: SA, materials: SEC, height: "External",
    description: "Automated Gate Motor", svg: (
      <g><Ring cx={11} cy={30} r={7}/><Txt x={11} y={33} s={7}>M</Txt><Line x1={18} y1={30} x2={44} y2={30} w={STROKE}/><Path d="M 22 30 A 22 22 0 0 1 40 12" w={FEEDER} dash="2.5 2"/></g>
    )},
  { id: "sa_barrier", name: "Rising Arm Barrier", code: "BAR", category: SA, materials: SEC, height: "External",
    description: "Rising Arm Vehicle Barrier", svg: (
      <g><Box x={3} y={20} w={10} h={18} r={1}/><Box x={13} y={24} w={32} h={5} r={1}/>{[20, 28, 36].map((x) => <Line key={x} x1={x} y1={24} x2={x + 4} y2={29}/>)}</g>
    )},
  { id: "sa_video_bell", name: "Video Doorbell", code: "VDB", category: SA, materials: SEC, height: "1400mm AFL",
    description: "Video Doorbell", svg: (
      <g><Box x={15} y={4} w={18} h={40} r={6}/><Ring cx={24} cy={13} r={3.5}/><Dot cx={24} cy={13} r={1.4}/><Ring cx={24} cy={32} r={5}/></g>
    )},

  /* ---- Care / nurse call -------------------------------------------------- */
  { id: "nc_call", name: "Nurse Call Point", code: "NCP", category: NC, materials: NCC, height: "Bedside / 1200mm AFL",
    description: "Nurse Call Point (patient)", svg: <CallPlate label="NC"/> },
  { id: "nc_call_lead", name: "Nurse Call Point with Pear Lead", code: "NCL", category: NC, materials: NCC, height: "Bedside",
    description: "Nurse Call Point with pear-lead socket and lead", svg: (
      <g><CallPlate label="NC"/><Path d="M 38 32 C 44 34 44 40 38 42 C 34 43 32 45 34 47" w={FEEDER}/></g>
    )},
  { id: "nc_pear_socket", name: "Pear Lead Socket", code: "PLS", category: NC, materials: NCC, height: "Bedside",
    description: "Nurse Call Pear-lead Socket", svg: (
      <g><Ring r={10}/><Ring r={4.5} w={FEEDER}/><Dot r={1.6}/><Txt y={44} s={7}>PL</Txt></g>
    )},
  { id: "nc_bed_head", name: "Bed Head Unit", code: "BHU", category: NC, materials: NCC, height: "Above bed head",
    description: "Bed Head Services Unit (call, light, sockets)", svg: (
      <g><Box x={2} y={14} w={44} h={20} r={2}/><Txt x={17} y={27} s={8}>BHU</Txt><SocketHalf cx={37} base={29} r={5}/></g>
    )},
  { id: "nc_pull", name: "Nurse Call Pull Cord", code: "NPC", category: NC, materials: NCC, height: "Ceiling (cord to 100mm AFL)",
    description: "Nurse Call Ceiling Pull Cord (toilet / bathroom)", svg: <PullCord label="NC"/> },
  { id: "nc_overdoor", name: "Over-Door Light", code: "ODL", category: NC, materials: NCC, height: "Over door, corridor side",
    description: "Nurse Call Over-Door Light", svg: <OverDoor/> },
  { id: "nc_overdoor_sounder", name: "Over-Door Light with Sounder", code: "ODL-S", category: NC, materials: NCC, height: "Over door, corridor side",
    description: "Nurse Call Over-Door Light with sounder", svg: <OverDoor label="SNDR"/> },
  { id: "nc_reset", name: "Nurse Call Reset", code: "RST", category: NC, materials: NCC, height: "Inside door, 1200mm AFL",
    description: "Nurse Call Reset / Cancel (presence) Unit", svg: <CallPlate label="R" button={false}/> },
  { id: "nc_attack", name: "Staff Attack Button", code: "SAB", category: NC, materials: NCC, height: "1200mm AFL",
    description: "Staff Attack / Emergency Assistance Button", svg: <CallPlate label="SA"/> },
  { id: "nc_emergency", name: "Emergency Call Point (red)", code: "ECP", category: NC, materials: NCC, height: "1200mm AFL",
    description: "Nurse Call Emergency Call Point", svg: <CallPlate label="EM"/> },
  { id: "nc_display", name: "Corridor Display", code: "NCD", category: NC, materials: NCC, height: "Corridor, high level",
    description: "Nurse Call Corridor Display Panel", svg: (
      <g><Box x={2} y={12} w={44} h={24} r={2}/><Box x={6} y={16} w={36} h={10} r={0.5} sw={FEEDER}/><Line x1={9} y1={21} x2={33} y2={21}/><Txt y={34} s={6}>NC DISPLAY</Txt></g>
    )},
  { id: "nc_controller", name: "Nurse Call Controller", code: "NCC", category: NC, materials: NCC, height: "Per location",
    description: "Nurse Call Controller / Power Supply", svg: <Panel label="NCC"/> },
  { id: "nc_pager", name: "Pager / Radio Transmitter", code: "PGR", category: NC, materials: NCC, height: "Per location",
    description: "Nurse Call Pager / Radio Transmitter", svg: (
      <g><Box x={8} y={18} w={26} h={22} r={2}/><Txt x={21} y={32} s={7.5}>PGR</Txt><Line x1={28} y1={18} x2={28} y2={7} w={STROKE}/><Waves x={30} y={9} n={2} gap={3}/></g>
    )},
  { id: "nc_dta_pull", name: "Disabled Toilet Alarm, Pull Cord", code: "DTA-P", category: NC, materials: NCC, height: "Ceiling (cord to 100mm AFL)",
    description: "Disabled Toilet Alarm, ceiling pull cord (red cord)", svg: <PullCord label="DT"/> },
  { id: "nc_dta_reset", name: "Disabled Toilet Alarm, Reset", code: "DTA-R", category: NC, materials: NCC, height: "Inside, 800–1000mm AFL",
    description: "Disabled Toilet Alarm, reset button", svg: (
      <g><CallPlate label="R" button={false}/><Txt y={38} s={6.5}>DT</Txt></g>
    )},
  { id: "nc_dta_indicator", name: "Disabled Toilet Alarm, Indicator", code: "DTA-I", category: NC, materials: NCC, height: "Over door, outside",
    description: "Disabled Toilet Alarm, over-door light and sounder", svg: <OverDoor label="DT"/> },
  { id: "nc_dta_control", name: "Disabled Toilet Alarm, Control Unit", code: "DTA-C", category: NC, materials: NCC, height: "Per location",
    description: "Disabled Toilet Alarm, control unit", svg: <Panel label="DTA"/> },
  { id: "nc_door_monitor", name: "Door Exit Monitor", code: "DMN", category: NC, materials: NCC, height: "Door frame",
    description: "Door Exit Monitor (wander alert)", svg: (
      <g><Box x={5} y={12} w={16} h={8} r={0} solid/><Box x={27} y={12} w={16} h={8} r={0}/><Line x1={21} y1={16} x2={27} y2={16} dash="1 1"/><Txt y={38} s={9}>NC</Txt></g>
    )},
  { id: "nc_pressure_mat", name: "Bed / Chair Pressure Mat", code: "MAT", category: NC, materials: NCC, height: "Floor / bed",
    description: "Bed or Chair Pressure Mat sensor", svg: (
      <g><Box x={4} y={12} w={40} h={24} r={2} dash="3 2"/><Txt y={27.5} s={9}>MAT</Txt></g>
    )},
  { id: "nc_care_pir", name: "Care PIR (bed / room exit)", code: "CPIR", category: NC, materials: NCC, height: "Per location",
    description: "Care PIR sensor (bed or room exit alert)", svg: (
      <g><Path d="M 12 12 L 38 24 L 12 36 Z"/><Txt x={21} y={27} s={7}>NC</Txt></g>
    )},
  { id: "nc_dome", name: "Corridor Dome Light", code: "DOM", category: NC, materials: NCC, height: "Corridor ceiling",
    description: "Nurse Call Corridor Dome Light (multi-colour)", svg: (
      <g><Ring r={12}/><Line x1={24} y1={12} x2={24} y2={36}/><Line x1={12} y1={24} x2={36} y2={24}/><Path d="M 24 24 L 24 12 A 12 12 0 0 1 36 24 Z" solid/></g>
    )},
];
