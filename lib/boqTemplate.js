// ============================================================================
// BOQ TEMPLATE — "Electrical Bill of Quantities".
// Sectioned, editable pricing schedule. Second Fix quantities are auto-filled
// from the layout drawing; everything is editable and saved with the project.
// ============================================================================

export const BOQ_VAT_RATE = 20;

export const BOQ_TEMPLATE = [
  {
    key: "firstfix",
    title: "First Fix",
    items: [
      { item: "1.0mm\u00B2 twin & earth", spec: "BS 6004, grey" },
      { item: "1mm\u00B2 3 core", spec: "BS 6004, grey" },
      { item: "2.5mm\u00B2 twin & earth", spec: "BS 6004, grey" },
      { item: "4.0mm\u00B2 twin & earth", spec: "BS 6004, grey" },
      { item: "6.0mm\u00B2 twin & earth", spec: "BS 6004, grey" },
      { item: "Coax", spec: "Single" },
      { item: "25mm\u00B2 meter tails", spec: "6181Y, single core, brown/blue" },
      { item: "25mm\u00B2 SWA + internal gland pack", spec: "3-core" },
      { item: "1.5mm\u00B2 cable clips", spec: "Round band, white" },
      { item: "2.5mm\u00B2 cable clips", spec: "Round band, white" },
      { item: "4\u20136mm\u00B2 cable clips", spec: "Round band, white" },
      { item: "10mm\u00B2 cable clips", spec: "Round band, white" },
      { item: "25mm back boxes", spec: "Galvanised steel, 1G & 2G as required" },
      { item: "35mm Fast-Fix back boxes", spec: "Dry-lining / plasterboard, 1G & 2G as required" },
      { item: "Cable ties", spec: "Assorted lengths, black/white" },
      { item: "Round band", spec: "Round band cable clips, assorted sizes" },
      { item: "20mm grommets", spec: "Open / closed rubber grommets" },
      { item: "1\u00BD\" screws with plugs", spec: "Red plugs" },
      { item: "Flexicon conduit", spec: "20mm flexible nylon conduit" },
    ],
  },
  {
    key: "secondfix",
    title: "Second Fix",
    subtitle: "Quantities from layout drawing",
    items: [
      { item: "Fused spurs", spec: "White \u2013 Click Mode", sf: "fused_spur" },
      { item: "Single sockets", spec: "White \u2013 Click Mode", sf: "single_socket" },
      { item: "Double sockets", spec: "White \u2013 Click Mode", sf: "double_socket" },
      { item: "Double sockets with USB", spec: "White \u2013 Click Mode", sf: "double_socket_usb" },
      { item: "External sockets", spec: "Grey \u2013 Click Mode", sf: "external_socket" },
      { item: "TV points", spec: "White \u2013 Click Mode", sf: "tv_point" },
      { item: "Data points", spec: "White \u2013 Click Mode", sf: "data_point" },
      { item: "Shaver points", spec: "White \u2013 Click Mode", sf: "shaver" },
      { item: "1 gang light switch", spec: "White \u2013 Click Mode", sf: "sw_1g" },
      { item: "2 gang light switch", spec: "White \u2013 Click Mode", sf: "sw_2g" },
      { item: "3 gang light switch", spec: "White \u2013 Click Mode", sf: "sw_3g" },
      { item: "4 gang light switch", spec: "White \u2013 Click Mode", sf: "sw_4g" },
      { item: "2-way light switch", spec: "White \u2013 Click Mode", sf: "sw_2way" },
      { item: "Intermediate light switch", spec: "White \u2013 Click Mode", sf: "sw_int" },
      { item: "Dimmer switch", spec: "LED trailing-edge \u2013 White", sf: "sw_dimmer" },
      { item: "Pull cord switch", spec: "Ceiling pull \u2013 White", sf: "sw_pull" },
      { item: "PIR lighting sensor", spec: "Ceiling presence detector", sf: "pir" },
      { item: "Keycard switch", spec: "White \u2013 Click Mode", sf: "keycard" },
      { item: "Grid switches", spec: "Brushed chrome \u2013 Click", sf: "grid" },
      { item: "20A double-pole switches", spec: "White \u2013 Click Mode", sf: "dp_20a" },
      { item: "Fan isolators", spec: "Fused fan isolator \u2013 White", sf: "fan_iso" },
      { item: "32A rotary isolator", spec: "4-pole rotary isolator IP65", sf: "rotary" },
      { item: "EV charge point", spec: "7.4kW single-phase", sf: "ev" },
      { item: "Pendants", spec: "6\" white pendant / batten holder", sf: "pendant" },
      { item: "Downlights", spec: "JCC X50 \u2013 white bezel", sf: "downlight" },
      { item: "External up & down lights", spec: "Dawn/Dusk \u2013 GU10 warm white", sf: "ext_updown" },
      { item: "Smoke detectors", spec: "AICO \u2013 10 year / 230v", sf: "smoke" },
      { item: "Heat detectors", spec: "AICO \u2013 10 year / 230v", sf: "heat" },
    ],
  },
  {
    key: "consumerunit",
    title: "Consumer Unit",
    items: [
      { item: "Consumer unit", spec: "Elucian 16-way + SPD \u2013 RCBO" },
      { item: "6A MCB / RCBO", spec: "RCBO" },
      { item: "10A MCB / RCBO", spec: "RCBO" },
      { item: "16A MCB / RCBO", spec: "RCBO" },
      { item: "20A MCB / RCBO", spec: "RCBO" },
      { item: "32A MCB / RCBO", spec: "RCBO" },
      { item: "40A MCB / RCBO", spec: "RCBO" },
      { item: "100A SP & N fused switch", spec: "Fusebox" },
    ],
  },
  {
    key: "ducting",
    title: "Ducting",
    items: [
      { item: "4\" solid ducting", spec: "100mm rigid round duct" },
      { item: "5\" solid ducting", spec: "125mm rigid round duct" },
      { item: "4\" couplers", spec: "100mm round duct connector" },
      { item: "4\" 90\u00B0 bends", spec: "100mm round 90\u00B0 bend" },
      { item: "4\" 45\u00B0 bends", spec: "100mm round 45\u00B0 bend" },
      { item: "5\" couplers", spec: "125mm round duct connector" },
      { item: "5\" 90\u00B0 bends", spec: "125mm round 90\u00B0 bend" },
      { item: "5\" 45\u00B0 bends", spec: "125mm round 45\u00B0 bend" },
      { item: "4\" fixed grille", spec: "100mm external wall grille" },
      { item: "5\" grille", spec: "125mm external wall grille" },
    ],
  },
];

export const BOQ_SUPPLIER_NOTES = [
  "All prices ex-VAT, in GBP, to include delivery to site unless stated.",
  "Goods to comply with BS 7671:2018+A2:2022 (18th Edition) and current British Standards.",
  "Where \u201CTBC\u201D is shown, please quote your equivalent product and confirm lead time.",
  "Quote to remain valid for a minimum of 30 days.",
  "Second Fix quantities are taken from the electrical layout drawing; remaining sections to be completed and confirmed per plot prior to order.",
];

// Which symbol IDs feed each Second Fix line's quantity.
export const SECONDFIX_SYMBOLS = {
  fused_spur: ["sock_fcu", "spur_unsw"],
  single_socket: ["sock_sso_ll", "sock_sso_hl"],
  double_socket: ["sock_dso_ll", "sock_dso_hl"],
  double_socket_usb: ["sock_dso_usb_ll", "sock_dso_usb_hl"],
  external_socket: [],
  tv_point: ["sock_tv"],
  data_point: ["data_point", "data_internet", "data_ont"],
  shaver: ["sock_shaver"],
  sw_1g: ["sw_light"],
  sw_2g: ["sw_2g"],
  sw_3g: ["sw_3g"],
  sw_4g: ["sw_4g"],
  sw_2way: [],
  sw_int: [],
  sw_dimmer: [],
  sw_pull: [],
  pir: ["sec_pir"],
  keycard: [],
  grid: ["sw_grid"],
  dp_20a: ["iso_dp"],
  fan_iso: ["fx_isolator"],
  rotary: ["iso_rotary"],
  ev: ["ev_charger"],
  pendant: ["lt_pendant", "lt_batten"],
  downlight: ["lt_downlight", "lt_downlight_ip"],
  ext_updown: ["lt_external_updown"],
  smoke: ["det_smoke"],
  heat: ["det_heat"],
};

let _bid = 0;
const rid = () => "b" + (++_bid).toString(36) + Math.random().toString(36).slice(2, 6);

function placedOf(project) {
  return project.sheets ? project.sheets.flatMap(s => s.placed || []) : (project.placed || []);
}

function countSymbols(placed) {
  const counts = {};
  (placed || []).forEach(p => { counts[p.symbolId] = (counts[p.symbolId] || 0) + 1; });
  return counts;
}

function secondFixQtys(counts) {
  const out = {};
  for (const [key, ids] of Object.entries(SECONDFIX_SYMBOLS)) {
    const n = ids.reduce((s, id) => s + (counts[id] || 0), 0);
    if (n > 0) out[key] = n;
  }
  return out;
}

// Build a fresh, fully-editable BOQ from the template + the current drawing.
// `template` lets the user's saved preset sections override the built-in ones.
export function buildInitialBoq(project, SYMBOL_META, findSymbol, template) {
  const tpl = (template && template.length) ? template : BOQ_TEMPLATE;
  const meta = project.meta || {};
  const counts = countSymbols(placedOf(project));
  const sfq = secondFixQtys(counts);
  const mapped = new Set(Object.values(SECONDFIX_SYMBOLS).flat());
  const additional = Object.entries(counts)
    .filter(([id]) => !mapped.has(id))
    .map(([id, qty]) => {
      const m = SYMBOL_META[id] || {};
      const sym = findSymbol ? findSymbol(id) : null;
      return {
        id: rid(),
        symbolId: id,
        item: m.description || sym?.name || id,
        spec: m.height && m.height !== "\u2014" ? m.height : "",
        qty, rate: 0, sf: null, fromDrawing: true,
      };
    })
    .sort((a, b) => a.item.localeCompare(b.item));

  const sections = tpl.map(sec => {
    const items = (sec.items || []).map(it => ({
      id: rid(),
      item: it.item,
      spec: it.spec || "",
      qty: it.sf && sfq[it.sf] != null ? sfq[it.sf] : "",
      rate: 0,
      sf: it.sf || null,
    }));
    if (sec.key === "secondfix" && additional.length) items.push(...additional);
    return { key: sec.key, title: sec.title, subtitle: sec.subtitle || "", items };
  });

  return {
    meta: {
      development: meta.projectName || "",
      siteAddress: "",
      preparedBy: meta.company || "",
      supplier: "",
      drawingNo: meta.drawingNumber || "",
      dateIssued: new Date().toISOString().slice(0, 10),
      requiredOnSite: "",
    },
    notes: BOQ_SUPPLIER_NOTES.slice(),
    sections,
    vatRate: BOQ_VAT_RATE,
  };
}

// A clean, editable copy of the template (item/spec/sf only) for the preset editor.
export function templateForEditing(saved) {
  const src = (saved && saved.length) ? saved : BOQ_TEMPLATE;
  return src.map(sec => ({
    key: sec.key,
    title: sec.title,
    subtitle: sec.subtitle || "",
    items: (sec.items || []).map(it => ({ id: rid(), item: it.item || "", spec: it.spec || "", sf: it.sf || null })),
  }));
}

// Strip editor-only fields before saving the preset.
export function templateForSaving(tpl) {
  return tpl.map(sec => ({
    key: sec.key,
    title: sec.title,
    subtitle: sec.subtitle || "",
    items: (sec.items || []).map(it => {
      const o = { item: it.item || "", spec: it.spec || "" };
      if (it.sf) o.sf = it.sf;
      return o;
    }),
  }));
}

export const newTemplateItem = () => ({ id: rid(), item: "", spec: "", sf: null });

// True when a line's quantity comes from the drawing: a template line linked to
// at least one symbol, or a line auto-added for an unlisted symbol. Template
// lines whose link has no symbols (e.g. External sockets) are ordinary lines.
export function isDrawingLinked(it) {
  if (it.fromDrawing) return true;
  return Boolean(it.sf && (SECONDFIX_SYMBOLS[it.sf] || []).length);
}

// Reconcile a BOQ against the CURRENT drawing (all sheets). Runs on every open,
// and from "Refresh from drawing" with { overrideTyped: true }.
//  - Drawing-linked lines take the drawing count (blank when there are none),
//    unless the user typed a quantity (qtyManual) -- kept, except on Refresh.
//  - Lines not linked to the drawing are never touched.
//  - Auto-added lines for unlisted symbols are rebuilt from the drawing but keep
//    the user's name/spec/rate edits; ones the user deleted (boq.dismissed)
//    stay deleted. A line whose symbol has left the drawing goes with it.
export function reconcileBoq(boq, project, SYMBOL_META, findSymbol, { overrideTyped = false } = {}) {
  const counts = countSymbols(placedOf(project));
  const sfq = secondFixQtys(counts);
  const mapped = new Set(Object.values(SECONDFIX_SYMBOLS).flat());
  const dismissed = new Set(boq.dismissed || []);

  const qtyFor = (it, drawn) => {
    if (it.qtyManual && !overrideTyped) return it;
    const { qtyManual, ...rest } = it;
    return { ...rest, qty: drawn != null ? drawn : "" };
  };

  const freshAdditional = Object.entries(counts)
    .filter(([id]) => !mapped.has(id) && !dismissed.has(id))
    .map(([id, qty]) => {
      const m = SYMBOL_META[id] || {};
      const sym = findSymbol ? findSymbol(id) : null;
      return {
        symbolId: id,
        item: m.description || (sym && sym.name) || id,
        spec: m.height && m.height !== "\u2014" ? m.height : "",
        qty, rate: 0, sf: null, fromDrawing: true,
      };
    })
    .sort((a, b) => a.item.localeCompare(b.item));

  const sections = boq.sections.map(sec => {
    if (sec.key !== "secondfix") return sec;
    const kept = sec.items
      .filter(it => !it.fromDrawing)
      .map(it => isDrawingLinked(it) ? qtyFor(it, sfq[it.sf]) : it);
    const oldDrawing = sec.items.filter(it => it.fromDrawing);
    const rebuilt = freshAdditional.map(fresh => {
      // Match on the symbol; fall back to the name only for old lines saved
      // without one (a renamed line always has its symbolId).
      const prev = oldDrawing.find(o => o.symbolId ? o.symbolId === fresh.symbolId : o.item === fresh.item);
      if (!prev) return { ...fresh, id: rid() };
      return qtyFor({ ...prev, symbolId: fresh.symbolId, fromDrawing: true, sf: null }, fresh.qty);
    });
    return { ...sec, items: [...kept, ...rebuilt] };
  });
  return { ...boq, sections };
}

// True when "Refresh from drawing" would overwrite a typed quantity.
export function hasTypedDrawingQtys(boq) {
  return boq.sections.some(sec => sec.items.some(it => it.qtyManual && isDrawingLinked(it)));
}

export const newBoqItem = () => ({ id: rid(), item: "", spec: "", qty: "", rate: 0, sf: null });

