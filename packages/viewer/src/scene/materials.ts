import * as THREE from "three";
import type { Theme } from "../themes/index";
import { patchVertex } from "./patches";
import { FRAGMENT_COMMON, type Uniforms } from "./shaders";

/** The material of the buildings, and the one that draws their shadows: both follow the animated shape. */
export function buildingMaterials(theme: Theme, uniforms: Uniforms) {
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
      /* glsl */ `vec3 objectNormal = vec3(normal);`,
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
            float width = fwidth(mid) * uEdgeWidth;
            float edge = 1.0 - smoothstep(width * 0.5, width, mid);
            float touched = vFx.x;
            float touchWidth = fwidth(mid) * uEdgeWidth;
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
            col = mix(col, uTouchColor, touchEdge * 0.9);
            float others = uHoverDim * (1.0 - vIsHover);
            col = mix(col, uDimColor, others * 0.7);
            if (uMode > 1.5) {
              fcWire.rgb = mix(fcWire.rgb, uDimColor, others * 0.5);
              fcWire.a *= 1.0 - others * 0.65;
            }
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
  return { material, depth };
}
