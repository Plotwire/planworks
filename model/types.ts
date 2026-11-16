// model/types.ts
// The single source of truth for Plotwire's data shapes.
// Everything — store, persistence, rendering, export — is typed against these,
// so a wrong field or a missing prop becomes a compile error, not a white screen.

export const CURRENT_SCHEMA_VERSION = 1;

export type ID = string;

/** A symbol placed on a sheet. */
export interface PlacedItem {
  id: ID;
  symbolId: string;   // references the symbol library
  x: number;
  y: number;
  rotation: number;   // degrees (0 / 90 / 180 / 270)
  scale: number;      // per-item size multiplier (1 = default)
  label: string;
}

/** A furniture piece on the floor-plan layer (NOT an electrical item). */
export interface FurnitureItem {
  id: ID;
  furnitureId: string;   // references the furniture library
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

/** A wall on the floor-plan layer: a polyline drawn at a given thickness. */
export interface WallSegment {
  id: ID;
  points: { x: number; y: number }[];
  type: 'external' | 'internal';
}

/** A wire connecting two placed items. */
export interface Wire {
  id: ID;
  fromId: ID;         // PlacedItem.id
  toId: ID;           // PlacedItem.id
}

/** A free-text note: body sits at x/y, a leader line points to anchorX/anchorY. */
export interface Annotation {
  id: ID;
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  text: string;
}

/**
 * Imported floor-plan image. Persisted as { path, w, h }.
 * `src` is a runtime-only signed URL / data URL — hydrated on load, never saved.
 */
export interface ImageRef {
  path: string;       // Supabase storage path
  w: number;
  h: number;
  src?: string;
}

/** One drawing / floor. */
export interface Sheet {
  id: ID;
  name: string;
  drawingNumber: string;
  symbolScale: number;          // per-sheet symbol size (1 = 100%)
  bgImage: ImageRef | null;
  placed: PlacedItem[];
  furniture: FurnitureItem[];   // floor-plan layer — separate from electrical
  walls: WallSegment[];         // floor-plan layer — separate from electrical
  wires: Wire[];
  annotations: Annotation[];
  notes: string;                // free-text drawing notes for this sheet
}

/** Project-level metadata shown in the title block. */
export interface Meta {
  projectName: string;
  plot: string;
  sheetName: string;
  scale: string;                // e.g. "1:50 @ A3"
  drawingNumber: string;
  date: string;                 // ISO yyyy-mm-dd
  revision: string;
  revNote: string;
  company: string;
  clientName: string;
  clientEmail: string;
}

export interface TitleBlockDetail { label: string; value: string; }
export interface TitleBlockLogo { path?: string; src?: string; w?: number; h?: number; }
export interface TitleBlock {
  details: TitleBlockDetail[];
  logos: TitleBlockLogo[];
}

/** Bill of quantities. Left opaque for now — type it out when you migrate that module. */
export type Boq = unknown;

export interface Project {
  schemaVersion: number;        // bump when the shape changes; migrate.ts upgrades old saves
  meta: Meta;
  notes: string;
  boq: Boq | null;
  titleBlock: TitleBlock | null;  // null = use the account default
  /** Drawing-wide symbol colour. New drawings start on 'red'. */
  colourMode?: 'colour' | 'red' | 'mono' | 'navy';
  sheets: Sheet[];
  activeSheetId: ID;
}

export type Tool = 'select' | 'pan' | 'wire' | 'duct' | 'note' | 'wall' | 'stamp';

/** What's currently selected (runtime UI state, never persisted). */
export type Selection =
  | { kind: 'symbol'; id: ID }
  | { kind: 'furniture'; id: ID }
  | { kind: 'wall'; id: ID }
  | { kind: 'wire'; id: ID }
  | { kind: 'annotation'; id: ID }
  | null;
