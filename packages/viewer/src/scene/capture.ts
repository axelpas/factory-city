import * as THREE from "three";
import { edgeWidth } from "../view/resolution";
import type { CameraRig } from "./camera-rig";

/** What drawing the scene somewhere else than on the screen needs. */
export interface CaptureHost {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera(): THREE.Camera;
  rig: CameraRig;
  sun: THREE.DirectionalLight;
  uniforms: { uProgress: { value: number }; uEdgeWidth: { value: number } };
  requestRender(): void;
}

/** Average time of one image, in milliseconds, over `images` draws (a pixel is read back to wait for the GPU). */
export function benchmark(
  h: CaptureHost,
  images: number,
  options: { shadows?: boolean; pixelRatio?: number },
): number {
  const gl = h.renderer.getContext();
  const hadShadows = h.sun.castShadow;
  const ratio = h.renderer.getPixelRatio();
  if (options.shadows !== undefined) h.sun.castShadow = options.shadows;
  if (options.pixelRatio !== undefined) h.renderer.setPixelRatio(options.pixelRatio);
  const pixel = new Uint8Array(4);
  const before = h.uniforms.uProgress.value;
  const started = performance.now();
  for (let i = 0; i < images; i++) {
    h.uniforms.uProgress.value = (i % 30) / 30;
    h.renderer.shadowMap.needsUpdate = true;
    h.renderer.render(h.scene, h.camera());
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  }
  const elapsed = performance.now() - started;
  h.sun.castShadow = hadShadows;
  h.renderer.setPixelRatio(ratio);
  h.uniforms.uProgress.value = before;
  h.requestRender();
  return elapsed / images;
}

/** Renders the current view at an exact size and returns it as a canvas; the screen is left as it was. */
export function renderToCanvas(
  h: CaptureHost,
  width: number,
  height: number,
  after?: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  const prevRatio = h.renderer.getPixelRatio();
  const prevSize = h.renderer.getSize(new THREE.Vector2());
  h.renderer.setPixelRatio(1);
  h.uniforms.uEdgeWidth.value = edgeWidth(1);
  h.renderer.setSize(width, height, false);
  h.rig.setAspect(width / height);
  h.rig.applyShift(width, height);
  h.renderer.shadowMap.needsUpdate = true;
  h.renderer.render(h.scene, h.camera());
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  ctx?.drawImage(h.renderer.domElement, 0, 0);
  // what is laid over the picture is placed with the camera of this picture
  if (ctx) after?.(ctx);
  h.renderer.setPixelRatio(prevRatio);
  h.uniforms.uEdgeWidth.value = edgeWidth(prevRatio);
  h.renderer.setSize(prevSize.x, prevSize.y, false);
  h.rig.setAspect(prevSize.x / Math.max(prevSize.y, 1));
  h.rig.applyShift(prevSize.x, prevSize.y);
  h.requestRender();
  return out;
}
