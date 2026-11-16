import type * as THREE from "three";
import {
  B,
  D,
  G,
  H,
  MARK,
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

type Attr = THREE.BufferAttribute;

/** One building of one state written into the buffers of one end of the move. */
function fillEnd(s: Float32Array, pos: Attr, size: Attr, misc: Attr, col: Attr, i: number): void {
  const o = i * STRIDE;
  pos.setXYZ(i, s[o + X] as number, s[o + Y] as number, s[o + Z] as number);
  size.setXYZ(i, s[o + W] as number, s[o + H] as number, s[o + D] as number);
  misc.setXYZW(i, s[o + MARK] as number, s[o + RAMP] as number, s[o + MODE] as number, s[o + ROOF] as number);
  col.setXYZ(i, s[o + R] as number, s[o + G] as number, s[o + B] as number);
}

/**
 * Writes both ends of the current move into the instance buffers of the buildings, and the presence of each
 * parcel into the lots. Called once per step, not per image.
 */
export function writeStates(
  geometry: THREE.BufferGeometry,
  lotFx: Attr | undefined,
  count: number,
  start: Float32Array,
  target: Float32Array,
): void {
  const get = (name: string) => geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
  const posA = get("aPosA");
  const posB = get("aPosB");
  const sizeA = get("aSizeA");
  const sizeB = get("aSizeB");
  const miscA = get("aMiscA");
  const miscB = get("aMiscB");
  const colA = get("aColA");
  const colB = get("aColB");
  const fx = get("aFx");
  for (let i = 0; i < count; i++) {
    fillEnd(start, posA, sizeA, miscA, colA, i);
    fillEnd(target, posB, sizeB, miscB, colB, i);
    const o = i * STRIDE;
    const pa = start[o + PRESENCE] as number;
    const pb = target[o + PRESENCE] as number;
    fx.setXYZW(i, start[o + TOUCHED] as number, pa, target[o + TOUCHED] as number, pb);
    if (lotFx) for (let k = 0; k < 8; k++) lotFx.setXY(i * 8 + k, pa, pb);
  }
  for (const a of [posA, posB, sizeA, sizeB, miscA, miscB, colA, colB, fx]) a.needsUpdate = true;
  if (lotFx) lotFx.needsUpdate = true;
}
