import * as THREE from "three";
import type { Theme } from "../themes/index";
import { folderDepth, plinthTop } from "../view/placements";
import { buildingMaterials, roofMaterials } from "./materials";
import { pyramidGeometry } from "./patches";
import type { Uniforms } from "./shaders";

type Folder = [string, { x: number; y: number; w: number; h: number }];

/** The plinths: one low box per folder, the deepest folders last. */
export function buildPlinths(
  unitBox: THREE.BufferGeometry,
  folders: readonly Folder[],
  colorOf: (path: string) => THREE.Color,
): THREE.InstancedMesh {
  const plinths = new THREE.InstancedMesh(
    unitBox,
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
    plinths.setMatrixAt(i, m4);
    plinths.setColorAt(i, colorOf(path));
  });
  plinths.count = folders.length;
  plinths.receiveShadow = true;
  plinths.castShadow = true;
  plinths.instanceMatrix.needsUpdate = true;
  plinths.computeBoundingSphere();
  return plinths;
}

/** The geometry of the buildings: one box, drawn once per file, with the instance buffers for the two ends of a move. */
function buildingGeometry(count: number, delays: Float32Array): THREE.InstancedBufferGeometry {
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = box.index;
  geometry.setAttribute("position", box.getAttribute("position"));
  geometry.setAttribute("normal", box.getAttribute("normal"));
  geometry.instanceCount = count;
  const n = Math.max(count, 1);
  const attr = (name: string, size: number, array?: Float32Array) => {
    const a = new THREE.InstancedBufferAttribute(array ?? new Float32Array(n * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, a);
  };
  for (const [name, size] of [
    ["aPosA", 3],
    ["aPosB", 3],
    ["aSizeA", 3],
    ["aSizeB", 3],
    ["aMiscA", 4],
    ["aMiscB", 4],
    ["aColA", 3],
    ["aColB", 3],
    ["aFx", 4],
  ] as const)
    attr(name, size);
  const delayArray = new Float32Array(n);
  delayArray.set(delays.subarray(0, n));
  attr("aDelay", 1, delayArray);
  return geometry;
}

/** The buildings, moved by the vertex shader. */
export function buildBuildings(
  count: number,
  delays: Float32Array,
  theme: Theme,
  uniforms: Uniforms,
): THREE.Mesh {
  const { material, depth } = buildingMaterials(theme, uniforms);
  const mesh = new THREE.Mesh(buildingGeometry(count, delays), material);
  mesh.customDepthMaterial = depth;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** The roofs: a pyramid on every marked building, driven by the same instance data. */
export function buildRoofs(
  buildings: THREE.Mesh,
  count: number,
  theme: Theme,
  uniforms: Uniforms,
): THREE.Mesh {
  const source = buildings.geometry;
  const geometry = new THREE.InstancedBufferGeometry();
  const pyramid = pyramidGeometry();
  geometry.setAttribute("position", pyramid.getAttribute("position"));
  geometry.setAttribute("normal", pyramid.getAttribute("normal"));
  for (const name of ["aPosA", "aPosB", "aSizeA", "aSizeB", "aMiscA", "aMiscB", "aDelay"])
    geometry.setAttribute(name, source.getAttribute(name));
  geometry.instanceCount = count;
  const { material, depth } = roofMaterials(theme, uniforms);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.customDepthMaterial = depth;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
