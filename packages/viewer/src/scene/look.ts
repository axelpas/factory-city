import * as THREE from "three";
import type { Theme } from "../themes/index";
import { parseHex, type Rgb } from "../view/color";
import { MAX_RAMP } from "./shaders";

/** The values the shaders read, and how a theme sets them. */
export function createUniforms() {
  return {
    uProgress: { value: 1 },
    uRamp: { value: Array.from({ length: MAX_RAMP }, () => new THREE.Vector3()) },
    uRampCount: { value: 2 },
    uEdgeColor: { value: new THREE.Vector3() },
    uEdgeWidth: { value: 1 },
    uTouchColor: { value: new THREE.Vector3() },
    uMarkColor: { value: new THREE.Vector3() },
    uLotColor: { value: new THREE.Vector3() },
    uMode: { value: 0 },
    uBlock: { value: 8 },
    uGlow: { value: 0 },
    uFaceAlpha: { value: 0.12 },
    uHover: { value: -1 },
    uHoverDim: { value: 0 },
    uDimColor: { value: new THREE.Vector3() },
  };
}

export type SceneUniforms = ReturnType<typeof createUniforms>;

/** The look of the buildings: the colors, the render mode, the ramp and the glow, all from the theme. */
export class Look {
  readonly uniforms = createUniforms();
  private glowOn = true;

  /** The theme's colors and effects, written to the shaders. */
  apply(theme: Theme): void {
    const u = this.uniforms;
    const v = (key: string) => new THREE.Vector3(...parseHex(theme.colors[key] ?? ""));
    u.uEdgeColor.value = v("buildingEdge");
    u.uDimColor.value = v("dim");
    u.uTouchColor.value = v("accent");
    u.uMarkColor.value = v("marker");
    u.uLotColor.value = v("plinthEdge");
    u.uMode.value = theme.renderer === "voxel" ? 1 : theme.renderer === "wireframe" ? 2 : 0;
    u.uFaceAlpha.value = theme.effects?.faceAlpha ?? 0.12;
    this.applyGlow(theme);
    this.setRamp(theme.ramps.sequential.map(parseHex));
  }

  /** The glow around wireframe edges: capped by the theme, and can be switched off. */
  setGlow(on: boolean, theme: Theme): void {
    this.glowOn = on;
    this.applyGlow(theme);
  }

  private applyGlow(theme: Theme): void {
    const cap = Math.min(theme.effects?.glow ?? 0, 0.6);
    this.uniforms.uGlow.value = this.glowOn ? cap : 0;
  }

  setRamp(stops: readonly Rgb[]): void {
    const used = stops.slice(0, MAX_RAMP);
    used.forEach((s, i) => {
      this.uniforms.uRamp.value[i]?.set(s[0], s[1], s[2]);
    });
    this.uniforms.uRampCount.value = Math.max(used.length, 2);
  }
}
