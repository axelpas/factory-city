import type { Layout } from "@factory-city/layout";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Theme } from "../themes/index";
import { folderDepth, PLINTH_THICKNESS, type Placement, plinthTop } from "../view/placements";

export type Pick = { kind: "file"; index: number } | { kind: "folder"; path: string } | null;

export interface PlacementStyle {
  /** Instances to draw dimmed (search filter, dimmed tests). */
  dimmed?: ReadonlySet<number>;
  /** Instances to leave out entirely. */
  hidden?: ReadonlySet<number>;
}

const HIDDEN_SCALE = 1e-4;
const DIM_MIX = 0.82;

/** The 3D city: instanced buildings and plinths, outlines, camera, picking and offscreen rendering. */
export class CityScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly unitEdges = new THREE.EdgesGeometry(this.unitBox);
  private readonly sun: THREE.DirectionalLight;
  private readonly ground: THREE.Mesh;
  private readonly hoverBuilding: THREE.LineSegments;
  private readonly hoverFolder: THREE.LineSegments;
  private buildings: THREE.InstancedMesh | undefined;
  private roofs: THREE.InstancedMesh | undefined;
  private plinths: THREE.InstancedMesh | undefined;
  private edges: THREE.LineSegments | undefined;
  private plinthPaths: string[] = [];
  private hiddenInstances: ReadonlySet<number> = new Set();
  private placements: Array<Placement | undefined> = [];
  private size = 1000;
  private dirty = true;
  private frame = 0;
  private resizeObserver: ResizeObserver;
  private theme: Theme;

  constructor(
    private readonly container: HTMLElement,
    theme: Theme,
  ) {
    this.theme = theme;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = theme.light.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(theme.camera.fov, 1, 1, 20000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener("change", () => this.requestRender());

    this.scene.add(new THREE.AmbientLight(undefined, theme.light.ambient * Math.PI));
    this.sun = new THREE.DirectionalLight(undefined, theme.light.sun * Math.PI);
    this.scene.add(this.sun, this.sun.target);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial());
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.hoverBuilding = new THREE.LineSegments(
      this.unitEdges,
      new THREE.LineBasicMaterial({ linewidth: 2, depthTest: false }),
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
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      const moved = this.controls.update();
      if (this.dirty || moved) {
        this.dirty = false;
        this.renderer.render(this.scene, this.camera);
      }
    };
    loop();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  requestRender(): void {
    this.dirty = true;
  }

  applyTheme(theme: Theme): void {
    this.theme = theme;
    const c = (key: string) => new THREE.Color(theme.colors[key] ?? "");
    this.scene.background = c("background");
    (this.ground.material as THREE.MeshLambertMaterial).color = c("ground");
    (this.hoverBuilding.material as THREE.LineBasicMaterial).color = c("hover");
    (this.hoverFolder.material as THREE.LineBasicMaterial).color = c("folderHover");
    this.requestRender();
  }

  /** Builds the plinths and the ground for a layout. Buildings come with `setPlacements`. */
  setCity(layout: Layout, fileCount: number): void {
    this.size = Math.max(layout.width, layout.height);
    const theme = this.theme;
    const c = (key: string) => new THREE.Color(theme.colors[key] ?? "");

    for (const m of [this.plinths, this.buildings, this.roofs]) {
      if (m) {
        this.scene.remove(m);
        m.dispose();
      }
    }
    const folders = [...layout.folders.entries()].sort((a, b) => folderDepth(a[0]) - folderDepth(b[0]));
    this.plinthPaths = folders.map(([path]) => path);
    this.plinths = new THREE.InstancedMesh(
      this.unitBox,
      new THREE.MeshLambertMaterial({ color: c("plinth") }),
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
    });
    this.plinths.count = folders.length;
    this.plinths.receiveShadow = true;
    this.plinths.castShadow = true;
    this.plinths.instanceMatrix.needsUpdate = true;
    this.plinths.computeBoundingSphere();

    // the material stays white: per-instance colors carry the data
    const white = new THREE.MeshLambertMaterial();
    this.buildings = new THREE.InstancedMesh(this.unitBox, white, Math.max(fileCount, 1));
    this.buildings.count = fileCount;
    this.buildings.castShadow = true;
    this.buildings.receiveShadow = true;
    this.roofs = new THREE.InstancedMesh(
      this.unitBox,
      new THREE.MeshLambertMaterial({ color: c("buildingEdge") }),
      Math.max(fileCount, 1),
    );
    this.roofs.count = fileCount;
    this.scene.add(this.plinths, this.buildings, this.roofs);

    this.ground.scale.set(this.size * 6, this.size * 6, 1);
    this.ground.position.set(this.size / 2, -0.02, this.size / 2);
    const s = this.size;
    this.sun.position.set(
      s / 2 + (theme.light.sunPosition[0] ?? 0) * s,
      (theme.light.sunPosition[1] ?? 1) * s,
      s / 2 + (theme.light.sunPosition[2] ?? 0) * s,
    );
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
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.controls.minDistance = s * 0.03;
    this.controls.maxDistance = s * 3;
    this.camera.far = s * 12;
    this.camera.updateProjectionMatrix();
    this.hoverBuilding.visible = false;
    this.hoverFolder.visible = false;
    this.resetCamera();
  }

  setPlacements(placements: Array<Placement | undefined>, style: PlacementStyle = {}): void {
    if (!this.buildings || !this.roofs) return;
    this.placements = placements;
    this.hiddenInstances = style.hidden ?? new Set();
    const dim = new THREE.Color(this.theme.colors.dim ?? "");
    const roofColor = new THREE.Color(this.theme.colors.buildingEdge ?? "");
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    const edgeColor = new THREE.Color(this.theme.colors.buildingEdge ?? "");
    const edgePositions: number[] = [];
    const unit = this.unitEdges.getAttribute("position");

    placements.forEach((p, i) => {
      if (!p) {
        m4.compose(new THREE.Vector3(), q, new THREE.Vector3(HIDDEN_SCALE, HIDDEN_SCALE, HIDDEN_SCALE));
        this.buildings?.setMatrixAt(i, m4);
        this.roofs?.setMatrixAt(i, m4);
        return;
      }
      const hidden = style.hidden?.has(i) ?? false;
      const h = hidden ? HIDDEN_SCALE : p.h;
      const w = hidden ? HIDDEN_SCALE : p.w;
      const d = hidden ? HIDDEN_SCALE : p.d;
      m4.compose(new THREE.Vector3(p.x, p.baseY + h / 2, p.z), q, new THREE.Vector3(w, h, d));
      this.buildings?.setMatrixAt(i, m4);
      col.setRGB(p.color[0], p.color[1], p.color[2], THREE.SRGBColorSpace);
      if (style.dimmed?.has(i)) col.lerp(dim, DIM_MIX);
      this.buildings?.setColorAt(i, col);

      // roof mark: a darker patch on top whose size repeats the category, so color is never the only cue
      const showRoof = !hidden && p.roofMark > 0 && !p.colorUnavailable;
      const roof = showRoof ? 0.25 + 0.55 * p.roofMark : HIDDEN_SCALE;
      m4.compose(
        new THREE.Vector3(p.x, p.baseY + h + 0.3, p.z),
        q,
        new THREE.Vector3(showRoof ? w * roof : roof, 0.6, showRoof ? d * roof : roof),
      );
      this.roofs?.setMatrixAt(i, m4);
      this.roofs?.setColorAt(i, roofColor);

      if (!hidden) {
        for (let k = 0; k < unit.count; k++) {
          edgePositions.push(
            p.x + unit.getX(k) * w,
            p.baseY + h / 2 + unit.getY(k) * h,
            p.z + unit.getZ(k) * d,
          );
        }
      }
    });
    for (const m of [this.buildings, this.roofs]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
    if (this.edges) {
      this.scene.remove(this.edges);
      this.edges.geometry.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
    this.edges = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: edgeColor }));
    this.edges.raycast = () => {};
    this.scene.add(this.edges);
    this.requestRender();
  }

  /** Finds what is under the pointer: a building first, else the district's plinth. */
  pick(clientX: number, clientY: number): Pick {
    if (!this.buildings || !this.plinths) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster
      .intersectObject(this.buildings, false)
      .filter((h) => h.instanceId !== undefined && !this.hiddenInstances.has(h.instanceId));
    const plinthHit = this.raycaster.intersectObject(this.plinths, false)[0];
    const building = hits[0];
    if (
      building &&
      building.instanceId !== undefined &&
      (!plinthHit || building.distance <= plinthHit.distance + 1e-6)
    ) {
      return { kind: "file", index: building.instanceId };
    }
    if (plinthHit && plinthHit.instanceId !== undefined) {
      const path = this.plinthPaths[plinthHit.instanceId];
      if (path !== undefined) return { kind: "folder", path };
    }
    return null;
  }

  setHover(pick: Pick, folderRect?: { x: number; y: number; w: number; h: number }): void {
    this.hoverBuilding.visible = false;
    this.hoverFolder.visible = false;
    if (pick?.kind === "file") {
      const p = this.placements[pick.index];
      if (p) {
        this.hoverBuilding.position.set(p.x, p.baseY + p.h / 2, p.z);
        this.hoverBuilding.scale.set(p.w * 1.01, p.h * 1.01, p.d * 1.01);
        this.hoverBuilding.visible = true;
      }
    }
    if (folderRect) {
      const top = plinthTop(folderDepth(pick?.kind === "folder" ? pick.path : ""));
      this.hoverFolder.position.set(
        folderRect.x + folderRect.w / 2,
        top / 2,
        folderRect.y + folderRect.h / 2,
      );
      this.hoverFolder.scale.set(folderRect.w, top + PLINTH_THICKNESS * 0.2, folderRect.h);
      this.hoverFolder.visible = true;
    }
    this.requestRender();
  }

  /** The camera as a three-quarter view of the whole city. */
  resetCamera(): void {
    const s = this.size;
    const dir = new THREE.Vector3(...(this.theme.camera.direction as [number, number, number])).normalize();
    this.controls.target.set(s / 2, 0, s / 2);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, s * 1.9);
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
    const prevAspect = this.camera.aspect;
    const prevSize = this.renderer.getSize(new THREE.Vector2());
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    out.getContext("2d")?.drawImage(this.renderer.domElement, 0, 0);
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();
    this.requestRender();
    return out;
  }

  private resize(): void {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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
