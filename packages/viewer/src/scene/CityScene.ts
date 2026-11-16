import type { Layout } from "@factory-city/layout";
import * as THREE from "three";
import type { Theme } from "../themes/index";
import { parseHex, type Rgb } from "../view/color";
import type { Insets } from "../view/framing";
import { folderDepth } from "../view/placements";
import { edgeWidth, REST_DELAY_MS, restRatio } from "../view/resolution";
import { CameraRig, type CameraState } from "./camera-rig";
import { benchmark, type CaptureHost, renderToCanvas } from "./capture";
import { buildBuildings, buildPlinths, buildRoofs, writeStates } from "./city-meshes";
import { buildLots } from "./lots";
import { Outlines } from "./outlines";
import { Picker } from "./picker";
import { ResolutionGovernor } from "./resolution-governor";
import { MAX_RAMP } from "./shaders";

export type { CameraState } from "./camera-rig";

export type Pick =
  | { kind: "file"; index: number }
  | { kind: "lot"; index: number }
  | { kind: "folder"; path: string }
  | null;

/** The 3D city: buildings interpolated on the GPU, plinths, lots, camera, picking and offscreen rendering. */
export class CityScene {
  private readonly renderer: THREE.WebGLRenderer;
  /** The cameras and everything that moves them. */
  private readonly rig: CameraRig;
  /** The outlines of what is pointed at and what is selected. */
  private readonly outlines: Outlines;
  /** What is under a pixel of the picture. */
  private readonly picker: Picker;

  private get camera() {
    return this.rig.camera;
  }

  private get controls() {
    return this.rig.controls;
  }

  private get perspective() {
    return this.rig.perspective;
  }

  private readonly scene = new THREE.Scene();
  private readonly ambient = new THREE.AmbientLight();
  private grid: THREE.GridHelper | undefined;
  private glowOn = true;
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly sun: THREE.DirectionalLight;
  private readonly ground: THREE.Mesh;
  private readonly uniforms = {
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
  private buildings: THREE.Mesh | undefined;
  /** The roofs of the marked buildings. */
  private roofs: THREE.Mesh | undefined;
  private lots: THREE.LineSegments | undefined;
  private plinths: THREE.InstancedMesh | undefined;
  private plinthPaths: string[] = [];
  private maxFolderDepth = 0;
  private lastSize = { w: 0, h: 0 };
  private parcels: Array<{ x: number; y: number; w: number; h: number } | undefined> = [];
  private count = 0;
  private size = 1000;
  private dirty = true;
  private frame = 0;
  private lastTime = 0;
  private resizeObserver: ResizeObserver;
  private theme: Theme;
  /** Called on every animation frame with the elapsed milliseconds; returns true while something moves. */
  onTick: ((dtMs: number) => boolean) | undefined;
  /** Reads the buildings as currently drawn (from the animator), for picking and outlines. */
  readState: (() => Float32Array) | undefined;
  /** Called after each image drawn on screen: whatever is laid over the canvas follows the camera. */
  onRendered: (() => void) | undefined;
  /** Current render scale: `motionRatio` while something moves, as sharp as the screen allows at rest. */
  private pixelRatio = 1;
  /** Learns the render scale that keeps motion fluid. */
  private governor!: ResolutionGovernor;
  private lastMotion = 0;
  /** Images drawn during the last second, for performance checks. */
  fps = 0;
  private fpsFrames = 0;
  private fpsSince = 0;

  constructor(
    private readonly container: HTMLElement,
    theme: Theme,
  ) {
    this.theme = theme;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.pixelRatio = this.maxRatio();
    this.governor = new ResolutionGovernor(this.pixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.uniforms.uEdgeWidth.value = edgeWidth(this.pixelRatio);
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
        maxFolderDepth: () => this.maxFolderDepth,
        requestRender: () => this.requestRender(),
      },
      theme.camera.fov,
    );
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.autoRotateSpeed = 0.6;
    this.controls.addEventListener("change", () => this.requestRender());
    // a camera moved by hand is left alone: no automatic framing until Reset or Top view
    // (a plain click starts and ends an interaction without changing the view: it does not count)
    let byHand = false;
    this.controls.addEventListener("start", () => {
      byHand = true;
    });
    this.controls.addEventListener("end", () => {
      byHand = false;
    });
    this.controls.addEventListener("change", () => {
      if (byHand) this.rig.framed = null;
    });

    this.sun = new THREE.DirectionalLight();
    this.scene.add(this.ambient, this.sun, this.sun.target);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial());
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.picker = new Picker({
      renderer: this.renderer,
      camera: () => this.camera,
      plinths: () => this.plinths,
      plinthPaths: () => this.plinthPaths,
      parcels: () => this.parcels,
      state: () => this.readState?.(),
    });
    this.outlines = new Outlines(this.scene, {
      state: () => this.readState?.(),
      parcels: () => this.parcels,
      uniforms: this.uniforms,
      requestRender: () => this.requestRender(),
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.applyTheme(theme);
    this.resize();
    const loop = (time: number) => {
      this.frame = requestAnimationFrame(loop);
      this.tick(time);
    };
    this.frame = requestAnimationFrame(loop);
  }

  /** One animation frame: advance what moves, pick the render scale, draw when something changed. */
  private tick(time: number): void {
    const dt = this.lastTime ? Math.min(time - this.lastTime, 100) : 0;
    this.lastTime = time;
    const animating = this.onTick?.(dt) ?? false;
    const flying = this.rig.stepFly(dt) || this.outlines.step(dt);
    const moving = this.controls.update() || animating || flying;
    this.chooseResolution(moving, time);
    if (this.dirty || moving) {
      this.dirty = false;
      this.outlines.sync();
      this.renderer.render(this.scene, this.camera);
      this.onRendered?.();
      this.fpsFrames++;
      if (moving) this.adaptResolution(dt);
    }
    if (time - this.fpsSince >= 1000) {
      this.fps = (this.fpsFrames * 1000) / (time - this.fpsSince);
      this.fpsFrames = 0;
      this.fpsSince = time;
    }
  }

  /** While something moves the scale is the one that keeps motion fluid; at rest it is as sharp as the screen allows. */
  private chooseResolution(moving: boolean, time: number): void {
    if (moving) {
      this.lastMotion = time;
      if (this.pixelRatio !== this.governor.ratio) this.setPixelRatio(this.governor.ratio);
    } else if (time - this.lastMotion > REST_DELAY_MS) {
      // draw the still picture once more, as sharp as the screen allows
      const rest = restRatio(this.governor.ratio, this.governor.ms, this.maxRatio());
      if (rest > this.pixelRatio + 0.01) this.setPixelRatio(rest);
    }
  }

  /** Draws at a lower resolution when images take too long, and back when they are fast again. */
  private adaptResolution(dtMs: number): void {
    const next = this.governor.adapt(dtMs, this.maxRatio());
    if (next !== undefined) this.setPixelRatio(next);
  }

  private maxRatio(): number {
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  private setPixelRatio(ratio: number): void {
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.uniforms.uEdgeWidth.value = edgeWidth(ratio);
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  requestRender(): void {
    this.dirty = true;
  }

  setOrbit(on: boolean): void {
    this.controls.autoRotate = on;
    this.requestRender();
  }

  applyTheme(theme: Theme): void {
    this.theme = theme;
    const c = (key: string) => new THREE.Color(theme.colors[key] ?? "");
    const v = (key: string) => new THREE.Vector3(...parseHex(theme.colors[key] ?? ""));
    this.scene.background = c("background");
    (this.ground.material as THREE.MeshLambertMaterial).color = c("ground");
    this.outlines.setColors(c("hover"), c("folderHover"), c("accent"));
    this.uniforms.uEdgeColor.value = v("buildingEdge");
    this.uniforms.uDimColor.value = v("dim");
    this.uniforms.uTouchColor.value = v("accent");
    this.uniforms.uMarkColor.value = v("marker");
    this.uniforms.uLotColor.value = v("plinthEdge");
    this.uniforms.uMode.value = theme.renderer === "voxel" ? 1 : theme.renderer === "wireframe" ? 2 : 0;
    this.uniforms.uFaceAlpha.value = theme.effects?.faceAlpha ?? 0.12;
    this.applyGlow();
    this.ambient.intensity = theme.light.ambient * Math.PI;
    this.sun.intensity = theme.light.sun * Math.PI;
    this.renderer.shadowMap.enabled = theme.light.shadows;
    this.sun.castShadow = theme.light.shadows;
    // the camera is a token too: perspective for a model, orthographic for a plan
    // (the top view is always orthographic: it keeps its camera until Reset)
    if (this.rig.framed !== "top") this.rig.useCamera(theme.camera.type === "orthographic");
    this.perspective.fov = theme.camera.fov;
    this.setRamp(theme.ramps.sequential.map(parseHex));
    this.resize();
    this.requestRender();
  }

  /** The glow around wireframe edges: capped by the theme, and can be switched off. */
  setGlow(on: boolean): void {
    this.glowOn = on;
    this.applyGlow();
    this.requestRender();
  }

  private applyGlow(): void {
    const cap = Math.min(this.theme.effects?.glow ?? 0, 0.6);
    this.uniforms.uGlow.value = this.glowOn ? cap : 0;
  }

  setRamp(stops: readonly Rgb[]): void {
    const used = stops.slice(0, MAX_RAMP);
    used.forEach((s, i) => {
      this.uniforms.uRamp.value[i]?.set(s[0], s[1], s[2]);
    });
    this.uniforms.uRampCount.value = Math.max(used.length, 2);
    this.requestRender();
  }

  /** Builds the plinths, the lots and the building buffers for a layout. States come with `setStates`. */
  /** The ground grid of the themes that have one, sized to the city. */
  private rebuildGrid(): void {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid = undefined;
    }
    if (!this.theme.effects?.grid) return;
    const line = new THREE.Color(this.theme.colors.gridLine ?? "");
    this.grid = new THREE.GridHelper(this.size * 3, 150, line, line);
    this.grid.position.set(this.size / 2, 0.01, this.size / 2);
    this.grid.raycast = () => {};
    this.scene.add(this.grid);
  }

  /** The sun and its shadow camera, over the whole city of side `s`. */
  private placeSun(s: number): void {
    const sun = this.theme.light.sunPosition;
    this.sun.position.set(s / 2 + (sun[0] ?? 0) * s, (sun[1] ?? 1) * s, s / 2 + (sun[2] ?? 0) * s);
    this.sun.target.position.set(s / 2, 0, s / 2);
    this.sun.castShadow = this.theme.light.shadows;
    const cam = this.sun.shadow.camera;
    cam.left = -s * 0.85;
    cam.right = s * 0.85;
    cam.top = s * 0.85;
    cam.bottom = -s * 0.85;
    cam.near = 1;
    cam.far = s * 4;
    cam.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
  }

  setCity(layout: Layout, paths: readonly string[], delays: Float32Array, keepCamera = false): void {
    this.size = Math.max(layout.width, layout.height);
    this.count = paths.length;
    const theme = this.theme;
    for (const m of [this.plinths, this.buildings, this.roofs, this.lots]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
    }

    // plinths: one low box per folder; buildings, moved by the vertex shader; roofs on the marked ones
    const folders = [...layout.folders.entries()].sort((a, b) => folderDepth(a[0]) - folderDepth(b[0]));
    this.plinthPaths = folders.map(([path]) => path);
    this.maxFolderDepth = folders.reduce((max, [path]) => Math.max(max, folderDepth(path)), 0);
    this.plinths = buildPlinths(this.unitBox, folders, (path) => this.plinthColor(path));
    this.buildings = buildBuildings(this.count, delays, theme, this.uniforms);
    this.roofs = buildRoofs(this.buildings, this.count, theme, this.uniforms);

    // lots: the outline of every parcel; it fades in when the parcel is empty
    this.parcels = paths.map((path) => layout.files.get(path));
    this.lots = buildLots(layout, paths, delays, this.uniforms);
    this.scene.add(this.plinths, this.buildings, this.roofs, this.lots);
    this.uniforms.uBlock.value = this.size * (theme.effects?.blockSize ?? 0.008);
    this.rebuildGrid();
    this.ground.scale.set(this.size * 6, this.size * 6, 1);
    this.ground.position.set(this.size / 2, -0.02, this.size / 2);
    const s = this.size;
    this.placeSun(s);
    this.controls.minDistance = s * 0.03;
    this.controls.maxDistance = s * 3;
    this.perspective.far = s * 12;
    this.perspective.updateProjectionMatrix();
    this.outlines.clearHover();
    if (!keepCamera) this.resetCamera();
    this.renderer.shadowMap.needsUpdate = true;
    this.requestRender();
  }

  /** Writes both ends of the current move into the instance buffers. Called once per step, not per image. */
  setStates(start: Float32Array, target: Float32Array): void {
    const geometry = this.buildings?.geometry;
    if (!geometry) return;
    const lotFx = this.lots?.geometry.getAttribute("aPresence") as THREE.BufferAttribute | undefined;
    writeStates(geometry, lotFx, this.count, start, target);
    this.renderer.shadowMap.needsUpdate = true;
    this.requestRender();
  }

  setProgress(u: number): void {
    if (this.uniforms.uProgress.value === u) return;
    this.uniforms.uProgress.value = u;
    this.renderer.shadowMap.needsUpdate = true;
    this.requestRender();
  }

  /**
   * The slab under the whole city shows between the districts: it takes the street color. Each level of
   * folders is a step lighter, up to the plain plinth color, so a district stands out against its parent.
   */
  private plinthColor(path: string): THREE.Color {
    const colors = this.theme.colors;
    const plinth = new THREE.Color(colors.plinth ?? "");
    const street = new THREE.Color(colors.street ?? colors.plinth ?? "");
    const depth = folderDepth(path);
    if (path === "" || depth === 0) return street;
    return street.lerp(plinth, 0.4 + 0.6 * (depth / Math.max(this.maxFolderDepth, 1)));
  }

  /** Colors the plinths: districts with a tint get it, the others keep the plain plinth color. */
  setPlinthTints(tints: ReadonlyMap<string, Rgb>): void {
    if (!this.plinths) return;
    const col = new THREE.Color();
    this.plinthPaths.forEach((path, i) => {
      const t = tints.get(path);
      if (t) col.setRGB(t[0], t[1], t[2], THREE.SRGBColorSpace);
      else col.copy(this.plinthColor(path));
      this.plinths?.setColorAt(i, col);
    });
    if (this.plinths.instanceColor) this.plinths.instanceColor.needsUpdate = true;
    this.requestRender();
  }

  /** What is under the pointer: a building as drawn right now, else an empty lot, else the district. */
  pick(clientX: number, clientY: number): Pick {
    return this.picker.pick(clientX, clientY);
  }

  /** Outlines the building or lot under the pointer, and its district. */
  setHover(
    pick: Pick,
    folder?: { path: string; rect: { x: number; y: number; w: number; h: number } },
  ): void {
    this.outlines.setHover(pick, folder);
  }

  /** Outlines a building until another is selected, or null. The outline follows the building as it moves. */
  setSelection(index: number | null): void {
    this.outlines.setSelection(index);
  }

  /** Where a point of the world lands on the picture, in pixels from its top left corner. */
  project(x: number, y: number, z: number): { x: number; y: number } {
    this.camera.updateMatrixWorld();
    const size = this.renderer.getSize(new THREE.Vector2());
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * size.x, y: ((1 - v.y) / 2) * size.y };
  }

  /** True when a building, as drawn right now, is under a pixel of the picture. */
  blocked(px: number, py: number): boolean {
    return this.picker.blocked(px, py);
  }

  /** Brings a district to the middle of the free area; `ms` is the duration of the move, 0 is a cut. */
  frameDistrict(rect: { x: number; y: number; w: number; h: number }, ms: number): void {
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
  freeArea(): { x: number; y: number; w: number; h: number } {
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
      camera: () => this.camera,
      rig: this.rig,
      sun: this.sun,
      uniforms: this.uniforms,
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
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
