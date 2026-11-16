import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Theme } from "../themes/index";
import {
  cityCorners,
  frameOrthographic,
  framePerspective,
  freeRect,
  type Insets,
  NO_INSETS,
  type Vec3,
} from "../view/framing";
import { plinthTop } from "../view/placements";
import { districtView } from "../view/scene-logic";
import { CameraFly } from "./camera-fly";

/** A camera view that can be saved and restored. */
export interface CameraState {
  position: THREE.Vector3;
  target: THREE.Vector3;
  zoom: number;
  /** Where the target lands on the picture, in pixels from its center. */
  shift: { x: number; y: number };
  /** The automatic framing in force, if any. */
  framed: "default" | "top" | null;
  orthographic: boolean;
}

/** Frame height of the orthographic camera at zoom 1, as a share of the map side. */
export const ORTHO_HEIGHT = 1.28;

/** What the camera rig needs to know about the scene around it. */
export interface RigHost {
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  /** Side of the city, in world units. */
  size(): number;
  theme(): Theme;
  maxFolderDepth(): number;
  requestRender(): void;
}

/**
 * The cameras of the city and everything that moves them: the perspective and the orthographic camera, the
 * orbit controls, the automatic framing in the part of the picture the panels leave free, the move to a
 * district, and saving and restoring a view for exports.
 */
export class CameraRig {
  readonly perspective: THREE.PerspectiveCamera;
  readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  /** The automatic framing in force; null once the camera was moved by hand. */
  framed: "default" | "top" | null = "default";
  private shift = { x: 0, y: 0 };
  /** What the bar, the panels and the timeline cover: the city is framed in what is left. */
  private insets: Insets = NO_INSETS;
  /** The move toward a district, in progress or not. */
  private readonly fly = new CameraFly({ camera: () => this.camera, controls: () => this.controls });

  constructor(
    private readonly host: RigHost,
    fov: number,
  ) {
    this.perspective = new THREE.PerspectiveCamera(fov, 1, 1, 20000);
    this.camera = this.perspective;
    this.controls = new OrbitControls(this.camera, host.renderer.domElement);
  }

  /**
   * Brings a district to the middle of the free area, close enough to fill it, along the current viewing
   * direction. `ms` is the duration of the move; 0 is a cut.
   */
  frameDistrict(rect: { x: number; y: number; w: number; h: number }, ms: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const free = this.freeArea();
    const view = districtView({
      rect,
      size: this.host.size(),
      perspective: this.camera === this.perspective,
      fovDeg: this.perspective.fov,
      freeAspect: free.w / Math.max(free.h, 1),
      distance: offset.length(),
      zoom: this.camera.zoom,
      orthoHeight: ORTHO_HEIGHT,
    });
    const target = new THREE.Vector3(view.target.x, 0, view.target.z);
    const to = {
      position: target.clone().add(offset.setLength(view.distance)),
      target,
      zoom: view.zoom,
    };
    this.framed = null;
    if (this.fly.start(to, ms)) this.host.requestRender();
  }

  /** Advances a camera move; true while it runs. */
  stepFly(dtMs: number): boolean {
    return this.fly.step(dtMs);
  }

  /** Moves the view to a point of the map, keeping the viewing direction and coming closer. */
  focus(x: number, z: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = Math.min(offset.length(), this.host.size() * 0.6);
    this.controls.target.set(x, 0, z);
    this.camera.position
      .copy(this.controls.target)
      .add(offset.setLength(Math.max(distance, this.host.size() * 0.15)));
    this.controls.update();
    this.host.requestRender();
  }

  /** Where the camera is, to come back to it after an export that moved it. */
  cameraState(): CameraState {
    return {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      zoom: this.camera.zoom,
      shift: { ...this.shift },
      framed: this.framed,
      orthographic: this.camera === this.orthographic,
    };
  }

  /**
   * The view to use for a picture of an exact size: when the city is framed automatically it is framed again
   * for that picture, with no panel around; a view set by hand is kept, centered on its target.
   */
  exportView(width: number, height: number): CameraState {
    const saved = this.cameraState();
    if (this.framed) this.applyFrame(width, height, NO_INSETS);
    else this.shift = { x: 0, y: 0 };
    const view = { ...this.cameraState(), framed: null };
    this.setCameraState(saved);
    return view;
  }

  /**
   * Places the camera at a saved view turned by an angle around the vertical axis through its target.
   * The result depends on the arguments only, so that two exports give the same images.
   */
  setCameraState(state: CameraState, angle = 0): void {
    const offset = state.position
      .clone()
      .sub(state.target)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    this.useCamera(state.orthographic);
    this.controls.target.copy(state.target);
    this.camera.position.copy(state.target).add(offset);
    this.camera.zoom = state.zoom;
    this.camera.lookAt(state.target);
    this.shift = { ...state.shift };
    // a turned view is no longer the framed one
    this.framed = angle === 0 ? state.framed : null;
    const size = this.host.renderer.getSize(new THREE.Vector2());
    this.applyShift(size.x, size.y);
    this.camera.updateMatrixWorld();
    this.host.requestRender();
  }

  /** Tells the scene what the bar, the panels and the timeline cover; a framed city is framed again. */
  setFreeArea(insets: Insets): void {
    const same = (Object.keys(insets) as Array<keyof Insets>).every((k) => insets[k] === this.insets[k]);
    if (same) return;
    this.insets = { ...insets };
    if (this.framed) this.frameCity();
  }

  useCamera(orthographic: boolean): void {
    const next = orthographic ? this.orthographic : this.perspective;
    if (next === this.camera) return;
    next.position.copy(this.camera.position);
    this.camera = next;
    this.controls.object = next;
  }

  /** Height of the tallest thing the city can show: the highest plinth and a building at full scale. */
  private cityHeight(): number {
    return plinthTop(this.host.maxFolderDepth()) + this.host.theme().heightScale * this.host.size() + 2;
  }

  frameCity(): void {
    const w = Math.max(this.host.container.clientWidth, 1);
    const h = Math.max(this.host.container.clientHeight, 1);
    this.applyFrame(w, h, this.insets);
    this.host.requestRender();
  }

  /** Places the camera, along its current direction, so that the city fills the free part of a picture. */
  private applyFrame(w: number, h: number, insets: Insets): void {
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    const input = {
      corners: cityCorners(this.host.size(), this.cityHeight()),
      direction: [offset.x, offset.y, offset.z] as Vec3,
      viewport: { w, h },
      free: freeRect({ w, h }, insets),
    };
    let center: { x: number; y: number };
    if (this.camera === this.perspective) {
      const fit = framePerspective({ ...input, fovDeg: this.perspective.fov });
      this.camera.position.copy(target).add(offset.setLength(fit.distance));
      center = fit.center;
    } else {
      const fit = frameOrthographic({ ...input, unitsHigh: this.host.size() * ORTHO_HEIGHT });
      this.orthographic.zoom = fit.zoom;
      center = fit.center;
    }
    this.camera.lookAt(target);
    this.shift = { x: center.x - w / 2, y: center.y - h / 2 };
    this.applyShift(w, h);
    this.camera.updateMatrixWorld();
  }

  /** Shifts the picture so that the camera target lands off the center of a picture of this size. */
  applyShift(w: number, h: number): void {
    for (const camera of [this.perspective, this.orthographic]) {
      if (this.shift.x === 0 && this.shift.y === 0) camera.clearViewOffset();
      else camera.setViewOffset(w, h, -this.shift.x, -this.shift.y, w, h);
    }
  }

  /** The camera as a three-quarter view of the whole city. */
  resetCamera(): void {
    this.fly.cancel();
    const s = this.host.size();
    const dir = new THREE.Vector3(
      ...(this.host.theme().camera.direction as [number, number, number]),
    ).normalize();
    this.useCamera(this.host.theme().camera.type === "orthographic");
    this.controls.target.set(s / 2, 0, s / 2);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, s * 1.9);
    this.orthographic.zoom = 1;
    this.framed = "default";
    this.frameCity();
  }

  /** Straight from above, without perspective: a plan of the city, framed in the free area. */
  topView(): void {
    this.fly.cancel();
    const s = this.host.size();
    this.useCamera(true);
    this.controls.target.set(s / 2, 0, s / 2);
    this.camera.position.set(s / 2, s * 3, s / 2 + 0.001);
    this.framed = "top";
    this.frameCity();
  }

  /** Fits both cameras to a picture shape: the perspective one by its aspect, the orthographic one by its frame. */
  setAspect(aspect: number): void {
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    const half = (this.host.size() * ORTHO_HEIGHT) / 2;
    this.orthographic.left = -half * aspect;
    this.orthographic.right = half * aspect;
    this.orthographic.top = half;
    this.orthographic.bottom = -half;
    this.orthographic.far = this.host.size() * 12;
    this.orthographic.updateProjectionMatrix();
  }

  /** The part of the picture the panels leave free, in pixels. */
  freeArea(): { x: number; y: number; w: number; h: number } {
    const size = this.host.renderer.getSize(new THREE.Vector2());
    return freeRect({ w: size.x, h: size.y }, this.insets);
  }

  /** The window changed size: a framed city is framed again for it. */
  reframe(w: number, h: number): void {
    if (this.framed) this.applyFrame(w, h, this.insets);
  }
}
