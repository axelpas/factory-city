import { MAX_DELAY } from "../anim/transition";

/** The colors of a ramp the shader can hold. */
export const MAX_RAMP = 8;

/** The values every material of the city shares, by uniform name. */
export type Uniforms = Record<string, { value: unknown }>;

/** Shared by the color and the depth material: where a vertex of a building is, right now. */
export const VERTEX_COMMON = /* glsl */ `
attribute vec3 aPosA;
attribute vec3 aPosB;
attribute vec3 aSizeA;
attribute vec3 aSizeB;
attribute vec4 aMiscA; // marker, ramp, mode, roof
attribute vec4 aMiscB;
attribute vec3 aColA;
attribute vec3 aColB;
attribute vec4 aFx; // touched A, presence A, touched B, presence B
attribute float aDelay;
uniform float uProgress;
varying vec3 vBox;
varying vec3 vSize;
varying vec4 vMiscA;
varying vec4 vMiscB;
varying vec2 vFx;
varying float vEase;
varying vec3 vColor;
varying float vIsHover;
uniform float uHover;
uniform vec3 uRamp[${MAX_RAMP}];
uniform float uRampCount;

vec3 fcToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 fcToSrgb(vec3 c) {
  vec3 x = clamp(c, 0.0, 1.0);
  return mix(x * 12.92, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, x));
}
vec3 fcRampAt(float t) {
  float pos = clamp(t, 0.0, 1.0) * (uRampCount - 1.0);
  int i = int(min(floor(pos), uRampCount - 2.0));
  return mix(uRamp[i], uRamp[i + 1], pos - float(i));
}
vec3 fcOklab(vec3 srgb) {
  vec3 c = fcToLinear(srgb);
  vec3 lms = pow(vec3(
    0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
    0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
    0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b), vec3(1.0 / 3.0));
  return vec3(
    0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
    1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
    0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z);
}
vec3 fcFromOklab(vec3 lab) {
  vec3 lms = pow(vec3(
    lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z,
    lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z,
    lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z), vec3(3.0));
  return fcToSrgb(vec3(
    4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
    -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
    -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z));
}
/** The building's color in sRGB: the ramp read at the interpolated value, or a perceptual cross-fade. */
vec3 fcColor(float e) {
  if (aMiscA.z < 0.5 && aMiscB.z < 0.5) return fcRampAt(mix(aMiscA.y, aMiscB.y, e));
  if (e <= 0.0) return aColA;
  if (e >= 1.0) return aColB;
  return fcFromOklab(mix(fcOklab(aColA), fcOklab(aColB), e));
}

float fcEase(float t) {
  return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}
float fcLocal() {
  return fcEase(clamp((uProgress - aDelay) / (1.0 - ${MAX_DELAY.toFixed(4)}), 0.0, 1.0));
}
vec3 fcPosition(vec3 p) {
  float e = fcLocal();
  vec3 size = mix(aSizeA, aSizeB, e);
  vec3 base = mix(aPosA, aPosB, e);
  float shown = step(0.001, size.y);
  return base + p * size * shown;
}
`;

export const FRAGMENT_COMMON = /* glsl */ `
uniform vec3 uEdgeColor;
uniform vec3 uTouchColor;
uniform vec3 uMarkColor;
// thickness of the building edges, in rendered pixels
uniform float uEdgeWidth;
// 0 solid, 1 blocks, 2 wireframe
uniform float uMode;
uniform float uBlock;
uniform float uGlow;
uniform float uFaceAlpha;
// the others fade while one building is pointed at
uniform float uHoverDim;
uniform vec3 uDimColor;
varying float vIsHover;
vec4 fcWire;
varying vec3 vBox;
varying vec3 vSize;
varying vec4 vMiscA;
varying vec4 vMiscB;
varying vec2 vFx;
varying float vEase;
varying vec3 vColor;

vec3 fcToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
`;
