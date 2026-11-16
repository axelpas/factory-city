import type * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { easeInOut, moveProgress } from "../view/scene-logic";

/** A view the camera moves to or from. */
export interface View {
  position: THREE.Vector3;
  target: THREE.Vector3;
  zoom: number;
}

/** The camera a move acts on: it changes when the orthographic and the perspective camera swap. */
export interface FlyHost {
  camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera;
  controls(): OrbitControls;
}

/** A camera move from the current view to another, eased, run by the frame clock. */
export class CameraFly {
  private move: { elapsed: number; ms: number; from: View; to: View } | undefined;

  constructor(private readonly host: FlyHost) {}

  /** Moves to a view in `ms` milliseconds; 0 is a cut. Returns true when it was a cut. */
  start(to: View, ms: number): boolean {
    const controls = this.host.controls();
    const camera = this.host.camera();
    if (ms <= 0) {
      this.move = undefined;
      controls.target.copy(to.target);
      camera.position.copy(to.position);
      camera.zoom = to.zoom;
      camera.updateProjectionMatrix();
      controls.update();
      return true;
    }
    this.move = {
      elapsed: 0,
      ms,
      from: { position: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom },
      to,
    };
    return false;
  }

  /** Stops a move in progress, where it is. */
  cancel(): void {
    this.move = undefined;
  }

  /** Advances the move; true while it runs. */
  step(dtMs: number): boolean {
    const f = this.move;
    if (!f) return false;
    f.elapsed += dtMs;
    const t = moveProgress(f.elapsed, f.ms);
    const e = easeInOut(t);
    const camera = this.host.camera();
    this.host.controls().target.lerpVectors(f.from.target, f.to.target, e);
    camera.position.lerpVectors(f.from.position, f.to.position, e);
    camera.zoom = f.from.zoom + (f.to.zoom - f.from.zoom) * e;
    camera.updateProjectionMatrix();
    if (t >= 1) this.move = undefined;
    return true;
  }
}
