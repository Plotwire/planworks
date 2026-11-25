// Timesheets Excel export: the hand-written .xlsx file and the workbook the
// boss downloads. The file is read back here with a tiny zip reader, so these
// checks look at exactly what Excel would open. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildXlsx, columnName, excelDate, excelTime, xmlText } from "../lib/timesheets/xlsx.js";
import { timesheetWorkbook, xlsxFileName, XLSX_TYPE } from "../lib/timesheets/workbook.js";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

// ------------------------------------------------------------ reading it back
// Our own CRC32, so the writer's isn't checking itself.
function crc32(bytes) {
  let crc = ~0;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

/** A stored (uncompressed) zip -> [{ name, text }] in the central directory's order. */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054B50) end--;
  assert.ok(end >= 0, "end of central directory found");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014B50, "central directory entry");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    assert.equal(view.getUint32(at + 24, true), size, "stored: same size in and out");
    const nameLength = view.getUint16(at + 28, true);
    const skip = view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    assert.equal(method, 0, `${name} is stored`);
    assert.equal(flags & 0x0800, 0x0800, `${name} has the UTF-8 name flag`);

    assert.equal(view.getUint32(offset, true), 0x04034B50, `${name} local header`);
    assert.equal(view.getUint32(offset + 14, true), crc, `${name} local CRC`);
    const localName = view.getUint16(offset + 26, true);
    const localExtra = view.getUint16(offset + 28, true);
    assert.equal(decoder.decode(bytes.subarray(offset + 30, offset + 30 + localName)), name);
    const start = offset + 30 + localName + localExtra;
    const data = bytes.subarray(start, start + size);
    assert.equal(crc32(data), crc, `${name} CRC32 matches`);
    files.push({ name, text: decoder.decode(data) });
    at += 46 + nameLength + skip;
  }
  return files;
}

const unescapeXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Everything needed to check a workbook: sheets by name, styles, cells. */
function open(bytes) {
  const files = unzip(bytes);
  const part = (name) => {
    const f = files.find((x) => x.name === name);
    assert.ok(f, `${name} is in the file`);
    return f.text;
  };
  const rels = Object.fromEntries([...part("xl/_rels/workbook.xml.rels").matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
    .map((m) => [m[1], m[2]]));
  const sheetList = [...part("xl/workbook.xml").matchAll(/<sheet name="([^"]+)" sheetId="\d+" r:id="([^"]+)"\/>/g)]
    .map((m) => ({ name: unescapeXml(m[1]), xml: part(`xl/${rels[m[2]]}`) }));

  const styles = part("xl/styles.xml");
  const formats = Object.fromEntries([...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]+)"\/>/g)]
    .map((m) => [m[1], m[2]]));
  formats["0"] = "General";
  formats["2"] = "0.00";
  const fonts = [...styles.match(/<fonts[^>]*>(.*?)<\/fonts>/)[1].matchAll(/<font>(.*?)<\/font>/g)].map((m) => m[1]);
  const xfs = [...styles.match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/)[1].matchAll(/<xf ([^>]*)\/>/g)].map((m) => ({
    format: formats[/numFmtId="(\d+)"/.exec(m[1])[1]],
    bold: fonts[Number(/fontId="(\d+)"/.exec(m[1])[1])].includes("<b/>"),
  }));

  const cellsOf = (xml) => {
    const cells = {};
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/g)) {
      const attrs = m[2], inner = m[3] || "";
      const style = xfs[Number((/ s="(\d+)"/.exec(attrs) || [0, 0])[1])];
      const text = /<t xml:space="preserve">(.*?)<\/t>/.exec(inner);
      const value = /<v>(.*?)<\/v>/.exec(inner);
      cells[m[1]] = {
        inline: / t="inlineStr"/.test(attrs),
        formula: inner.includes("<f"),
        text: text ? unescapeXml(text[1]) : null,
        raw: text ? text[1] : null,
        number: value ? Number(value[1]) : null,
        format: style.format,
        bold: style.bold,
      };
    }
    return cells;
  };
  return { files, sheets: sheetList.map((s) => ({ ...s, cells: cellsOf(s.xml) })) };
}

// ------------------------------------------------------------ the sample week
const names = new Map([["o1", "Dave Fenton"], ["o2", "Amy Clarke"]]);
const sample = [
  { id: "e1", operative_id: "o1", work_date: "2026-11-24", job_id: "j1", job_number: "001", job_name: "Smith, Driffield",
    work_type_id: "w1", work_type: "Price work", start_time: "07:30:00", finish_time: "16:00:00", break_minutes: 0,
    minutes: 510, description: "Second fix & tails <kitchen> \"ring\" 'main'", other_note: null },
  { id: "e2", operative_id: "o2", work_date: "2026-11-23", job_id: "j2", job_number: "10", job_name: "Jones, Beverley",
    work_type_id: "w2", work_type: "Day work", start_time: "08:00:00", finish_time: "12:00:00", break_minutes: 0,
    minutes: 240, description: null, other_note: null },
  { id: "e3", operative_id: "o2", work_date: "2026-11-24", job_id: "j1", job_number: "001", job_name: "Smith, Driffield",
    work_type_id: "w2", work_type: "Day work", start_time: "08:00:00", finish_time: "12:30:00", break_minutes: 0,
    minutes: 270, description: "=SUM(A1:A9)", other_note: null },
  // An older "Other" entry: a 30-minute break already taken off its minutes.
  { id: "e4", operative_id: "o1", work_date: "2026-11-25", job_id: null, job_number: null, job_name: "Other",
    work_type_id: "w2", work_type: "Day work", start_time: "08:00:00", finish_time: "12:30:00", break_minutes: 30,
    minutes: 240, description: "Waited at garage", other_note: "Van to MOT" },
  { id: "e5", operative_id: "o1", work_date: "2026-11-23", job_id: "j2", job_number: "10", job_name: "Jones, Beverley",
    work_type_id: "w1", work_type: "Price work", start_time: "13:00:00", finish_time: "15:00:00", break_minutes: 0,
    minutes: 120, description: "", other_note: null },
];

// ------------------------------------------------------------ the file itself
test("the file is a sound zip: every CRC checks out, content types first", () => {
  const { files, sheets } = open(timesheetWorkbook(sample, names, "2026-11-23", "2026-11-29"));
  assert.equal(files[0].name, "[Content_Types].xml");
  assert.deepEqual(files.map((f) => f.name).sort(), [
    "[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml",
    "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml",
  ]);
  for (const sheet of ["sheet1", "sheet2"]) assert.match(files[0].text, new RegExp(`/xl/worksheets/${sheet}.xml`));
  assert.deepEqual(sheets.map((s) => s.name), ["Entries", "Summary"]);
  // No shared strings: text sits in each cell.
  assert.equal(files.some((f) => /sharedStrings/.test(f.name + f.text)), false);
  const styles = files.find((f) => f.name === "xl/styles.xml").text;
  assert.match(styles, /<numFmt numFmtId="164" formatCode="dd\/mm\/yyyy"\/>/);
  assert.match(styles, /<numFmt numFmtId="165" formatCode="hh:mm"\/>/);
  assert.match(styles, /<fills count="2"><fill><patternFill patternType="none"\/><\/fill><fill><patternFill patternType="gray125"\/><\/fill><\/fills>/);
  assert.match(styles, /<cellStyle name="Normal" xfId="0" builtinId="0"\/>/);
});

test("the Entries sheet: bold header, frozen top row, widths", () => {
  const { sheets } = open(timesheetWorkbook(sample, names, "2026-11-23", "2026-11-29"));
  const { xml, cells } = sheets[0];
  const header = ["Worker", "Day", "Date", "Job number", "Job name", "Work type", "Start", "Finish", "Hours", "Note"];
  header.forEach((title, i) => {
    const c = cells[`${columnName(i)}1`];
    assert.equal(c.text, title);
    assert.equal(c.bold, true, `${title} is bold`);
  });
  assert.match(xml, /<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/><selection pane="bottomLeft" activeCell="A2" sqref="A2"\/><\/sheetView><\/sheetViews>/);
  const widths = [...xml.matchAll(/<col min="(\d+)" max="(\d+)" width="([\d.]+)" customWidth="1"\/>/g)]
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  assert.deepEqual(widths.map((w) => w[2]), [22, 11, 12, 11, 30, 14, 8, 8, 8, 48]);
  assert.deepEqual(widths.map((w) => w[0]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // OOXML's order: sheetViews, sheetFormatPr, cols, sheetData.
  const order = ["<dimension", "<sheetViews>", "<sheetFormatPr", "<cols>", "<sheetData>", "<pageMargins"].map((t) => xml.indexOf(t));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(order.every((i) => i > 0));
  // Rows go up in order, and every cell knows its place.
  const rowNumbers = [...xml.matchAll(/<row r="(\d+)">/g)].map((m) => Number(m[1]));
  assert.deepEqual(rowNumbers, [1, 2, 3, 4, 5, 6]);
  assert.equal((xml.match(/<c /g) || []).length, (xml.match(/<c r="[A-Z]+\d+"/g) || []).length);
});

test("each entry: real dates and times, hours from minutes, sorted like the CSV", () => {
  const { sheets } = open(timesheetWorkbook(sample, names, "2026-11-23", "2026-11-29"));
  const c = sheets[0].cells;
  const col = (letter) => [2, 3, 4, 5, 6].map((r) => c[`${letter}${r}`]);
  // By date, then worker name, then start time.
  assert.deepEqual(col("A").map((x) => x.text), ["Amy Clarke", "Dave Fenton", "Amy Clarke", "Dave Fenton", "Dave Fenton"]);
  assert.deepEqual(col("B").map((x) => x.text), ["Monday", "Monday", "Tuesday", "Tuesday", "Wednesday"]);

  // Row 5 is Dave on Tuesday 24 November, 07:30 to 16:00, 510 minutes.
  assert.equal(c.C5.number, 46350);
  assert.equal(c.C5.format, "dd/mm/yyyy");
  assert.equal(c.C5.inline, false);
  assert.equal(c.G5.number, 0.3125);
  assert.equal(c.G5.format, "hh:mm");
  assert.equal(c.H5.number, 16 / 24);
  assert.equal(c.H5.format, "hh:mm");
  assert.equal(c.I5.number, 8.5);
  assert.equal(c.I5.format, "0.00");
  assert.equal(c.I5.bold, false);
  // The job number stays text, so 001 keeps its noughts.
  assert.equal(c.D5.text, "001");
  assert.equal(c.D5.inline, true);
  assert.equal(c.E5.text, "Smith, Driffield");
  assert.equal(c.F5.text, "Price work");

  // The older Other entry: its job reads "Other – Van to MOT", hours net of its break.
  assert.equal(c.D6, undefined);
  assert.equal(c.E6.text, "Other – Van to MOT");
  assert.equal(c.I6.number, 4);
  assert.equal(c.J6.text, "Waited at garage");
  // An empty note leaves the cell empty.
  assert.equal(c.J2, undefined);
  assert.equal(c.J3, undefined);
});

test("notes are escaped, and a note starting with = stays text", () => {
  const { sheets } = open(timesheetWorkbook(sample, names, "2026-11-23", "2026-11-29"));
  const { xml, cells } = sheets[0];
  assert.equal(cells.J5.text, "Second fix & tails <kitchen> \"ring\" 'main'");
  assert.equal(cells.J5.raw, "Second fix &amp; tails &lt;kitchen&gt; &quot;ring&quot; &apos;main&apos;");
  assert.equal(cells.J4.text, "=SUM(A1:A9)");
  assert.equal(cells.J4.inline, true);
  assert.equal(cells.J4.formula, false);
  assert.equal(/<f[ >]/.test(xml), false, "no formulas anywhere");
});

test("the Summary: hours per job, per worker, and the grid, with totals", () => {
  const { sheets } = open(timesheetWorkbook(sample, names, "2026-11-23", "2026-11-29"));
  const c = sheets[1].cells;
  const row = (r, last = "E") => {
    const out = [];
    for (let i = 0; columnName(i) <= last && columnName(i).length === 1; i++) {
      const cell = c[`${columnName(i)}${r}`];
      out.push(cell ? (cell.text ?? cell.number) : null);
    }
    return out;
  };
  assert.equal(c.A1.text, "Timesheets summary");
  assert.equal(c.A1.bold, true);
  assert.equal(c.A2.text, "23 Nov 2026 to 29 Nov 2026");

  // Hours per job: 001 before 10, the Other last.
  assert.equal(c.A4.text, "Hours per job");
  assert.equal(c.A4.bold, true);
  assert.deepEqual(row(5, "C"), ["Job number", "Job name", "Hours"]);
  assert.ok(c.A5.bold && c.B5.bold && c.C5.bold);
  assert.deepEqual(row(6, "C"), ["001", "Smith, Driffield", 13]);
  assert.deepEqual(row(7, "C"), ["10", "Jones, Beverley", 6]);
  assert.deepEqual(row(8, "C"), [null, "Other – Van to MOT", 4]);
  assert.deepEqual(row(9, "C"), ["Total", null, 23]);
  assert.ok(c.A9.bold && c.C9.bold);
  assert.equal(c.C9.format, "0.00");
  assert.equal(c.C6.format, "0.00");
  assert.equal(c.C6.bold, false);

  // Hours per worker, by name.
  assert.equal(c.A11.text, "Hours per worker");
  assert.deepEqual(row(12, "B"), ["Worker", "Hours"]);
  assert.deepEqual(row(13, "B"), ["Amy Clarke", 8.5]);
  assert.deepEqual(row(14, "B"), ["Dave Fenton", 14.5]);
  assert.deepEqual(row(15, "B"), ["Total", 23]);
  assert.ok(c.A15.bold && c.B15.bold);

  // The grid: a column per worker, empty where they did no hours on a job.
  assert.equal(c.A17.text, "Hours per job per worker");
  assert.deepEqual(row(18), ["Job number", "Job name", "Amy Clarke", "Dave Fenton", "Total"]);
  assert.ok(["A", "B", "C", "D", "E"].every((l) => c[`${l}18`].bold));
  assert.deepEqual(row(19), ["001", "Smith, Driffield", 4.5, 8.5, 13]);
  assert.deepEqual(row(20), ["10", "Jones, Beverley", 4, 2, 6]);
  assert.deepEqual(row(21), [null, "Other – Van to MOT", null, 4, 4]);
  assert.deepEqual(row(22), ["Total", null, 8.5, 14.5, 23]);
  assert.ok(["A", "C", "D", "E"].every((l) => c[`${l}22`].bold));
  assert.ok(["C", "D", "E"].every((l) => c[`${l}22`].format === "0.00"));
  assert.equal(Object.keys(c).some((ref) => Number(ref.replace(/[A-Z]+/, "")) > 22), false);

  // Sensible widths, and nothing frozen here.
  const widths = [...sheets[1].xml.matchAll(/width="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(widths.length, 5);
  assert.ok(widths.every((w) => w >= 10));
  assert.equal(/<pane /.test(sheets[1].xml), false);
});

test("two different Other entries stay apart in the Summary", () => {
  const other = (id, note, minutes) => ({ id, operative_id: "o1", work_date: "2026-11-23", job_id: null, job_number: null,
    job_name: "Other", work_type: "Day work", start_time: "08:00:00", finish_time: "09:00:00", minutes, description: null, other_note: note });
  const { sheets } = open(timesheetWorkbook([other("a", "Van to MOT", 60), other("b", "Wholesaler", 30)], names, "2026-11-23", "2026-11-23"));
  const c = sheets[1].cells;
  assert.equal(c.A2.text, "23 Nov 2026");
  assert.equal(c.B6.text, "Other – Van to MOT");
  assert.equal(c.C6.number, 1);
  assert.equal(c.B7.text, "Other – Wholesaler");
  assert.equal(c.C7.number, 0.5);
  assert.equal(c.C8.number, 1.5);
});

test("with no entries: just the header, and the Summary says so", () => {
  const { sheets } = open(timesheetWorkbook([], names, "2026-11-23", "2026-11-29"));
  assert.deepEqual(sheets.map((s) => s.name), ["Entries", "Summary"]);
  assert.deepEqual(Object.keys(sheets[0].cells), ["A1", "B1", "C1", "D1", "E1", "F1", "G1", "H1", "I1", "J1"]);
  assert.match(sheets[0].xml, /state="frozen"/);
  const c = sheets[1].cells;
  assert.deepEqual(Object.keys(c), ["A1", "A2", "A4"]);
  assert.equal(c.A2.text, "23 Nov 2026 to 29 Nov 2026");
  assert.equal(c.A4.text, "No hours in these dates.");
  // Nothing passed at all is the same.
  assert.deepEqual(Object.keys(open(timesheetWorkbook(undefined, undefined, "2026-11-23", "2026-11-29")).sheets[1].cells), ["A1", "A2", "A4"]);
});

test("a worker with no name on record shows as Unknown", () => {
  const { sheets } = open(timesheetWorkbook([{ ...sample[0], operative_id: "gone" }], {}, "2026-11-24", "2026-11-24"));
  assert.equal(sheets[0].cells.A2.text, "Unknown");
  assert.equal(sheets[1].cells.A9.text, "Hours per worker");
  assert.equal(sheets[1].cells.A11.text, "Unknown");
});

test("the file name and type", () => {
  assert.equal(xlsxFileName("2026-11-23", "2026-11-29"), "plotwire-timesheets-2026-11-23-to-2026-11-29.xlsx");
  assert.equal(xlsxFileName("2026-11-24", "2026-11-24"), "plotwire-timesheets-2026-11-24.xlsx");
  assert.equal(XLSX_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});

// ------------------------------------------------------------ the writer
test("the writer: dates, times, column letters, and text XML can hold", () => {
  assert.equal(excelDate("2026-11-24"), 46350);
  assert.equal(excelDate("1900-03-01"), 61);
  assert.equal(excelDate("2026-02-30"), null);
  assert.equal(excelDate(""), null);
  assert.equal(excelTime("07:30"), 0.3125);
  assert.equal(excelTime("07:30:00"), 0.3125);
  assert.equal(excelTime("12:00:30"), (12 * 3600 + 30) / 86400);
  assert.equal(excelTime("24:00"), null);
  assert.deepEqual([0, 25, 26, 51, 52, 701, 702].map(columnName), ["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
  assert.equal(xmlText(`a&b<c>"d"'e'`), "a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;");
  assert.equal(xmlText("tab\tline\nret\r bell\u0007 nul\u0000 ok"), "tab\tline\nret\r bell nul ok");
  assert.equal(xmlText("emoji 👷 stays"), "emoji 👷 stays");
});

test("the writer: cells past Z, bold totals, empty and odd cells", () => {
  const wide = Array.from({ length: 28 }, (_, i) => i + 1);
  const { sheets } = open(buildXlsx([{
    name: "Week?",
    rows: [
      wide,
      [null, undefined, "", { v: 2.5, type: "hours", bold: true }, { v: "not a date", type: "date" }, { v: "x", bold: true }],
      [],
      ["  spaced  ", { v: "2026-11-24", type: "date", bold: true }, { v: NaN }],
    ],
  }, { name: "week*" }]));
  assert.deepEqual(sheets.map((s) => s.name), ["Week", "week (2)"]);
  const c = sheets[0].cells;
  assert.equal(c.Z1.number, 26);
  assert.equal(c.AA1.number, 27);
  assert.equal(c.AB1.number, 28);
  assert.equal(c.A2, undefined);
  assert.equal(c.C2, undefined);
  assert.deepEqual([c.D2.number, c.D2.format, c.D2.bold], [2.5, "0.00", true]);
  assert.equal(c.E2.text, "not a date"); // kept as text rather than lost
  assert.equal(c.F2.bold, true);
  assert.equal(c.A4.text, "  spaced  ");
  assert.deepEqual([c.B4.number, c.B4.format, c.B4.bold], [46350, "dd/mm/yyyy", true]);
  assert.equal(c.C4, undefined);
  assert.match(sheets[0].xml, /<dimension ref="A1:AB4"\/>/);
  assert.deepEqual([...sheets[0].xml.matchAll(/<row r="(\d+)">/g)].map((m) => m[1]), ["1", "2", "4"]);
  // The second sheet is empty but still a proper sheet.
  assert.match(sheets[1].xml, /<dimension ref="A1"\/><sheetViews><sheetView workbookViewId="0"\/><\/sheetViews>/);
  assert.match(sheets[1].xml, /<sheetData\/>/);
});

test("the same hours always make the same file", () => {
  const a = timesheetWorkbook(sample, names, "2026-11-23", "2026-11-29");
  const b = timesheetWorkbook([...sample].reverse(), names, "2026-11-23", "2026-11-29");
  assert.deepEqual(a, b);
});

// ------------------------------------------------------------ hours only
test("no money in the Excel export", () => {
  for (const file of ["lib/timesheets/xlsx.js", "lib/timesheets/workbook.js"]) {
    // The code itself, not the comments that say there's none.
    const code = read(file).split("\n").filter((l) => !/^\s*(\/\/|--|\*|\/\*)/.test(l)).join("\n");
    assert.doesNotMatch(code, /£|\bcost\b|\bprofit\b|\brate\b|\bwage\b|\bpay rate\b/i, file);
  }
});
