/* ============================================================================
 * symbolLibrary.js -- which symbols an account's editor picker offers.
 *
 * The account ticks symbols on the Symbol Library page; the ticks are saved in
 * its settings (user_settings.data.symbolLibrary = { picks: [ids], v: 1 }).
 * An account that has never saved any gets the Domestic starter: exactly the
 * set the picker has always shown, in the same groups and order.
 *
 * Ticks only decide what the PICKER offers. A symbol already on a drawing is
 * looked up in the whole catalogue (findSymbol), so it still shows, prints,
 * exports and counts whether or not it is ticked. Draft symbols (drawn, not
 * yet approved) are never offered.
 * ========================================================================= */

import { CATALOGUE, LIBRARY_CATEGORIES, PALETTE_GROUPS, SYMBOL_META, findSymbol } from "./symbols";

// The picker's set before the library existed: its groups, in its order.
export const DOMESTIC_STARTER = PALETTE_GROUPS.flatMap((g) => g.ids);

// Symbols the library offers (approved only; drafts with { drafts: true }).
export function librarySymbols({ drafts = false } = {}) {
  return CATALOGUE.filter((s) => drafts || !s.draft);
}

const offered = () => new Set(librarySymbols().map((s) => s.id));
const inCategory = (...keys) => CATALOGUE.filter((s) => keys.includes(s.category)).map((s) => s.id);

/* ---- Presets ---------------------------------------------------------------
 * Each lists symbol ids; any not yet approved (drafts) are left out when the
 * preset is applied, so a preset fills out as new symbols are approved.
 * -------------------------------------------------------------------------- */
const COMMERCIAL = [
  // Power
  "sock_dso_ll", "sock_sso_ll", "sock_dso_hl", "sock_dso_usb_ll", "sock_fcu", "spur_unsw", "iso_dp", "iso_rotary", "fx_isolator",
  "pw_dso_rcd", "pw_dso_clean", "pw_dso_ups", "pw_floorbox", "pw_dado", "pw_ind_16", "pw_ind_32_3p", "pw_fcu_neon", "pw_dp20_neon", "pw_hand_dryer",
  // Switching
  "sw_light", "sw_2g", "sw_3g", "sw_4g", "sw_2way", "sw_intermediate", "sw_grid", "sw_pir_light",
  "sc_key_1g", "sc_key_2g", "sc_presence", "sc_timeclock", "sc_photocell", "sc_scene", "sc_lcm", "sc_contactor", "sc_retractive",
  // Lighting
  "lt_downlight", "lt_2d", "lt_batten", "lt_strip",
  "lg_panel_600", "lg_panel_1200", "lg_linear", "lg_linear_recessed", "lg_linear_susp", "lg_highbay", "lg_track", "lg_ip65_batten", "lg_downlight_fr",
  // Emergency and external
  "lt_emergency", "em_nm", "em_m", "em_downlight", "em_twin_spot", "em_bulkhead", "em_exit_l", "em_exit_r", "em_exit_d", "em_exit_ds", "em_test_key", "em_central",
  "lt_external", "ex_bulkhead", "ex_bulkhead_pir", "ex_flood", "ex_bollard", "ex_column",
  // Fire alarm
  "fa_mcp", "fa_smoke", "fa_heat_rr", "fa_multi", "fa_sounder", "fa_vad", "fa_sounder_vad", "fa_panel", "fa_interface", "fa_door_holder",
  // Data, security, HVAC, EV, distribution
  "data_point", "sock_tv", "dc_double", "dc_wap", "dc_cabinet", "dc_patch",
  "sec_pir", "sec_cctv", "sec_keypad", "sa_reader", "sa_maglock", "sa_rex", "sa_door_release", "sa_entry_panel",
  "fx_extractor", "hv_ac_cassette", "hv_ac_outdoor", "hv_air_curtain", "hv_water_heater",
  "ev_charger", "ev_22kw", "ev_twin",
  "fx_consumer", "db_spn", "db_tpn", "db_switch_fuse", "db_met", "db_spd", "db_meter_ct", "db_submeter",
];

const CARE = [
  "sock_dso_ll", "sock_sso_ll", "sock_dso_hl", "sock_fcu", "spur_unsw", "iso_dp", "sock_shaver", "sock_tv", "data_point",
  "sw_light", "sw_2g", "sw_2way", "sw_pull", "sw_pir_light", "sc_key_1g",
  "lt_downlight", "lt_downlight_ip", "lt_pendant", "lt_wall", "lt_2d", "lg_panel_600", "lg_mirror", "lg_bulkhead",
  "lt_emergency", "em_nm", "em_m", "em_exit_l", "em_exit_r", "em_exit_d",
  "fa_mcp", "fa_smoke", "fa_heat_rr", "fa_sounder_vad", "fa_panel", "fa_door_holder", "fa_vibrating_pad",
  "fx_extractor", "ht_towel", "hv_shower",
  "sa_entry_panel", "sa_reader", "sa_maglock", "sa_door_release",
  ...inCategory("care"),
];

export const PRESETS = [
  { key: "domestic",   label: "Domestic starter", ids: DOMESTIC_STARTER },
  { key: "commercial", label: "Commercial",       ids: COMMERCIAL },
  { key: "fire",       label: "Fire alarm",       ids: inCategory("fire") },
  { key: "care",       label: "Care home",        ids: CARE },
];

// A preset's ids that can be ticked now (approved, known, no repeats).
export function presetPicks(key) {
  const p = PRESETS.find((x) => x.key === key);
  if (!p) return [];
  const ok = offered();
  return [...new Set(p.ids)].filter((id) => ok.has(id));
}

// Everything that can be ticked.
export const allPicks = () => librarySymbols().map((s) => s.id);

/* ---- An account's picks -----------------------------------------------------
 * saved: what user_settings.data.symbolLibrary holds (or undefined).
 * Returns the ids its picker offers. Never saved -> the Domestic starter.
 * Saved ids that are no longer offered are dropped (they still draw wherever
 * they are already used).
 * -------------------------------------------------------------------------- */
export function picksFromSettings(saved) {
  if (!saved || !Array.isArray(saved.picks)) return DOMESTIC_STARTER.slice();
  const ok = offered();
  return [...new Set(saved.picks)].filter((id) => typeof id === "string" && ok.has(id));
}

export { settingsFromPicks } from "./symbolPicks";

/* ---- The editor picker's groups ---------------------------------------------
 * The original picker groups first, in their order, holding whichever of their
 * symbols are ticked; then every other ticked symbol under its library
 * category (in the group of the same name if there is one, e.g. Lighting).
 * With the Domestic starter this is exactly the picker as it has always been.
 * Returns [{ label, items: [{ sym, meta, category }] }], empty groups left out.
 * -------------------------------------------------------------------------- */
export function pickerGroups(picks) {
  const want = new Set(picks || DOMESTIC_STARTER);
  const item = (id) => {
    const sym = findSymbol(id);
    return sym && !sym.draft ? { sym, meta: SYMBOL_META[id] || {}, category: sym.category } : null;
  };
  const groups = PALETTE_GROUPS.map((g) => ({ label: g.label, items: g.ids.filter((id) => want.has(id)).map(item).filter(Boolean) }));
  const placed = new Set(PALETTE_GROUPS.flatMap((g) => g.ids));
  for (const cat of LIBRARY_CATEGORIES) {
    const extra = CATALOGUE.filter((s) => s.category === cat.key && want.has(s.id) && !placed.has(s.id)).map((s) => item(s.id)).filter(Boolean);
    if (!extra.length) continue;
    const same = groups.find((g) => g.label === cat.label);
    if (same) same.items.push(...extra);
    else groups.push({ label: cat.label, items: extra });
  }
  return groups.filter((g) => g.items.length);
}
