import type { Layout, Rect } from "@factory-city/layout";
import {
  B,
  D,
  G,
  H,
  MARK,
  MAX_DELAY,
  MODE,
  PRESENCE,
  R,
  RAMP,
  ROOF,
  STRIDE,
  TOUCHED,
  W,
  X,
  Y,
  Z,
} from "../anim/transition";
import { mix, type Rgb } from "./color";
import { folderDepth, type Placement, parcelCenter, plinthTop } from "./placements";

export interface StateStyle {
  /** Union indices drawn dimmed (search filter, dimmed tests). */
  dimmed?: ReadonlySet<number>;
  /** Union indices left out: they sink into their lot. */
  hidden?: ReadonlySet<number>;
  /** Union indices touched by the frame: they get a discreet outline. */
  touched?: ReadonlySet<number>;
  dimColor: Rgb;
}

const DIM_MIX = 0.82;

/** Where a building stands: its place on the parcel, even when it is an empty lot. */
function writePosition(
  out: Float32Array,
  o: number,
  p: Placement | undefined,
  rect: Rect | undefined,
  dir: string,
) {
  const center = rect ? parcelCenter(rect) : { x: 0, z: 0 };
  out[o + X] = p?.x ?? center.x;
  out[o + Z] = p?.z ?? center.z;
  out[o + Y] = p?.baseY ?? plinthTop(folderDepth(dir));
}

/** What a building looks like: its size, its roof, its outline and its color, dimmed when the filter says so. */
function writeLook(out: Float32Array, o: number, p: Placement, style: StateStyle, i: number) {
  out[o + W] = p.w;
  out[o + H] = p.h;
  out[o + D] = p.d;
  out[o + MARK] = p.markStrength;
  out[o + ROOF] = p.colorUnavailable ? 0 : p.roofMark;
  out[o + PRESENCE] = 1;
  out[o + TOUCHED] = style.touched?.has(i) ? 1 : 0;
  const dimmed = style.dimmed?.has(i) ?? false;
  const color = dimmed ? mix(p.color, style.dimColor, DIM_MIX) : p.color;
  out[o + R] = color[0];
  out[o + G] = color[1];
  out[o + B] = color[2];
  const onRamp = p.ramp !== undefined && !dimmed;
  out[o + MODE] = onRamp ? 0 : 1;
  out[o + RAMP] = onRamp ? (p.ramp as number) : 0;
}

/**
 * The on-screen values of every file of the timeline for one frame. `placements` is aligned with `paths`;
 * a file that does not exist in the frame is an empty lot: it keeps its parcel and has no height.
 */
export function buildState(
  paths: readonly string[],
  layout: Layout,
  placements: ReadonlyArray<Placement | undefined>,
  style: StateStyle,
): Float32Array {
  const out = new Float32Array(paths.length * STRIDE);
  paths.forEach((path, i) => {
    const o = i * STRIDE;
    const p = placements[i];
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    writePosition(out, o, p, layout.files.get(path), dir);
    // an empty lot has no size and presence 0
    if (p && !style.hidden?.has(i)) writeLook(out, o, p, style, i);
  });
  return out;
}

/** Start delay of each building: a fixed diagonal order across the map, so a large change reads as a wave. */
export function buildDelays(paths: readonly string[], layout: Layout): Float32Array {
  const delays = new Float32Array(paths.length);
  const span = layout.width + layout.height || 1;
  paths.forEach((path, i) => {
    const rect = layout.files.get(path);
    if (!rect) return;
    const { x, z } = parcelCenter(rect);
    delays[i] = MAX_DELAY * Math.min(Math.max((x + z) / span, 0), 1);
  });
  return delays;
}
