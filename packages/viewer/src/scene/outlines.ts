import * as THREE from "three";
import { D, H, STRIDE, W, X, Y, Z } from "../anim/transition";
import { folderDepth, PLINTH_THICKNESS, plinthTop } from "../view/placements";
import { fadeStep, selectionBox } from "../view/scene-logic";
import type { Pick } from "./CityScene";

/** Time the other buildings take to fade when one is pointed at. */
const HOVER_FADE_MS = 140;

type Box = { x: number; y: number; w: number; h: number };

export interface OutlinesHost {
  /** The buildings as drawn right now. */
  state(): Float32Array | undefined;
  /** The parcel of each union file. */
  parcels(): ReadonlyArray<Box | undefined>;
  /** The shader values the fade of the other buildings writes to. */
  uniforms: { uHover: { value: number }; uHoverDim: { value: number } };
  requestRender(): void;
}

/**
 * The outlines drawn over the city: around the building or lot under the pointer (with a heavier halo), around
 * its district, and around the selected building. Pointing at a building also fades the others.
 */
export class Outlines {
  private readonly edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  private readonly building = new THREE.LineSegments(
    this.edges,
    new THREE.LineBasicMaterial({ depthTest: false }),
  );
  /** A second, larger outline reads as one heavier line. */
  private readonly halo = new THREE.LineSegments(this.edges, this.building.material);
  private readonly folder = new THREE.LineSegments(
    this.edges,
    new THREE.LineBasicMaterial({ depthTest: false }),
  );
  /** The outline of the selected building: it stays until another is selected or the details close. */
  private readonly selection = new THREE.Group();
  private readonly selectionMaterial = new THREE.LineBasicMaterial({ depthTest: false });
  private selected: number | null = null;
  /** Share of the fade of the other buildings reached, and the one wanted: 1 while a building is pointed at. */
  private dim = 0;
  private dimTarget = 0;

  constructor(
    scene: THREE.Scene,
    private readonly host: OutlinesHost,
  ) {
    for (const o of [this.building, this.halo, this.folder]) {
      o.visible = false;
      o.renderOrder = 10;
      scene.add(o);
    }
    // two nested outlines read as one heavier line
    for (const grow of [1, 1.03]) {
      const outline = new THREE.LineSegments(this.edges, this.selectionMaterial);
      outline.scale.setScalar(grow);
      outline.renderOrder = 11;
      this.selection.add(outline);
    }
    this.selection.visible = false;
    scene.add(this.selection);
  }

  /** The colors of the theme: the building, its district, and the selection. */
  setColors(hover: THREE.Color, folderHover: THREE.Color, accent: THREE.Color): void {
    (this.building.material as THREE.LineBasicMaterial).color = hover;
    (this.folder.material as THREE.LineBasicMaterial).color = folderHover;
    this.selectionMaterial.color = accent;
  }

  /** The city changed: nothing is pointed at any more. */
  clearHover(): void {
    this.building.visible = false;
    this.folder.visible = false;
  }

  /** Outlines a building as drawn right now, and its halo. */
  private outlineBuilding(state: Float32Array, index: number): void {
    const o = index * STRIDE;
    const h = state[o + H] as number;
    this.building.position.set(
      state[o + X] as number,
      (state[o + Y] as number) + h / 2,
      state[o + Z] as number,
    );
    this.building.scale.set((state[o + W] as number) * 1.01, h * 1.01, (state[o + D] as number) * 1.01);
    this.building.visible = true;
    this.halo.position.copy(this.building.position);
    this.halo.scale.set((state[o + W] as number) * 1.04, h * 1.04, (state[o + D] as number) * 1.04);
    this.halo.visible = true;
  }

  /** Outlines an empty lot, flat on its parcel. */
  private outlineLot(state: Float32Array, index: number): void {
    const p = this.host.parcels()[index];
    if (!p) return;
    this.building.position.set(p.x + p.w / 2, (state[index * STRIDE + Y] as number) + 0.1, p.y + p.h / 2);
    this.building.scale.set(p.w * 0.9, 0.2, p.h * 0.9);
    this.building.rotation.y = 0;
    this.building.visible = true;
  }

  /** Outlines the building or lot under the pointer, and its district. */
  setHover(pick: Pick, folder?: { path: string; rect: Box }): void {
    this.building.visible = false;
    this.halo.visible = false;
    this.folder.visible = false;
    // pointing at a building fades the others, so that it stands out
    if (pick?.kind === "file") this.host.uniforms.uHover.value = pick.index;
    this.dimTarget = pick?.kind === "file" ? 1 : 0;
    const state = this.host.state();
    if (state && pick?.kind === "file") this.outlineBuilding(state, pick.index);
    else if (state && pick?.kind === "lot") this.outlineLot(state, pick.index);
    if (folder) {
      const top = plinthTop(folderDepth(folder.path));
      const r = folder.rect;
      this.folder.position.set(r.x + r.w / 2, top / 2, r.y + r.h / 2);
      this.folder.scale.set(r.w, top + PLINTH_THICKNESS * 0.2, r.h);
      this.folder.visible = true;
    }
    this.host.requestRender();
  }

  /** Fades the other buildings in and out with the pointer; true while it changes. */
  step(dtMs: number): boolean {
    const next = fadeStep(this.dim, this.dimTarget, dtMs, HOVER_FADE_MS);
    if (!next.changed) return false;
    this.dim = next.value;
    this.host.uniforms.uHoverDim.value = this.dim;
    // once the others are back, nothing is pointed at any more
    if (this.dim === 0) this.host.uniforms.uHover.value = -1;
    return true;
  }

  /** Outlines a building until another is selected, or null. The outline follows the building as it moves. */
  setSelection(index: number | null): void {
    this.selected = index;
    this.sync();
    this.host.requestRender();
  }

  /** Puts the selection outline where its building is drawn now. */
  sync(): void {
    const box = selectionBox(this.host.state(), this.selected);
    this.selection.visible = box !== undefined;
    if (!box) return;
    this.selection.position.set(box.x, box.y, box.z);
    this.selection.scale.set(box.w, box.h, box.d);
  }
}
