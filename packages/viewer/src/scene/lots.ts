import type { Layout } from "@factory-city/layout";
import * as THREE from "three";
import { MAX_DELAY } from "../anim/transition";
import { folderDepth, plinthTop } from "../view/placements";
import type { Uniforms } from "./shaders";

/**
 * The outline of every parcel: it stays faint under a building and shows when the parcel is empty, so that a
 * file that does not exist yet (or no more) still has its place on the map.
 */
export function buildLots(
  layout: Layout,
  paths: readonly string[],
  delays: Float32Array,
  uniforms: Uniforms,
): THREE.LineSegments {
  const n = Math.max(paths.length, 1);
  const lotPositions = new Float32Array(n * 8 * 3);
  const lotIndex = new Float32Array(n * 8);
  paths.forEach((path, i) => {
    const r = layout.files.get(path);
    if (!r) return;
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const y = plinthTop(folderDepth(dir)) + 0.06;
    const inset = Math.min(r.w, r.h) * 0.06;
    const x0 = r.x + inset;
    const x1 = r.x + r.w - inset;
    const z0 = r.y + inset;
    const z1 = r.y + r.h - inset;
    const corners = [x0, z0, x1, z0, x1, z0, x1, z1, x1, z1, x0, z1, x0, z1, x0, z0];
    for (let k = 0; k < 8; k++) {
      lotPositions[(i * 8 + k) * 3] = corners[k * 2] as number;
      lotPositions[(i * 8 + k) * 3 + 1] = y;
      lotPositions[(i * 8 + k) * 3 + 2] = corners[k * 2 + 1] as number;
      lotIndex[i * 8 + k] = i;
    }
  });
  const lotGeometry = new THREE.BufferGeometry();
  lotGeometry.setAttribute("position", new THREE.BufferAttribute(lotPositions, 3));
  const lotFx = new THREE.BufferAttribute(new Float32Array(n * 8 * 2), 2);
  lotFx.setUsage(THREE.DynamicDrawUsage);
  lotGeometry.setAttribute("aPresence", lotFx);
  const lotDelay = new Float32Array(n * 8);
  for (let k = 0; k < lotDelay.length; k++) lotDelay[k] = delays[lotIndex[k] as number] ?? 0;
  lotGeometry.setAttribute("aDelay", new THREE.BufferAttribute(lotDelay, 1));
  const lotMaterial = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec2 aPresence;
      attribute float aDelay;
      uniform float uProgress;
      varying float vEmpty;
      float fcEase(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }
      void main() {
        float e = fcEase(clamp((uProgress - aDelay) / (1.0 - ${MAX_DELAY.toFixed(4)}), 0.0, 1.0));
        vEmpty = 1.0 - mix(aPresence.x, aPresence.y, e);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLotColor;
      varying float vEmpty;
      vec3 fcToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
      void main() {
        gl_FragColor = vec4(fcToLinear(uLotColor), mix(0.12, 0.95, vEmpty));
        #include <colorspace_fragment>
      }`,
  });
  const lots = new THREE.LineSegments(lotGeometry, lotMaterial);
  lots.frustumCulled = false;
  lots.raycast = () => {};
  return lots;
}
