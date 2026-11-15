import { srgbToOklab } from "../anim/oklab";
import type { Rgb } from "../view/color";

function linear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function gamma(c: number): number {
  const x = Math.min(Math.max(c, 0), 1);
  return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
}

/** Relative luminance of an sRGB color, 0 (black) to 1 (white), as in WCAG. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio of two colors, from 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export type Deficiency = "protanopia" | "deuteranopia";

// Viénot, Brettel and Mollon (1999) dichromat simulation, applied in linear RGB.
const MATRICES: Record<Deficiency, number[]> = {
  protanopia: [0.11238, 0.88762, 0, 0.11238, 0.88762, 0, 0.00401, -0.00401, 1],
  deuteranopia: [0.29275, 0.70725, 0, 0.29275, 0.70725, 0, -0.02234, 0.02234, 1],
};

/** How a color looks to someone with a red-green color vision deficiency. */
export function simulate([r, g, b]: Rgb, deficiency: Deficiency): Rgb {
  const m = MATRICES[deficiency];
  const lr = linear(r);
  const lg = linear(g);
  const lb = linear(b);
  const at = (i: number) => (m[i] as number) * lr + (m[i + 1] as number) * lg + (m[i + 2] as number) * lb;
  return [gamma(at(0)), gamma(at(3)), gamma(at(6))];
}

/** Perceptual distance between two colors (in OKLab), optionally as seen with a color vision deficiency. */
export function distance(a: Rgb, b: Rgb, deficiency?: Deficiency): number {
  const x = srgbToOklab(deficiency ? simulate(a, deficiency) : a);
  const y = srgbToOklab(deficiency ? simulate(b, deficiency) : b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
