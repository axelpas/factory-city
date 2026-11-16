import { Animator, type AnimatorSink } from "../src/anim/animator";

import { B, D, G, H, MARK, PRESENCE, R, STRIDE, W, X, Y, Z } from "../src/anim/transition";

import { FRAMES, setup } from "./timeline-helpers";

export function recorder() {
  const log = { states: 0, cuts: 0, progress: [] as number[] };
  const sink: AnimatorSink = {
    states: () => {
      log.states++;
    },
    progress: (u) => {
      log.progress.push(u);
    },
    cut: () => {
      log.cuts++;
    },
  };
  return { log, sink };
}

export function animator(options: { reduced?: boolean } = {}) {
  const s = setup();
  const { log, sink } = recorder();
  const a = new Animator(s.data.paths.length, s.delays, s.ramp, sink, {
    moveShare: 0.7,
    tweenMs: 700,
    secondsPerFrame: 1,
  });
  a.reducedMotion = options.reduced ?? false;
  a.reset(FRAMES.length, (f) => s.stateOf(f));
  return { a, log, ...s };
}

export const GEOMETRY = [X, Y, Z, W, H, D, MARK, PRESENCE] as const;

export const COLOR = [R, G, B] as const;

/** Largest change of each visible channel between two pictures. A building with no height shows nothing. */

export function delta(before: Float32Array, after: Float32Array) {
  let geometry = 0;
  let color = 0;
  for (let o = 0; o < before.length; o += STRIDE) {
    const visible = (before[o + H] as number) > 1e-6 || (after[o + H] as number) > 1e-6;
    for (const c of [X, Y, Z, H, PRESENCE] as const)
      geometry = Math.max(geometry, Math.abs((after[o + c] as number) - (before[o + c] as number)));
    if (!visible) continue;
    for (const c of GEOMETRY)
      geometry = Math.max(geometry, Math.abs((after[o + c] as number) - (before[o + c] as number)));
    for (const c of COLOR)
      color = Math.max(color, Math.abs((after[o + c] as number) - (before[o + c] as number)));
  }
  return { geometry, color };
}

/** Largest value any geometric channel takes: the yardstick for "a jump". */

export function span(states: Float32Array[]): number {
  let max = 0;
  for (const s of states)
    for (let o = 0; o < s.length; o += STRIDE)
      for (const c of [W, H, D] as const) max = Math.max(max, s[o + c] as number);
  return max;
}
