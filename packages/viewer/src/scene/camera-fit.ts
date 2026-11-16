import type * as THREE from "three";
import {
  cityCorners,
  frameOrthographic,
  framePerspective,
  freeRect,
  type Insets,
  type Vec3,
} from "../view/framing";

/** Frame height of the orthographic camera at zoom 1, as a share of the map side. */
export const ORTHO_HEIGHT = 1.28;

export interface FitInput {
  /** The camera in use: the perspective or the orthographic one. */
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  perspective: THREE.PerspectiveCamera;
  orthographic: THREE.OrthographicCamera;
  target: THREE.Vector3;
  /** Side of the city, in world units. */
  size: number;
  /** Height of the tallest thing the city can show. */
  cityHeight: number;
  viewport: { w: number; h: number };
  /** What the panels cover of the picture. */
  insets: Insets;
}

/**
 * Places the camera, along its current direction, so that the city fills the free part of a picture. Returns
 * where the target must land on the picture, in pixels.
 */
export function fitCamera(i: FitInput): { x: number; y: number } {
  const offset = i.camera.position.clone().sub(i.target);
  const input = {
    corners: cityCorners(i.size, i.cityHeight),
    direction: [offset.x, offset.y, offset.z] as Vec3,
    viewport: i.viewport,
    free: freeRect(i.viewport, i.insets),
  };
  let center: { x: number; y: number };
  if (i.camera === i.perspective) {
    const fit = framePerspective({ ...input, fovDeg: i.perspective.fov });
    i.camera.position.copy(i.target).add(offset.setLength(fit.distance));
    center = fit.center;
  } else {
    const fit = frameOrthographic({ ...input, unitsHigh: i.size * ORTHO_HEIGHT });
    i.orthographic.zoom = fit.zoom;
    center = fit.center;
  }
  i.camera.lookAt(i.target);
  return center;
}
