import type { Layout } from "@factory-city/layout";
import * as THREE from "three";
import type { Theme } from "../themes/index";
import type { Rgb } from "../view/color";
import type { Insets } from "../view/framing";
import { CameraRig, type CameraState } from "./camera-rig";
import { benchmark, type CaptureHost, renderToCanvas } from "./capture";
import { CityContent } from "./city-content";
import { Environment } from "./environment";
import { Look } from "./look";
import { Outlines } from "./outlines";
import { Picker } from "./picker";
import { RenderLoop } from "./render-loop";

export type { CameraState } from "./camera-rig";

export type Pick =
  | { kind: "file"; index: number }
  | { kind: "lot"; index: number }
  | { kind: "folder"; path: string }
  | null;

type Box = { x: number; y: number; w: number; h: number };

/** The 3D city: buildings interpolated on the GPU, plinths, lots, camera, picking and offscreen rendering. */
export class CityScene {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  private readonly scene = new THREE.Scene();
  private readonly look = new Look();
  private readonly environment = new Environment(this.scene);
  private readonly content = new CityContent(this.scene);
  /** The cameras and everything that moves them. */
  private readonly rig: CameraRig;
  /** The outlines of what is pointed at and what is selected. */
  private readonly outlines: Outlines;
  /** What is under a pixel of the picture. */
  private readonly picker: Picker;
  private readonly loop: RenderLoop;
  private readonly resizeObserver: ResizeObserver;
  private lastSize = { w: 0, h: 0 };
  /** Side of the city, in world units. */
  private size = 1000;
  /** Called on every animation frame with the elapsed milliseconds; returns true while something moves. */
  onTick: ((dtMs: number) => boolean) | undefined;
  /** Reads the buildings as currently drawn (from the animator), for picking and outlines. */
  readState: (() => Float32Array) | undefined;

  constructor(
    private readonly container: HTMLElement,
    private theme: Theme,
  ) {
    this.renderer.shadowMap.enabled = theme.light.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // shadows depend on the buildings, not on the camera: redraw them only when buildings move
    this.renderer.shadowMap.autoUpdate = false;
    container.appendChild(this.renderer.domElement);
    this.rig = new CameraRig(
      {
        container,
        renderer: this.renderer,
        size: () => this.size,
        theme: () => this.theme,
        maxFolderDepth: () => this.content.maxFolderDepth,
        requestRender: () => this.requestRender(),
      },
      theme.camera.fov,
    );
    this.watchCamera();
    this.picker = new Picker({
      renderer: this.renderer,
      camera: () => this.rig.camera,
      plinths: () => this.content.plinths,
      plinthPaths: () => this.content.plinthPaths,
      parcels: () => this.content.parcels,
      state: () => this.readState?.(),
    });
    this.outlines = new Outlines(this.scene, {
      state: () => this.readState?.(),
      parcels: () => this.content.parcels,
      uniforms: this.look.uniforms,
      requestRender: () => this.requestRender(),
    });
    this.loop = new RenderLoop({
      renderer: this.renderer,
      advance: (dt) => {
        const flying = this.rig.stepFly(dt) || this.outlines.step(dt);
        return this.rig.controls.update() || flying;
      },
      draw: () => {
        this.outlines.sync();
        this.renderer.render(this.scene, this.rig.camera);
      },
      tickAnimation: (dt) => this.onTick?.(dt) ?? false,
      resize: () => this.resize(),
      setEdgeWidth: (width) => {
        this.look.uniforms.uEdgeWidth.value = width;
      },
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.applyTheme(theme);
    this.resize();
    this.loop.start();
  }

  /** The orbit controls: damped, kept above the ground, and a camera moved by hand is left alone. */
  private watchCamera(): void {
    const controls = this.rig.controls;
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.autoRotateSpeed = 0.6;
    controls.addEventListener("change", () => this.requestRender());
    // no automatic framing until Reset or Top view; a plain click starts and ends an interaction without
    // changing the view: it does not count
    let byHand = false;
    controls.addEventListener("start", () => {
      byHand = true;
    });
    controls.addEventListener("end", () => {
      byHand = false;
    });
    controls.addEventListener("change", () => {
      if (byHand) this.rig.framed = null;
    });
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Images drawn during the last second, for performance checks. */
  get fps(): number {
    return this.loop.fps;
  }

  /** Called after each image drawn on screen: whatever is laid over the canvas follows the camera. */
  set onRendered(callback: (() => void) | undefined) {
    this.loop.onRendered = callback;
  }

  requestRender(): void {
    this.loop.requestRender();
  }

  setOrbit(on: boolean): void {
    this.rig.controls.autoRotate = on;
    this.requestRender();
  }

  applyTheme(theme: Theme): void {
    this.theme = theme;
    this.environment.apply(theme);
    this.look.apply(theme);
    this.outlines.setColors(
      new THREE.Color(theme.colors.hover ?? ""),
      new THREE.Color(theme.colors.folderHover ?? ""),
      new THREE.Color(theme.colors.accent ?? ""),
    );
    this.renderer.shadowMap.enabled = theme.light.shadows;
    // the camera is a token too: perspective for a model, orthographic for a plan
    // (the top view is always orthographic: it keeps its camera until Reset)
    if (this.rig.framed !== "top") this.rig.useCamera(theme.camera.type === "orthographic");
    this.rig.perspective.fov = theme.camera.fov;
    this.resize();
    this.requestRender();
  }

  /** The glow around wireframe edges: capped by the theme, and can be switched off. */
  setGlow(on: boolean): void {
    this.look.setGlow(on, this.theme);
    this.requestRender();
  }

  setRamp(stops: readonly Rgb[]): void {
    this.look.setRamp(stops);
    this.requestRender();
  }

  /** Builds the plinths, the lots and the building buffers for a layout. States come with `setStates`. */
  setCity(layout: Layout, paths: readonly string[], delays: Float32Array, keepCamera = false): void {
    const theme = this.theme;
    this.size = Math.max(layout.width, layout.height);
    const s = this.size;
    this.content.set(layout, paths, delays, theme, this.look.uniforms);
    this.look.uniforms.uBlock.value = s * (theme.effects?.blockSize ?? 0.008);
    this.environment.place(s, theme);
    this.rig.controls.minDistance = s * 0.03;
    this.rig.controls.maxDistance = s * 3;
    this.rig.perspective.far = s * 12;
    this.rig.perspective.updateProjectionMatrix();
    this.outlines.clearHover();
    if (!keepCamera) this.resetCamera();
    this.renderer.shadowMap.needsUpdate = true;
    this.requestRender();
  }

  /** Writes both ends of the current move into the instance buffers. Called once per step, not per image. */
  setStates(start: Float32Array, target: Float32Array): void {
    if (!this.content.setStates(start, target)) return;
    this.renderer.shadowMap.needsUpdate = true;
    this.requestRender();
  }

  setProgress(u: number): void {
    if (this.look.uniforms.uProgress.value === u) return;
    this.look.uniforms.uProgress.value = u;
    this.renderer.shadowMap.needsUpdate = true;
    this.requestRender();
  }

  /** Colors the plinths: districts with a tint get it, the others keep the plain plinth color. */
  setPlinthTints(tints: ReadonlyMap<string, Rgb>): void {
    this.content.setTints(tints, this.theme);
    this.requestRender();
  }

  /** What is under the pointer: a building as drawn right now, else an empty lot, else the district. */
  pick(clientX: number, clientY: number): Pick {
    return this.picker.pick(clientX, clientY);
  }

  /** Outlines the building or lot under the pointer, and its district. */
  setHover(pick: Pick, folder?: { path: string; rect: Box }): void {
    this.outlines.setHover(pick, folder);
  }

  /** Outlines a building until another is selected, or null. The outline follows the building as it moves. */
  setSelection(index: number | null): void {
    this.outlines.setSelection(index);
  }

  /** Where a point of the world lands on the picture, in pixels from its top left corner. */
  project(x: number, y: number, z: number): { x: number; y: number } {
    const camera = this.rig.camera;
    camera.updateMatrixWorld();
    const size = this.renderer.getSize(new THREE.Vector2());
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: ((v.x + 1) / 2) * size.x, y: ((1 - v.y) / 2) * size.y };
  }

  /** True when a building, as drawn right now, is under a pixel of the picture. */
  blocked(px: number, py: number): boolean {
    return this.picker.blocked(px, py);
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
      uniforms: this.look.uniforms,
      requestRender: () => this.requestRender(),
    };
  }

  private resize(): void {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.rig.setAspect(w / h);
    // a framed city follows the stage when its size changes; a view set by hand only keeps its shift
    const resized = w !== this.lastSize.w || h !== this.lastSize.h;
    this.lastSize = { w, h };
    if (resized) this.rig.reframe(w, h);
    else this.rig.applyShift(w, h);
    this.requestRender();
  }

  dispose(): void {
    this.loop.stop();
    this.resizeObserver.disconnect();
    this.rig.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
