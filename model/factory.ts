// model/factory.ts
// Constructors for new data. Ported from your existing freshSheet / freshProject
// so behaviour matches today — just typed and in one place.

import type { Project, Sheet, PlacedItem, Annotation, Meta } from './types';
import { CURRENT_SCHEMA_VERSION } from './types';

export const sid = (): string => 's_' + Math.random().toString(36).slice(2, 9);

// New drawings start with BLANK Installation Notes -- the same as freshSheet /
// freshProject in components/ElectricalPlanTool.jsx, so a new project is
// identical whichever creates it. (Older saved drawings keep their notes.)
export const DEFAULT_NOTES = "";

export function defaultMeta(): Meta {
  return {
    projectName: '',
    plot: '',
    sheetName: 'Ground Floor MEP Plan',
    scale: '1:50 @ A3',
    drawingNumber: '',
    date: new Date().toISOString().slice(0, 10),
    revision: 'A',
    revNote: 'First Issue',
    company: '',
    clientName: '',
    clientEmail: '',
  };
}

export function freshSheet(name = 'Ground floor'): Sheet {
  return {
    id: sid(),
    name,
    drawingNumber: '',
    symbolScale: 1,
    bgImage: null,
    placed: [],
    furniture: [],
    walls: [],
    wires: [],
    annotations: [],
    notes: DEFAULT_NOTES,
  };
}

export function freshProject(): Project {
  const sheet = freshSheet('Ground floor');
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: defaultMeta(),
    notes: DEFAULT_NOTES,
    boq: null,
    titleBlock: null,
    colourMode: 'red',
    sheets: [sheet],
    activeSheetId: sheet.id,
  };
}

export function makeItem(symbolId: string, x: number, y: number): PlacedItem {
  return { id: sid(), symbolId, x, y, rotation: 0, scale: 1, label: '' };
}

export function makeAnnotation(x: number, y: number): Annotation {
  return { id: sid(), x, y, anchorX: x + 80, anchorY: y + 40, text: 'Note' };
}
