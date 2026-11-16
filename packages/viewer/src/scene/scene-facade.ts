import * as THREE from "three";
import type { Insets } from "../view/framing";
import type { CameraRig, CameraState } from "./camera-rig";
import { benchmark, type CaptureHost, renderToCanvas } from "./capture";
import type { Environment } from "./environment";
import type { SceneUniforms } from "./look";

type Box = { x: number; y: number; w: number; h: number };

/**
 * What the city offers to the page about its camera and its pictures, over the parts that do the work.
 * Every method hands over to the camera rig or to the capture code.
 */
export abstract class SceneFacade {
  protected abstract readonly renderer: THREE.WebGLRenderer;
  protected abstract readonly scene: THREE.Scene;
  protected abstract readonly rig: CameraRig;
  protected abstract readonly environment: Environment;
  protected abstract readonly uniforms: SceneUniforms;
  abstract requestRender(): void;

  /** Where a point of the world lands on the picture, in pixels from its top left corner. */
  project(x: number, y: number, z: number): { x: number; y: number } {
    const camera = this.rig.camera;
    camera.updateMatrixWorld();
    const size = this.renderer.getSize(new THREE.Vector2());
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: ((v.x + 1) / 2) * size.x, y: ((1 - v.y) / 2) * size.y };
  }

  /** Brings a district to the middle of the free area; `ms` is the duration of the move, 0 is a cut. */
  frameDistrict(rect: Box, ms: number): void {
    this.rig.frameDistrict(rect, ms);
  }

  /** Moves the view to a point of the map, keeping the viewing direction and coming closer. */
  focus(x: number, z: number): void {
    this.rig.focus(x, z);
  }

  /** Where the camera is, to come back to it after an export that moved it. */
  cameraState(): CameraState {
    return this.rig.cameraState();
  }

  /** The view to use for a picture of an exact size. */
  exportView(width: number, height: number): CameraState {
    return this.rig.exportView(width, height);
  }

  /** Places the camera at a saved view turned by an angle around the vertical axis through its target. */
  setCameraState(state: CameraState, angle = 0): void {
    this.rig.setCameraState(state, angle);
  }

  /** Tells the scene what the bar, the panels and the timeline cover; a framed city is framed again. */
  setFreeArea(insets: Insets): void {
    this.rig.setFreeArea(insets);
  }

  /** The part of the picture the panels leave free, in pixels. */
  freeArea(): Box {
    return this.rig.freeArea();
  }

  /** The camera as a three-quarter view of the whole city. */
  resetCamera(): void {
    this.rig.resetCamera();
  }

  /** Straight from above, without perspective: a plan of the city, framed in the free area. */
  topView(): void {
    this.rig.topView();
  }

  /** Average time of one image in milliseconds, for performance checks. */
  benchmark(images = 60, options: { shadows?: boolean; pixelRatio?: number } = {}): number {
    return benchmark(this.capture(), images, options);
  }

  /** Renders the current view at an exact size and returns it as a canvas. */
  renderToCanvas(
    width: number,
    height: number,
    after?: (ctx: CanvasRenderingContext2D) => void,
  ): HTMLCanvasElement {
    return renderToCanvas(this.capture(), width, height, after);
  }

  private capture(): CaptureHost {
    return {
      renderer: this.renderer,
      scene: this.scene,
      camera: () => this.rig.camera,
      rig: this.rig,
      sun: this.environment.sun,
      uniforms: this.uniforms,
      requestRender: () => this.requestRender(),
    };
  }
}
