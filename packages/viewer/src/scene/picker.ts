import * as THREE from "three";
import { PRESENCE, STRIDE } from "../anim/transition";
import { pickBuilding, type Vec3 } from "../view/picking";
import type { Pick } from "./CityScene";

type Box = { x: number; y: number; w: number; h: number };

export interface PickerHost {
  renderer: THREE.WebGLRenderer;
  camera(): THREE.Camera;
  /** The ground plinths, one instance per folder. */
  plinths(): THREE.InstancedMesh | undefined;
  plinthPaths(): readonly string[];
  /** The parcel of each union file. */
  parcels(): ReadonlyArray<Box | undefined>;
  /** The buildings as drawn right now. */
  state(): Float32Array | undefined;
}

/** What is under a pixel of the picture: a building as drawn right now, an empty lot, or a district. */
export class Picker {
  private readonly raycaster = new THREE.Raycaster();

  constructor(private readonly host: PickerHost) {}

  /** Points the ray at a pixel, given in pixels from the top left corner of the picture. */
  private aim(px: number, py: number, width: number, height: number): { origin: Vec3; direction: Vec3 } {
    this.raycaster.setFromCamera(
      new THREE.Vector2((px / width) * 2 - 1, -(py / height) * 2 + 1),
      this.host.camera(),
    );
    const { origin, direction } = this.raycaster.ray;
    return { origin: [origin.x, origin.y, origin.z], direction: [direction.x, direction.y, direction.z] };
  }

  /** The empty lot of the parcel the point falls in, if its building is absent from the frame. */
  private lotAt(x: number, z: number, state: Float32Array): Pick {
    const parcels = this.host.parcels();
    for (let i = 0; i < parcels.length; i++) {
      const p = parcels[i];
      if (!p || x < p.x || x > p.x + p.w || z < p.y || z > p.y + p.h) continue;
      return (state[i * STRIDE + PRESENCE] as number) < 0.5 ? { kind: "lot", index: i } : null;
    }
    return null;
  }

  /** The district or the empty lot under a ground hit. */
  private groundAt(hit: THREE.Intersection, state: Float32Array | undefined): Pick {
    const lot = state ? this.lotAt(hit.point.x, hit.point.z, state) : null;
    if (lot) return lot;
    const path = hit.instanceId === undefined ? undefined : this.host.plinthPaths()[hit.instanceId];
    return path === undefined ? null : { kind: "folder", path };
  }

  /** What is under the pointer: a building as drawn right now, else an empty lot, else the district. */
  pick(clientX: number, clientY: number): Pick {
    const plinths = this.host.plinths();
    if (!plinths) return null;
    const rect = this.host.renderer.domElement.getBoundingClientRect();
    const { origin, direction } = this.aim(clientX - rect.left, clientY - rect.top, rect.width, rect.height);
    const state = this.host.state();
    const ground = this.raycaster.intersectObject(plinths, false)[0];
    const hit = state ? pickBuilding(origin, direction, state) : undefined;
    if (hit && (!ground || hit.distance <= ground.distance + 1e-3)) return { kind: "file", index: hit.index };
    return ground ? this.groundAt(ground, state) : null;
  }

  /** True when a building, as drawn right now, is under a pixel of the picture. */
  blocked(px: number, py: number): boolean {
    const state = this.host.state();
    if (!state) return false;
    const size = this.host.renderer.getSize(new THREE.Vector2());
    const { origin, direction } = this.aim(px, py, size.x, size.y);
    return pickBuilding(origin, direction, state) !== undefined;
  }
}
