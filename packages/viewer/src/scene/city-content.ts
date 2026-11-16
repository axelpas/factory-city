import type { Layout } from "@factory-city/layout";
import * as THREE from "three";
import type { Theme } from "../themes/index";
import type { Rgb } from "../view/color";
import { folderDepth } from "../view/placements";
import { buildBuildings, buildPlinths, buildRoofs } from "./city-meshes";
import { writeStates } from "./instance-states";
import type { SceneUniforms } from "./look";
import { buildLots } from "./lots";

type Box = { x: number; y: number; w: number; h: number };

/** What stands in the city: the plinths, the buildings, their roofs and the outlines of the lots. */
export class CityContent {
  buildings: THREE.Mesh | undefined;
  roofs: THREE.Mesh | undefined;
  lots: THREE.LineSegments | undefined;
  plinths: THREE.InstancedMesh | undefined;
  plinthPaths: string[] = [];
  /** The parcel of each union file. */
  parcels: Array<Box | undefined> = [];
  maxFolderDepth = 0;
  private count = 0;
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);

  constructor(private readonly scene: THREE.Scene) {}

  /** Builds the plinths, the lots and the building buffers for a layout. States come with `writeStates`. */
  set(
    layout: Layout,
    paths: readonly string[],
    delays: Float32Array,
    theme: Theme,
    uniforms: SceneUniforms,
  ): void {
    this.count = paths.length;
    for (const m of [this.plinths, this.buildings, this.roofs, this.lots]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
    }
    const folders = [...layout.folders.entries()].sort((a, b) => folderDepth(a[0]) - folderDepth(b[0]));
    this.plinthPaths = folders.map(([path]) => path);
    this.maxFolderDepth = folders.reduce((max, [path]) => Math.max(max, folderDepth(path)), 0);
    this.plinths = buildPlinths(this.unitBox, folders, (path) => this.plinthColor(path, theme));
    this.buildings = buildBuildings(this.count, delays, theme, uniforms);
    this.roofs = buildRoofs(this.buildings, this.count, theme, uniforms);
    // lots: the outline of every parcel; it fades in when the parcel is empty
    this.parcels = paths.map((path) => layout.files.get(path));
    this.lots = buildLots(layout, paths, delays, uniforms);
    this.scene.add(this.plinths, this.buildings, this.roofs, this.lots);
  }

  /** Writes both ends of the current move into the instance buffers. Called once per step, not per image. */
  setStates(start: Float32Array, target: Float32Array): boolean {
    const geometry = this.buildings?.geometry;
    if (!geometry) return false;
    const lotFx = this.lots?.geometry.getAttribute("aPresence") as THREE.BufferAttribute | undefined;
    writeStates(geometry, lotFx, this.count, start, target);
    return true;
  }

  /**
   * The slab under the whole city shows between the districts: it takes the street color. Each level of
   * folders is a step lighter, up to the plain plinth color, so a district stands out against its parent.
   */
  private plinthColor(path: string, theme: Theme): THREE.Color {
    const colors = theme.colors;
    const plinth = new THREE.Color(colors.plinth ?? "");
    const street = new THREE.Color(colors.street ?? colors.plinth ?? "");
    const depth = folderDepth(path);
    if (path === "" || depth === 0) return street;
    return street.lerp(plinth, 0.4 + 0.6 * (depth / Math.max(this.maxFolderDepth, 1)));
  }

  /** Colors the plinths: districts with a tint get it, the others keep the plain plinth color. */
  setTints(tints: ReadonlyMap<string, Rgb>, theme: Theme): void {
    if (!this.plinths) return;
    const col = new THREE.Color();
    this.plinthPaths.forEach((path, i) => {
      const t = tints.get(path);
      if (t) col.setRGB(t[0], t[1], t[2], THREE.SRGBColorSpace);
      else col.copy(this.plinthColor(path, theme));
      this.plinths?.setColorAt(i, col);
    });
    if (this.plinths.instanceColor) this.plinths.instanceColor.needsUpdate = true;
  }
}
