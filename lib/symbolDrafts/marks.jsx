/* ============================================================================
 * Drawing marks: floor links (10 Nov 2026).
 *
 * "Up to floor above" and "Down to floor below": a circle with a solid arrow,
 * marking where something carries on on the next floor (e.g. a switch drop to
 * the landing above). Each takes a short label (the inspector's Label /
 * Reference, e.g. "To FF landing switch"), and placing one offers to put its
 * partner on the other floor at the same spot (components/ElectricalPlanTool).
 *
 * Drawing marks only: they are never counted on the quote or the materials
 * list (lib/boqTemplate.js NOT_QUOTED), and they size or suggest nothing.
 * Offered in the editor's palette under "Floor links" for every account
 * (components/SheetParts.jsx Palette), not through the Symbol Library ticks.
 * ========================================================================= */

"use client";

import React from "react";
import { Ring, Poly } from "../symbolKit";

const MK = "marks", DM = "Drawing marks (not ordered)";

export const FLOOR_LINK_UP = "mk_floor_up";
export const FLOOR_LINK_DOWN = "mk_floor_down";
export const FLOOR_LINKS = [FLOOR_LINK_UP, FLOOR_LINK_DOWN];
// The partner of a floor link: an up link on one floor pairs with a down
// link on the floor above, and the other way round.
export const floorLinkPartner = (id) => (id === FLOOR_LINK_UP ? FLOOR_LINK_DOWN : id === FLOOR_LINK_DOWN ? FLOOR_LINK_UP : null);

// A circle with a solid arrow, pointing up (to the floor above) or down.
const FloorArrow = ({ up }) => (
  <g>
    <Ring r={14}/>
    <Poly closed solid pts={up
      ? "24,11 32.5,22.5 27.5,22.5 27.5,36 20.5,36 20.5,22.5 15.5,22.5"
      : "24,37 32.5,25.5 27.5,25.5 27.5,12 20.5,12 20.5,25.5 15.5,25.5"}/>
  </g>
);

export const MARK_SYMBOLS = [
  { id: FLOOR_LINK_UP, name: "Up to floor above", code: "FLR-UP", category: MK, materials: DM, height: "Drawing mark",
    description: "Up to floor above", svg: <FloorArrow up/> },
  { id: FLOOR_LINK_DOWN, name: "Down to floor below", code: "FLR-DN", category: MK, materials: DM, height: "Drawing mark",
    description: "Down to floor below", svg: <FloorArrow/> },
];
