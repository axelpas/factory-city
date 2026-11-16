import architect from "./architect.json";
import blocks from "./blocks.json";
import hologram from "./hologram.json";
import isometric from "./isometric.json";

/**
 * A theme is one declarative token file: palette, color ramps, lighting, camera, typography, building
 * renderer and effects. The scene offers three renderers on the same instanced box (`solid`, `voxel`,
 * `wireframe`); a theme picks one. Adding a theme that uses an existing renderer needs no scene code.
 */
export interface Theme {
  id: string;
  label: string;
  renderer: "solid" | "voxel" | "wireframe";
  mode: "light" | "dark";
  colors: Record<string, string>;
  ramps: { sequential: string[]; diverging: string[]; categorical: string[]; other: string; tint: string[] };
  light: { ambient: number; sun: number; sunPosition: number[]; shadows: boolean };
  camera: { type: "perspective" | "orthographic"; fov: number; direction: number[] };
  font: string;
  heightScale: number;
  /** Height scale the theme prefers when it is chosen (Blocks counts whole blocks: linear reads best). */
  scale?: "linear" | "sqrt" | "log";
  /** What the renderer draws on top of the data. None of it carries a metric. */
  effects?: {
    /** A fine grid on the ground. */
    grid?: boolean;
    /** Glow around wireframe edges, 0 to 1; capped at 0.6 and can be switched off. */
    glow?: number;
    /** Opacity of wireframe faces, so that what stands behind stays visible. */
    faceAlpha?: number;
    /** Side of one block, as a share of the map's side. */
    blockSize?: number;
    /** Number of discrete steps the color metric is shown in. */
    colorSteps?: number;
  };
}

export { REQUIRED_COLORS, validateTheme } from "./validate";

import { validateTheme } from "./validate";

export const THEMES: readonly Theme[] = [architect, isometric, blocks, hologram].map(validateTheme);
export const DEFAULT_THEME: Theme = THEMES[0] as Theme;

export function themeById(id: string | null | undefined): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Exposes the theme's tokens as CSS variables on the document: style sheets use only `var(--...)`. */
export function applyTheme(theme: Theme, root: HTMLElement): void {
  for (const [key, value] of Object.entries(theme.colors)) root.style.setProperty(`--c-${kebab(key)}`, value);
  root.style.setProperty("--font", theme.font);
  root.dataset.theme = theme.id;
  root.dataset.mode = theme.mode;
}
