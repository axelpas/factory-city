import type { Layout } from "@factory-city/layout";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  B,
  D,
  G,
  H,
  MAX_DELAY,
  MODE,
  PRESENCE,
  R,
  RAMP,
  ROOF,
  STRIDE,
  TOUCHED,
  TWIST,
  W,
  X,
  Y,
  Z,
} from "../anim/transition";
import type { Theme } from "../themes/index";
import { parseHex, type Rgb } from "../view/color";
import { pickBuilding } from "../view/picking";
import { folderDepth, PLINTH_THICKNESS, plinthTop } from "../view/placements";

export type Pick =
  | { kind: "file"; index: number }
  | { kind: "lot"; index: number }
  | { kind: "folder"; path: string }
  | null;

const MAX_RAMP = 8;

/** Shared by the color and the depth material: where a vertex of a building is, right now. */
const VERTEX_COMMON = /* glsl */ `
attribute vec3 aPosA;
attribute vec3 aPosB;
attribute vec3 aSizeA;
attribute vec3 aSizeB;
attribute vec4 aMiscA; // twist, ramp, mode, roof
attribute vec4 aMiscB;
attribute vec3 aColA;
attribute vec3 aColB;
attribute vec4 aFx; // touched A, presence A, touched B, presence B
attribute float aDelay;
uniform float uProgress;
varying vec3 vBox;
varying vec3 vSize;
varying vec4 vMiscA;
varying vec4 vMiscB;
varying vec2 vFx;
varying float vEase;
varying vec3 vColor;
uniform vec3 uRamp[${MAX_RAMP}];
uniform float uRampCount;

vec3 fcToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 fcToSrgb(vec3 c) {
  vec3 x = clamp(c, 0.0, 1.0);
  return mix(x * 12.92, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, x));
}
vec3 fcRampAt(float t) {
  float pos = clamp(t, 0.0, 1.0) * (uRampCount - 1.0);
  int i = int(min(floor(pos), uRampCount - 2.0));
  return mix(uRamp[i], uRamp[i + 1], pos - float(i));
}
vec3 fcOklab(vec3 srgb) {
  vec3 c = fcToLinear(srgb);
  vec3 lms = pow(vec3(
    0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
    0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
    0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b), vec3(1.0 / 3.0));
  return vec3(
    0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
    1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
    0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z);
}
vec3 fcFromOklab(vec3 lab) {
  vec3 lms = pow(vec3(
    lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z,
    lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z,
    lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z), vec3(3.0));
  return fcToSrgb(vec3(
    4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
    -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
    -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z));
}
/** The building's color in sRGB: the ramp read at the interpolated value, or a perceptual cross-fade. */
vec3 fcColor(float e) {
  if (aMiscA.z < 0.5 && aMiscB.z < 0.5) return fcRampAt(mix(aMiscA.y, aMiscB.y, e));
  if (e <= 0.0) return aColA;
  if (e >= 1.0) return aColB;
  return fcFromOklab(mix(fcOklab(aColA), fcOklab(aColB), e));
}

float fcEase(float t) {
  return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}
float fcLocal() {
  return fcEase(clamp((uProgress - aDelay) / (1.0 - ${MAX_DELAY.toFixed(4)}), 0.0, 1.0));
}
vec3 fcRotate(vec3 v, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}
vec3 fcPosition(vec3 p) {
  float e = fcLocal();
  vec3 size = mix(aSizeA, aSizeB, e);
  float twist = mix(aMiscA.x, aMiscB.x, e);
  vec3 base = mix(aPosA, aPosB, e);
  float shown = step(0.001, size.y);
  return base + fcRotate(p * size, twist) * shown;
}
`;

const FRAGMENT_COMMON = /* glsl */ `
uniform vec3 uEdgeColor;
uniform vec3 uTouchColor;
// 0 solid, 1 blocks, 2 wireframe
uniform float uMode;
uniform float uBlock;
uniform float uGlow;
uniform float uFaceAlpha;
vec4 fcWire;
varying vec3 vBox;
varying vec3 vSize;
varying vec4 vMiscA;
varying vec4 vMiscB;
varying vec2 vFx;
varying float vEase;
varying vec3 vColor;

vec3 fcToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
`;

function patchVertex(shader: { vertexShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${VERTEX_COMMON}`)
    .replace(
      "#include <begin_vertex>",
      /* glsl */ `
      vec3 transformed = fcPosition(position);
      {
        float e = fcLocal();
        vEase = e;
        vBox = position;
        vSize = mix(aSizeA, aSizeB, e);
        vMiscA = aMiscA;
        vMiscB = aMiscB;
        vColor = fcColor(e);
        vFx = vec2(mix(aFx.x, aFx.z, e), mix(aFx.y, aFx.w, e));
      }`,
    );
}

/** The 3D city: buildings interpolated on the GPU, plinths, lots, camera, picking and offscreen rendering. */
export class CityScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private readonly perspective: THREE.PerspectiveCamera;
  private readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
  private readonly ambient = new THREE.AmbientLight();
  private grid: THREE.GridHelper | undefined;
  private glowOn = true;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly unitEdges = new THREE.EdgesGeometry(this.unitBox);
  private readonly sun: THREE.DirectionalLight;
  private readonly ground: THREE.Mesh;
  private readonly hoverBuilding: THREE.LineSegments;
  private readonly hoverFolder: THREE.LineSegments;
  private readonly uniforms = {
    uProgress: { value: 1 },
    uRamp: { value: Array.from({ length: MAX_RAMP }, () => new THREE.Vector3()) },
    uRampCount: { value: 2 },
    uEdgeColor: { value: new THREE.Vector3() },
    uTouchColor: { value: new THREE.Vector3() },
    uLotColor: { value: new THREE.Vector3() },
    uMode: { value: 0 },
    uBlock: { value: 8 },
    uGlow: { value: 0 },
    uFaceAlpha: { value: 0.12 },
  };
  private buildings: THREE.Mesh | undefined;
  private lots: THREE.LineSegments | undefined;
  private plinths: THREE.InstancedMesh | undefined;
  private plinthPaths: string[] = [];
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
  /** Current render scale: lowered when images take too long, raised back when there is room. */
  private pixelRatio = 1;
  private slow = 0;
  private fast = 0;
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
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = theme.light.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // shadows depend on the buildings, not on the camera: redraw them only when buildings move
    this.renderer.shadowMap.autoUpdate = false;
    container.appendChild(this.renderer.domElement);

    this.perspective = new THREE.PerspectiveCamera(theme.camera.fov, 1, 1, 20000);
    this.camera = this.perspective;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.autoRotateSpeed = 0.6;
    this.controls.addEventListener("change", () => this.requestRender());

    this.sun = new THREE.DirectionalLight();
    this.scene.add(this.ambient, this.sun, this.sun.target);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial());
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.hoverBuilding = new THREE.LineSegments(
      this.unitEdges,
      new THREE.LineBasicMaterial({ depthTest: false }),
    );
    this.hoverFolder = new THREE.LineSegments(
      this.unitEdges,
      new THREE.LineBasicMaterial({ depthTest: false }),
    );
    for (const o of [this.hoverBuilding, this.hoverFolder]) {
      o.visible = false;
      o.renderOrder = 10;
      this.scene.add(o);
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.applyTheme(theme);
    this.resize();
    const loop = (time: number) => {
      this.frame = requestAnimationFrame(loop);
      const dt = this.lastTime ? Math.min(time - this.lastTime, 100) : 0;
      this.lastTime = time;
      const animating = this.onTick?.(dt) ?? false;
      const moved = this.controls.update();
      if (this.dirty || moved || animating) {
        this.dirty = false;
        this.renderer.render(this.scene, this.camera);
        this.fpsFrames++;
        if (animating || moved) this.adaptResolution(dt);
      }
      if (time - this.fpsSince >= 1000) {
        this.fps = (this.fpsFrames * 1000) / (time - this.fpsSince);
        this.fpsFrames = 0;
        this.fpsSince = time;
      }
    };
    this.frame = requestAnimationFrame(loop);
  }

  /**
   * Keeps motion fluid: when several images in a row take longer than 1/40 s the picture is drawn at a
   * lower resolution, and the resolution comes back when images are fast again.
   */
  private adaptResolution(dtMs: number): void {
    const max = Math.min(window.devicePixelRatio || 1, 2);
    if (dtMs > 25) {
      this.fast = 0;
      if (++this.slow >= 3 && this.pixelRatio > 0.75) {
        this.slow = 0;
        this.setPixelRatio(Math.max(0.75, this.pixelRatio * 0.8));
      }
    } else if (dtMs > 0 && dtMs < 14) {
      this.slow = 0;
      if (++this.fast >= 90 && this.pixelRatio < max) {
        this.fast = 0;
        this.setPixelRatio(Math.min(max, this.pixelRatio * 1.15));
      }
    } else {
      this.slow = 0;
    }
  }

  private setPixelRatio(ratio: number): void {
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
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
    (this.hoverBuilding.material as THREE.LineBasicMaterial).color = c("hover");
    (this.hoverFolder.material as THREE.LineBasicMaterial).color = c("folderHover");
    this.uniforms.uEdgeColor.value = v("buildingEdge");
    this.uniforms.uTouchColor.value = v("accent");
    this.uniforms.uLotColor.value = v("plinthEdge");
    this.uniforms.uMode.value = theme.renderer === "voxel" ? 1 : theme.renderer === "wireframe" ? 2 : 0;
    this.uniforms.uFaceAlpha.value = theme.effects?.faceAlpha ?? 0.12;
    this.applyGlow();
    this.ambient.intensity = theme.light.ambient * Math.PI;
    this.sun.intensity = theme.light.sun * Math.PI;
    this.renderer.shadowMap.enabled = theme.light.shadows;
    this.sun.castShadow = theme.light.shadows;
    // the camera is a token too: perspective for a model, orthographic for a plan
    const next = theme.camera.type === "orthographic" ? this.orthographic : this.perspective;
    if (next !== this.camera) {
      this.camera = next;
      this.controls.object = next;
    }
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
  setCity(layout: Layout, paths: readonly string[], delays: Float32Array, keepCamera = false): void {
    this.size = Math.max(layout.width, layout.height);
    this.count = paths.length;
    const theme = this.theme;
    const c = (key: string) => new THREE.Color(theme.colors[key] ?? "");
    for (const m of [this.plinths, this.buildings, this.lots]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
    }

    // plinths: one low box per folder
    const plinthColor = c("plinth");
    const folders = [...layout.folders.entries()].sort((a, b) => folderDepth(a[0]) - folderDepth(b[0]));
    this.plinthPaths = folders.map(([path]) => path);
    this.plinths = new THREE.InstancedMesh(
      this.unitBox,
      new THREE.MeshLambertMaterial(),
      Math.max(folders.length, 1),
    );
    const m4 = new THREE.Matrix4();
    folders.forEach(([path, r], i) => {
      const top = plinthTop(folderDepth(path));
      m4.compose(
        new THREE.Vector3(r.x + r.w / 2, top / 2, r.y + r.h / 2),
        new THREE.Quaternion(),
        new THREE.Vector3(Math.max(r.w, 0.01), top, Math.max(r.h, 0.01)),
      );
      this.plinths?.setMatrixAt(i, m4);
      this.plinths?.setColorAt(i, plinthColor);
    });
    this.plinths.count = folders.length;
    this.plinths.receiveShadow = true;
    this.plinths.castShadow = true;
    this.plinths.instanceMatrix.needsUpdate = true;
    this.plinths.computeBoundingSphere();

    // buildings: one box, drawn once per file, moved by the vertex shader
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = box.index;
    geometry.setAttribute("position", box.getAttribute("position"));
    geometry.setAttribute("normal", box.getAttribute("normal"));
    geometry.instanceCount = this.count;
    const n = Math.max(this.count, 1);
    const attr = (name: string, size: number, array?: Float32Array) => {
      const a = new THREE.InstancedBufferAttribute(array ?? new Float32Array(n * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, a);
    };
    attr("aPosA", 3);
    attr("aPosB", 3);
    attr("aSizeA", 3);
    attr("aSizeB", 3);
    attr("aMiscA", 4);
    attr("aMiscB", 4);
    attr("aColA", 3);
    attr("aColB", 3);
    attr("aFx", 4);
    const delayArray = new Float32Array(n);
    delayArray.set(delays.subarray(0, n));
    attr("aDelay", 1, delayArray);

    const uniforms = this.uniforms;
    const material = new THREE.MeshLambertMaterial();
    if (theme.renderer === "wireframe") {
      // light adds up, so the picture does not depend on the order buildings are drawn in
      material.transparent = true;
      material.blending = THREE.AdditiveBlending;
      material.depthWrite = false;
    }
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      patchVertex(shader);
      shader.vertexShader = shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        /* glsl */ `vec3 objectNormal = fcRotate(normal, mix(aMiscA.x, aMiscB.x, fcLocal()));`,
      );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${FRAGMENT_COMMON}`)
        .replace(
          "#include <color_fragment>",
          /* glsl */ `
          {
            vec3 col = vColor;
            // distance to the nearest edge of the box, in world units, on the face being drawn
            vec3 dist = (0.5 - abs(vBox - vec3(0.0, 0.5, 0.0))) * max(vSize, vec3(0.0001));
            float lo = min(dist.x, min(dist.y, dist.z));
            float hi = max(dist.x, max(dist.y, dist.z));
            float mid = dist.x + dist.y + dist.z - lo - hi;
            float width = fwidth(mid) * 1.4;
            float edge = 1.0 - smoothstep(width * 0.5, width, mid);
            float touched = vFx.x;
            float touchWidth = fwidth(mid) * 2.2;
            float touchEdge = (1.0 - smoothstep(touchWidth * 0.6, touchWidth, mid)) * touched;
            // roof mark: a darker patch on the roof whose size repeats the category
            float roof = mix(vMiscA.w, vMiscB.w, vEase);
            vec2 top = abs(vBox.xz);
            float onRoof = step(0.999, vBox.y) * step(0.001, roof);
            float half_ = 0.125 + 0.275 * roof;
            float mark = onRoof * step(top.x, half_) * step(top.y, half_);
            if (uMode > 0.5 && uMode < 1.5) {
              // blocks: seams between the cubes of the stack, and a small shade per cube, both procedural
              vec3 p = (vBox + vec3(0.5, 0.0, 0.5)) * max(vSize, vec3(0.0001)) / uBlock;
              vec3 onFace = vec3(step(dist.x, lo + 0.0001), step(dist.y, lo + 0.0001), step(dist.z, lo + 0.0001));
              vec3 seam = min(fract(p), 1.0 - fract(p)) + onFace;
              float s = min(seam.x, min(seam.y, seam.z));
              float sw = fwidth(s) * 1.2 + 0.015;
              float seamLine = 1.0 - smoothstep(sw * 0.5, sw, s);
              vec3 cube = floor(p + 0.0001) * (1.0 - onFace);
              float shade = fract(sin(dot(cube, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
              col *= 0.93 + 0.1 * shade;
              col = mix(col, uEdgeColor, seamLine * 0.5);
            }
            if (uMode > 1.5) {
              // wireframe: luminous edges, faint faces, an optional capped glow around the edges
              float halo = (1.0 - smoothstep(0.0, fwidth(mid) * 10.0, mid)) * uGlow;
              float alpha = max(max(edge, touchEdge), max(halo * 0.55, uFaceAlpha));
              vec3 wire = mix(col, uTouchColor, touchEdge);
              fcWire = vec4(wire, alpha);
            }
            col = mix(col, uEdgeColor, max(edge * 0.85, mark * 0.7));
            col = mix(col, uTouchColor, touchEdge * 0.75);
            diffuseColor.rgb = fcToLinear(col);
          }`,
        )
        .replace(
          "#include <opaque_fragment>",
          /* glsl */ `#include <opaque_fragment>
          if (uMode > 1.5) gl_FragColor = vec4(fcToLinear(fcWire.rgb), fcWire.a);`,
        );
    };
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      patchVertex(shader);
    };
    this.buildings = new THREE.Mesh(geometry, material);
    this.buildings.customDepthMaterial = depth;
    this.buildings.castShadow = true;
    this.buildings.receiveShadow = true;
    this.buildings.frustumCulled = false;

    // lots: the outline of every parcel; it fades in when the parcel is empty
    this.parcels = paths.map((path) => layout.files.get(path));
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
    this.lots = new THREE.LineSegments(lotGeometry, lotMaterial);
    this.lots.frustumCulled = false;
    this.lots.raycast = () => {};
    this.scene.add(this.plinths, this.buildings, this.lots);
    this.uniforms.uBlock.value = this.size * (theme.effects?.blockSize ?? 0.008);
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid = undefined;
    }
    if (theme.effects?.grid) {
      const line = c("gridLine");
      this.grid = new THREE.GridHelper(this.size * 3, 150, line, line);
      this.grid.position.set(this.size / 2, 0.01, this.size / 2);
      this.grid.raycast = () => {};
      this.scene.add(this.grid);
    }

    this.ground.scale.set(this.size * 6, this.size * 6, 1);
    this.ground.position.set(this.size / 2, -0.02, this.size / 2);
    const s = this.size;
    const sun = theme.light.sunPosition;
    this.sun.position.set(s / 2 + (sun[0] ?? 0) * s, (sun[1] ?? 1) * s, s / 2 + (sun[2] ?? 0) * s);
    this.sun.target.position.set(s / 2, 0, s / 2);
    this.sun.castShadow = theme.light.shadows;
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
    this.controls.minDistance = s * 0.03;
    this.controls.maxDistance = s * 3;
    this.perspective.far = s * 12;
    this.perspective.updateProjectionMatrix();
    this.hoverBuilding.visible = false;
    this.hoverFolder.visible = false;
    if (!keepCamera) this.resetCamera();
    this.renderer.shadowMap.needsUpdate = true;
    this.requestRender();
  }

  /** Writes both ends of the current move into the instance buffers. Called once per step, not per image. */
  setStates(start: Float32Array, target: Float32Array): void {
    const geometry = this.buildings?.geometry;
    if (!geometry) return;
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
    const lotFx = this.lots?.geometry.getAttribute("aPresence") as THREE.BufferAttribute | undefined;
    const fill = (
      s: Float32Array,
      pos: THREE.BufferAttribute,
      size: THREE.BufferAttribute,
      misc: THREE.BufferAttribute,
      col: THREE.BufferAttribute,
      i: number,
    ) => {
      const o = i * STRIDE;
      pos.setXYZ(i, s[o + X] as number, s[o + Y] as number, s[o + Z] as number);
      size.setXYZ(i, s[o + W] as number, s[o + H] as number, s[o + D] as number);
      misc.setXYZW(
        i,
        s[o + TWIST] as number,
        s[o + RAMP] as number,
        s[o + MODE] as number,
        s[o + ROOF] as number,
      );
      col.setXYZ(i, s[o + R] as number, s[o + G] as number, s[o + B] as number);
    };
    for (let i = 0; i < this.count; i++) {
      fill(start, posA, sizeA, miscA, colA, i);
      fill(target, posB, sizeB, miscB, colB, i);
      const o = i * STRIDE;
      const pa = start[o + PRESENCE] as number;
      const pb = target[o + PRESENCE] as number;
      fx.setXYZW(i, start[o + TOUCHED] as number, pa, target[o + TOUCHED] as number, pb);
      if (lotFx) for (let k = 0; k < 8; k++) lotFx.setXY(i * 8 + k, pa, pb);
    }
    for (const a of [posA, posB, sizeA, sizeB, miscA, miscB, colA, colB, fx]) a.needsUpdate = true;
    this.renderer.shadowMap.needsUpdate = true;
    if (lotFx) lotFx.needsUpdate = true;
    this.requestRender();
  }

  setProgress(u: number): void {
    if (this.uniforms.uProgress.value === u) return;
    this.uniforms.uProgress.value = u;
    this.renderer.shadowMap.needsUpdate = true;
    this.requestRender();
  }

  /** Colors the plinths: districts with a tint get it, the others keep the plain plinth color. */
  setPlinthTints(tints: ReadonlyMap<string, Rgb>): void {
    if (!this.plinths) return;
    const base = new THREE.Color(this.theme.colors.plinth ?? "");
    const col = new THREE.Color();
    this.plinthPaths.forEach((path, i) => {
      const t = tints.get(path);
      if (t) col.setRGB(t[0], t[1], t[2], THREE.SRGBColorSpace);
      else col.copy(base);
      this.plinths?.setColorAt(i, col);
    });
    if (this.plinths.instanceColor) this.plinths.instanceColor.needsUpdate = true;
    this.requestRender();
  }

  /** What is under the pointer: a building as drawn right now, else an empty lot, else the district. */
  pick(clientX: number, clientY: number): Pick {
    if (!this.plinths) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const state = this.readState?.();
    const plinthHit = this.raycaster.intersectObject(this.plinths, false)[0];
    if (state) {
      const hit = pickBuilding(
        [origin.x, origin.y, origin.z],
        [direction.x, direction.y, direction.z],
        state,
      );
      if (hit && (!plinthHit || hit.distance <= plinthHit.distance + 1e-3))
        return { kind: "file", index: hit.index };
    }
    if (!plinthHit || plinthHit.instanceId === undefined) return null;
    if (state) {
      const { x, z } = plinthHit.point;
      for (let i = 0; i < this.parcels.length; i++) {
        const p = this.parcels[i];
        if (!p || x < p.x || x > p.x + p.w || z < p.y || z > p.y + p.h) continue;
        if ((state[i * STRIDE + PRESENCE] as number) < 0.5) return { kind: "lot", index: i };
        break;
      }
    }
    const path = this.plinthPaths[plinthHit.instanceId];
    return path === undefined ? null : { kind: "folder", path };
  }

  /** Outlines the building or lot under the pointer, and its district. */
  setHover(
    pick: Pick,
    folder?: { path: string; rect: { x: number; y: number; w: number; h: number } },
  ): void {
    this.hoverBuilding.visible = false;
    this.hoverFolder.visible = false;
    const state = this.readState?.();
    if (pick?.kind === "file" && state) {
      const o = pick.index * STRIDE;
      const h = state[o + H] as number;
      this.hoverBuilding.position.set(
        state[o + X] as number,
        (state[o + Y] as number) + h / 2,
        state[o + Z] as number,
      );
      this.hoverBuilding.scale.set(
        (state[o + W] as number) * 1.01,
        h * 1.01,
        (state[o + D] as number) * 1.01,
      );
      this.hoverBuilding.rotation.y = state[o + TWIST] as number;
      this.hoverBuilding.visible = true;
    } else if (pick?.kind === "lot") {
      const p = this.parcels[pick.index];
      if (p && state) {
        this.hoverBuilding.position.set(
          p.x + p.w / 2,
          (state[pick.index * STRIDE + Y] as number) + 0.1,
          p.y + p.h / 2,
        );
        this.hoverBuilding.scale.set(p.w * 0.9, 0.2, p.h * 0.9);
        this.hoverBuilding.rotation.y = 0;
        this.hoverBuilding.visible = true;
      }
    }
    if (folder) {
      const top = plinthTop(folderDepth(folder.path));
      const r = folder.rect;
      this.hoverFolder.position.set(r.x + r.w / 2, top / 2, r.y + r.h / 2);
      this.hoverFolder.scale.set(r.w, top + PLINTH_THICKNESS * 0.2, r.h);
      this.hoverFolder.visible = true;
    }
    this.requestRender();
  }

  /**
   * Performance check: draws `images` pictures of a running move one after the other, waiting for the GPU
   * each time, and returns the mean time of one picture in milliseconds.
   */
  benchmark(images = 60, options: { shadows?: boolean; pixelRatio?: number } = {}): number {
    const gl = this.renderer.getContext();
    const hadShadows = this.sun.castShadow;
    const ratio = this.renderer.getPixelRatio();
    if (options.shadows !== undefined) this.sun.castShadow = options.shadows;
    if (options.pixelRatio !== undefined) this.renderer.setPixelRatio(options.pixelRatio);
    const pixel = new Uint8Array(4);
    const before = this.uniforms.uProgress.value;
    const started = performance.now();
    for (let i = 0; i < images; i++) {
      this.uniforms.uProgress.value = (i % 30) / 30;
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.render(this.scene, this.camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    }
    const elapsed = performance.now() - started;
    this.sun.castShadow = hadShadows;
    this.renderer.setPixelRatio(ratio);
    this.uniforms.uProgress.value = before;
    this.requestRender();
    return elapsed / images;
  }

  /** Moves the view to a point of the map, keeping the viewing direction and coming closer. */
  focus(x: number, z: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = Math.min(offset.length(), this.size * 0.6);
    this.controls.target.set(x, 0, z);
    this.camera.position
      .copy(this.controls.target)
      .add(offset.setLength(Math.max(distance, this.size * 0.15)));
    this.controls.update();
    this.requestRender();
  }

  /** Where the camera is, to come back to it after an export that moved it. */
  cameraState(): { position: THREE.Vector3; target: THREE.Vector3; zoom: number } {
    return {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      zoom: this.camera.zoom,
    };
  }

  /**
   * Places the camera at a saved view turned by an angle around the vertical axis through its target.
   * The result depends on the arguments only, so that two exports give the same images.
   */
  setCameraState(state: { position: THREE.Vector3; target: THREE.Vector3; zoom: number }, angle = 0): void {
    const offset = state.position
      .clone()
      .sub(state.target)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    this.controls.target.copy(state.target);
    this.camera.position.copy(state.target).add(offset);
    this.camera.zoom = state.zoom;
    this.camera.lookAt(state.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.requestRender();
  }

  /** The camera as a three-quarter view of the whole city. */
  resetCamera(): void {
    const s = this.size;
    const dir = new THREE.Vector3(...(this.theme.camera.direction as [number, number, number])).normalize();
    this.controls.target.set(s / 2, 0, s / 2);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, s * 1.9);
    this.orthographic.zoom = 1;
    this.resize();
    this.controls.update();
    this.requestRender();
  }

  topView(): void {
    const s = this.size;
    this.controls.target.set(s / 2, 0, s / 2);
    this.camera.position.set(s / 2, s * 1.4, s / 2 + 0.001);
    this.controls.update();
    this.requestRender();
  }

  /** Renders the current view at an exact size and returns it as a canvas. */
  renderToCanvas(width: number, height: number): HTMLCanvasElement {
    const prevRatio = this.renderer.getPixelRatio();
    const prevSize = this.renderer.getSize(new THREE.Vector2());
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.setAspect(width / height);
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    out.getContext("2d")?.drawImage(this.renderer.domElement, 0, 0);
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this.setAspect(prevSize.x / Math.max(prevSize.y, 1));
    this.requestRender();
    return out;
  }

  /** Fits both cameras to a picture shape: the perspective one by its aspect, the orthographic one by its frame. */
  private setAspect(aspect: number): void {
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    const half = this.size * 0.64;
    this.orthographic.left = -half * aspect;
    this.orthographic.right = half * aspect;
    this.orthographic.top = half;
    this.orthographic.bottom = -half;
    this.orthographic.far = this.size * 12;
    this.orthographic.updateProjectionMatrix();
  }

  private resize(): void {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.setAspect(w / h);
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
