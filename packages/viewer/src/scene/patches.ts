import * as THREE from "three";
import { VERTEX_COMMON } from "./shaders";

/**
 * The roof of a marked building: a pyramid standing on its top, as wide as the building. It rises with the
 * marker (the marker value is its height) and follows the building through the same instance data.
 */
export function patchRoofVertex(shader: { vertexShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${VERTEX_COMMON}`)
    .replace(
      "#include <begin_vertex>",
      /* glsl */ `
      float roofE = fcLocal();
      vec3 roofSize = mix(aSizeA, aSizeB, roofE);
      vec3 roofBase = mix(aPosA, aPosB, roofE);
      float marked = mix(aMiscA.x, aMiscB.x, roofE);
      float roofH = min(0.4 * min(roofSize.x, roofSize.z), 0.6 * roofSize.y) * marked;
      float roofShown = step(0.001, roofSize.y) * step(0.02, marked);
      vec3 transformed = roofBase + vec3(position.x * roofSize.x, roofSize.y + position.y * roofH, position.z * roofSize.z) * roofShown;
      vIsHover = float(gl_InstanceID) == uHover ? 1.0 : 0.0;`,
    );
}

/** A square pyramid with its base on the ground, one unit wide and one unit high, with flat faces. */
export function pyramidGeometry(): THREE.BufferGeometry {
  const apex = [0, 1, 0];
  const corners = [
    [-0.5, 0, -0.5],
    [0.5, 0, -0.5],
    [0.5, 0, 0.5],
    [-0.5, 0, 0.5],
  ];
  const positions: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i] as number[];
    const b = corners[(i + 1) % 4] as number[];
    positions.push(...a, ...apex, ...b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function patchVertex(shader: { vertexShader: string }): void {
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
        vIsHover = float(gl_InstanceID) == uHover ? 1.0 : 0.0;
        vFx = vec2(mix(aFx.x, aFx.z, e), mix(aFx.y, aFx.w, e));
      }`,
    );
}
