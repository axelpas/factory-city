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

/** Color tokens every theme must define: the scene and the style sheets read nothing else. */
export const REQUIRED_COLORS = [
  "background",
  "ground",
  "plinth",
  "plinthEdge",
  "building",
  "buildingEdge",
  "unavailable",
  "hover",
  "folderHover",
  "dim",
  "text",
  "textMuted",
  "panel",
  "panelBorder",
  "accent",
  "accentText",
  "riskLow",
  "riskModerate",
  "riskHigh",
  "riskVeryHigh",
  "kindFeature",
  "kindFix",
  "kindRefactor",
  "kindChore",
  "kindDocs",
  "kindTest",
  "kindUnknown",
] as const;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RENDERERS = ["solid", "voxel", "wireframe"];

/** Checks a token file and returns it as a theme. The message says which token is wrong. */
export function validateTheme(raw: unknown): Theme {
  const t = raw as Partial<Theme> | null;
  const fail = (what: string): never => {
    throw new Error(`Invalid theme${t?.id ? ` "${t.id}"` : ""}: ${what}.`);
  };
  if (!t || typeof t !== "object") return fail("a theme is an object of tokens");
  if (typeof t.id !== "string" || typeof t.label !== "string") return fail("id and label are required");
  if (!RENDERERS.includes(t.renderer as string))
    return fail(`renderer must be one of ${RENDERERS.join(", ")}`);
  if (t.mode !== "light" && t.mode !== "dark") return fail("mode must be light or dark");
  const colors = t.colors ?? {};
  for (const key of REQUIRED_COLORS) {
    if (!HEX.test(colors[key] ?? "")) return fail(`colors.${key} must be a hex color`);
  }
  if (t.effects?.grid && !HEX.test(colors.gridLine ?? ""))
    return fail("colors.gridLine is needed for the ground grid");
  const ramps = t.ramps;
  if (!ramps) return fail("ramps are required");
  for (const name of ["sequential", "diverging", "categorical", "tint"] as const) {
    const list = ramps[name];
    if (!Array.isArray(list) || list.length < 2 || list.length > 8 || !list.every((c) => HEX.test(c))) {
      return fail(`ramps.${name} must hold 2 to 8 hex colors`);
    }
  }
  if (!HEX.test(ramps.other ?? "")) return fail("ramps.other must be a hex color");
  if (!t.light || typeof t.light.ambient !== "number" || typeof t.light.sun !== "number")
    return fail("light.ambient and light.sun are required");
  if (!t.camera || (t.camera.type !== "perspective" && t.camera.type !== "orthographic"))
    return fail("camera.type must be perspective or orthographic");
  if (!Array.isArray(t.camera.direction) || t.camera.direction.length !== 3)
    return fail("camera.direction must hold three numbers");
  if (typeof t.font !== "string" || typeof t.heightScale !== "number")
    return fail("font and heightScale are required");
  return t as Theme;
}

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
