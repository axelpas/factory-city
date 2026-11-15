import { type Rgb, rampColor } from "../view/color";
import { mixOklab } from "./oklab";

/** Values of one building on screen. One Float32Array holds all buildings, STRIDE numbers each. */
export const STRIDE = 15;
export const X = 0;
export const Y = 1;
export const Z = 2;
export const W = 3;
export const H = 4;
export const D = 5;
/** 1 when the building carries the marker (its value is above the marker's threshold), else 0. */
export const MARK = 6;
/** Position on the color ramp, 0..1 (used when MODE is 0). */
export const RAMP = 7;
/** 0: the color is read from the ramp at RAMP. 1: the color is R, G, B. */
export const MODE = 8;
export const ROOF = 9;
export const R = 10;
export const G = 11;
export const B = 12;
/** 1 when the current frame touched the file. */
export const TOUCHED = 13;
/** 1 when the file exists, 0 for an empty lot. */
export const PRESENCE = 14;

/** Share of a move during which buildings start one after the other, so a large change reads as a wave. */
export const MAX_DELAY = 0.3;

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Progress of one building inside a move of progress `u`, given its start delay. */
export function localProgress(u: number, delay: number): number {
  const t = (u - delay) / (1 - MAX_DELAY);
  return easeInOut(Math.min(Math.max(t, 0), 1));
}

const LINEAR = [X, Y, Z, W, H, D, MARK, ROOF, TOUCHED, PRESENCE] as const;
const BORROWED = [W, D, MARK, RAMP, MODE, ROOF, R, G, B] as const;

/**
 * A move from one set of building states to another. The same arithmetic runs in the vertex shader;
 * this copy is what picking, hover outlines and "continue from what is on screen" are computed from.
 */
export class Transition {
  start: Float32Array;
  target: Float32Array;

  constructor(
    readonly count: number,
    readonly delays: Float32Array,
    private ramp: readonly Rgb[],
  ) {
    this.start = new Float32Array(count * STRIDE);
    this.target = new Float32Array(count * STRIDE);
  }

  setRamp(ramp: readonly Rgb[]): void {
    this.ramp = ramp;
  }

  /**
   * Sets both ends of the move. A building that appears rises from its lot with its final footprint and
   * color; one that disappears sinks with the footprint and color it had.
   */
  setStates(start: Float32Array, target: Float32Array): void {
    this.start = new Float32Array(start);
    this.target = new Float32Array(target);
    for (let i = 0; i < this.count; i++) {
      const o = i * STRIDE;
      const a = this.start[o + PRESENCE] as number;
      const b = this.target[o + PRESENCE] as number;
      if (a <= 0 && b > 0) for (const c of BORROWED) this.start[o + c] = this.target[o + c] as number;
      else if (b <= 0 && a > 0) for (const c of BORROWED) this.target[o + c] = this.start[o + c] as number;
    }
  }

  /** Writes the state of building `i` at move progress `u` into `out` at `offset`. */
  sample(i: number, u: number, out: Float32Array, offset = 0): void {
    const o = i * STRIDE;
    const e = localProgress(u, this.delays[i] as number);
    const a = this.start;
    const b = this.target;
    for (const c of LINEAR)
      out[offset + c] = (a[o + c] as number) + ((b[o + c] as number) - (a[o + c] as number)) * e;
    const bothRamp = (a[o + MODE] as number) < 0.5 && (b[o + MODE] as number) < 0.5;
    let color: Rgb;
    if (bothRamp) {
      // color follows the data: interpolate the value, then read the ramp
      const t = (a[o + RAMP] as number) + ((b[o + RAMP] as number) - (a[o + RAMP] as number)) * e;
      out[offset + RAMP] = t;
      out[offset + MODE] = 0;
      color = rampColor(this.ramp, t);
    } else {
      color = mixOklab(
        [a[o + R] as number, a[o + G] as number, a[o + B] as number],
        [b[o + R] as number, b[o + G] as number, b[o + B] as number],
        e,
      );
      out[offset + RAMP] = e >= 1 ? (b[o + RAMP] as number) : 0;
      out[offset + MODE] = e >= 1 ? (b[o + MODE] as number) : 1;
    }
    out[offset + R] = color[0];
    out[offset + G] = color[1];
    out[offset + B] = color[2];
  }

  /** What is on screen at move progress `u`, for every building. */
  sampleAll(u: number): Float32Array {
    const out = new Float32Array(this.count * STRIDE);
    for (let i = 0; i < this.count; i++) this.sample(i, u, out, i * STRIDE);
    return out;
  }
}
