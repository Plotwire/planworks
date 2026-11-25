// A small Excel (.xlsx) writer, written by hand so there's nothing to install.
// An .xlsx file is a zip of XML parts; this builds those parts and zips them
// without compression (the "store" method), which Excel opens happily.
//
//   buildXlsx([{ name, columns: [{ width }], rows: [[cell, ...], ...], freezeTopRow }])
//     -> Uint8Array, the file's bytes
//
// A cell is empty (null, undefined or ""), a string, a number, or
// { v, type: "text" | "number" | "hours" | "date" | "time", bold }.
//   date   "2026-11-24" -> a real date, shown dd/mm/yyyy
//   time   "07:30" or "07:30:00" -> a real time, shown hh:mm
//   hours  a number shown with two decimals (8.50)
//
// Text is always written as text (an "inline string"), so a job name or note
// that starts with = can never run as a formula.
//
// Plain functions so tests can run them (tests/timesheets-xlsx.test.mjs).

const encoder = new TextEncoder();

// ------------------------------------------------------------------ styles
// Each cell points at one of these by its place in the list (s="n").
const STYLES = [
  { key: "plain", numFmt: 0, font: 0 },
  { key: "bold", numFmt: 0, font: 1 },
  { key: "date", numFmt: 164, font: 0 },
  { key: "time", numFmt: 165, font: 0 },
  { key: "hours", numFmt: 2, font: 0 },
  { key: "hours-bold", numFmt: 2, font: 1 },
  { key: "date-bold", numFmt: 164, font: 1 },
  { key: "time-bold", numFmt: 165, font: 1 },
];
const STYLE_INDEX = Object.fromEntries(STYLES.map((s, i) => [s.key, i]));

function stylesXml() {
  const xf = (s) => `<xf numFmtId="${s.numFmt}" fontId="${s.font}" fillId="0" borderId="0" xfId="0"`
    + `${s.numFmt ? ' applyNumberFormat="1"' : ""}${s.font ? ' applyFont="1"' : ""}/>`;
  const font = (bold) => `<font>${bold ? "<b/>" : ""}<sz val="11"/><name val="Calibri"/><family val="2"/></font>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="hh:mm"/></numFmts>`
    + `<fonts count="2">${font(false)}${font(true)}</fonts>`
    + `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
    + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="${STYLES.length}">${STYLES.map(xf).join("")}</cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
    + `<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>`
    + `</styleSheet>`;
}

// ------------------------------------------------------------------ values
const DAY_MS = 86400000;
const EXCEL_DAY_ZERO = Date.UTC(1899, 11, 30);

/** "2026-11-24" -> 46350 (Excel's day number); null if not a date. */
export function excelDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round((t - EXCEL_DAY_ZERO) / DAY_MS);
}

/** "07:30" or "07:30:00" -> 0.3125 (part of a day); null if not a time. */
export function excelTime(time) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(time ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]), sec = Number(m[3] || 0);
  if (h > 23 || min > 59 || sec > 59) return null;
  return (h * 3600 + min * 60 + sec) / 86400;
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnName(index) {
  let n = index + 1, name = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

// Characters XML can't hold at all (most control characters) are dropped.
const NOT_XML = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu;
const CELL_LIMIT = 32767; // Excel's most characters in one cell

export function xmlText(value) {
  return String(value ?? "")
    .replace(NOT_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// One cell's XML, or "" for an empty cell.
function cellXml(ref, cell) {
  const obj = cell !== null && typeof cell === "object";
  const v = obj ? cell.v : cell;
  const bold = obj && !!cell.bold;
  let type = obj && cell.type ? cell.type : typeof v === "number" ? "number" : "text";
  let num = null;
  if (type === "date") num = excelDate(v);
  else if (type === "time") num = excelTime(v);
  else if (type === "number" || type === "hours") num = v === "" || v == null ? null : Number(v);
  if (type !== "text" && (num == null || !Number.isFinite(num))) {
    // Not a usable number: keep whatever was given as text.
    num = null;
    type = "text";
  }
  const styleKey = type === "date" || type === "time" || type === "hours"
    ? `${type}${bold ? "-bold" : ""}`
    : bold ? "bold" : "plain";
  const s = STYLE_INDEX[styleKey] ? ` s="${STYLE_INDEX[styleKey]}"` : "";
  if (num != null) return `<c r="${ref}"${s}><v>${num}</v></c>`;
  const text = v == null || typeof v === "number" ? "" : String(v).replace(NOT_XML, "").slice(0, CELL_LIMIT);
  if (text === "") return bold ? `<c r="${ref}"${s}/>` : "";
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

function sheetXml(sheet, first) {
  const rows = sheet.rows || [];
  let lastCol = 0, lastRow = 0;
  const rowXml = [];
  rows.forEach((row, r) => {
    const cells = (row || []).map((cell, c) => {
      const xml = cellXml(`${columnName(c)}${r + 1}`, cell);
      if (xml) lastCol = Math.max(lastCol, c);
      return xml;
    }).join("");
    if (cells) {
      lastRow = r;
      rowXml.push(`<row r="${r + 1}">${cells}</row>`);
    }
  });
  const dimension = rowXml.length ? `A1:${columnName(lastCol)}${lastRow + 1}` : "A1";
  const selected = first ? ' tabSelected="1"' : "";
  const view = sheet.freezeTopRow
    ? `<sheetView${selected} workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>`
      + `<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView>`
    : `<sheetView${selected} workbookViewId="0"/>`;
  const widths = (sheet.columns || [])
    .map((col, i) => (col && Number(col.width) > 0
      ? `<col min="${i + 1}" max="${i + 1}" width="${Number(col.width)}" customWidth="1"/>`
      : ""))
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
    + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<dimension ref="${dimension}"/>`
    + `<sheetViews>${view}</sheetViews>`
    + `<sheetFormatPr defaultRowHeight="15"/>`
    + (widths ? `<cols>${widths}</cols>` : "")
    + (rowXml.length ? `<sheetData>${rowXml.join("")}</sheetData>` : "<sheetData/>")
    + `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>`
    + `</worksheet>`;
}

// Excel's rules for a tab name: 1 to 31 characters, none of : \ / ? * [ ],
// not starting or ending with an apostrophe, and no two the same.
function sheetNames(sheets) {
  const used = new Set();
  return sheets.map((sheet, i) => {
    let name = String(sheet.name ?? "").replace(NOT_XML, "").replace(/[:\\/?*[\]]/g, " ")
      .replace(/^'+|'+$/g, "").trim().slice(0, 31).trim();
    if (!name) name = `Sheet${i + 1}`;
    let unique = name, n = 2;
    while (used.has(unique.toLowerCase())) {
      const tail = ` (${n++})`;
      unique = name.slice(0, 31 - tail.length) + tail;
    }
    used.add(unique.toLowerCase());
    return unique;
  });
}

// ------------------------------------------------------------------ the zip
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// A fixed file date inside the zip (1 Jan 2026, midnight), so the same
// hours always give the same file. Excel doesn't show it.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const UTF8_NAMES = 0x0800;

/** [{ name, data: Uint8Array }] -> the zip's bytes, stored (not compressed). */
export function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034B50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014B50, true);
    entry.setUint16(4, 20, true); // made by
    entry.setUint16(6, 20, true); // version needed
    entry.setUint16(8, UTF8_NAMES, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, DOS_TIME, true);
    entry.setUint16(14, DOS_DATE, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    // extra, comment, disk, internal and external attributes all stay 0
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);

    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054B50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ------------------------------------------------------------------ the file
const XML_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** The whole .xlsx file for a list of sheets (see the top of this file). */
export function buildXlsx(sheets) {
  const list = sheets && sheets.length ? sheets : [{ name: "Sheet1", rows: [] }];
  const names = sheetNames(list);
  const n = list.length;

  const contentTypes = XML_HEAD
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" `
      + `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
    + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
    + `</Types>`;

  const rootRels = XML_HEAD
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>`
    + `</Relationships>`;

  const workbook = XML_HEAD
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}">`
    + `<bookViews><workbookView activeTab="0"/></bookViews>`
    + `<sheets>${names.map((name, i) => `<sheet name="${xmlText(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>`
    + `</workbook>`;

  const workbookRels = XML_HEAD
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
    + `<Relationship Id="rId${n + 1}" Type="${REL}/styles" Target="styles.xml"/>`
    + `</Relationships>`;

  const files = [
    { name: "[Content_Types].xml", text: contentTypes },
    { name: "_rels/.rels", text: rootRels },
    { name: "xl/workbook.xml", text: workbook },
    { name: "xl/_rels/workbook.xml.rels", text: workbookRels },
    { name: "xl/styles.xml", text: stylesXml() },
    ...list.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(sheet, i === 0) })),
  ];
  return zipStore(files.map((f) => ({ name: f.name, data: encoder.encode(f.text) })));
}
