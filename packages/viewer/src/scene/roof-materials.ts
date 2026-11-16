import * as THREE from "three";
import type { Theme } from "../themes/index";
import { patchRoofVertex } from "./patches";
import { FRAGMENT_COMMON, type Uniforms } from "./shaders";

/** The material of the roofs of marked buildings, and the one that draws their shadows. */
export function roofMaterials(theme: Theme, uniforms: Uniforms) {
  const roofMaterial = new THREE.MeshLambertMaterial();
  if (theme.renderer === "wireframe") {
    // luminous edges, as the buildings are
    roofMaterial.wireframe = true;
    roofMaterial.transparent = true;
    roofMaterial.blending = THREE.AdditiveBlending;
    roofMaterial.depthWrite = false;
  }
  roofMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    patchRoofVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_COMMON}`)
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
          {
            vec3 col = mix(uMarkColor, uDimColor, uHoverDim * (1.0 - vIsHover) * 0.7);
            diffuseColor.rgb = fcToLinear(col);
          }`,
      );
  };
  const roofDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  roofDepth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    patchRoofVertex(shader);
  };
  return { material: roofMaterial, depth: roofDepth };
}
