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
  "street",
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
  "positive",
  "negative",
  "marker",
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

type Tokens = Partial<Theme>;
/** A check says what is wrong with the tokens, or nothing when they are fine. */
type Check = (t: Tokens) => string | undefined;

const isHex = (value: string | undefined) => HEX.test(value ?? "");

const identity: Check = (t) =>
  typeof t.id !== "string" || typeof t.label !== "string" ? "id and label are required" : undefined;

const renderer: Check = (t) =>
  RENDERERS.includes(t.renderer as string) ? undefined : `renderer must be one of ${RENDERERS.join(", ")}`;

const mode: Check = (t) =>
  t.mode === "light" || t.mode === "dark" ? undefined : "mode must be light or dark";

const colors: Check = (t) => {
  const missing = REQUIRED_COLORS.find((key) => !isHex(t.colors?.[key]));
  if (missing) return `colors.${missing} must be a hex color`;
  return t.effects?.grid && !isHex(t.colors?.gridLine)
    ? "colors.gridLine is needed for the ground grid"
    : undefined;
};

const RAMPS = ["sequential", "diverging", "categorical", "tint"] as const;

const ramps: Check = (t) => {
  if (!t.ramps) return "ramps are required";
  const bad = RAMPS.find((name) => {
    const list = t.ramps?.[name];
    return !Array.isArray(list) || list.length < 2 || list.length > 8 || !list.every((c) => HEX.test(c));
  });
  if (bad) return `ramps.${bad} must hold 2 to 8 hex colors`;
  return isHex(t.ramps.other) ? undefined : "ramps.other must be a hex color";
};

const light: Check = (t) =>
  t.light && typeof t.light.ambient === "number" && typeof t.light.sun === "number"
    ? undefined
    : "light.ambient and light.sun are required";

const camera: Check = (t) => {
  if (!t.camera || (t.camera.type !== "perspective" && t.camera.type !== "orthographic"))
    return "camera.type must be perspective or orthographic";
  const direction = t.camera.direction;
  return Array.isArray(direction) && direction.length === 3
    ? undefined
    : "camera.direction must hold three numbers";
};

const typography: Check = (t) =>
  typeof t.font === "string" && typeof t.heightScale === "number"
    ? undefined
    : "font and heightScale are required";

const CHECKS: readonly Check[] = [identity, renderer, mode, colors, ramps, light, camera, typography];

/** Checks a token file and returns it as a theme. The message says which token is wrong. */
export function validateTheme(raw: unknown): Theme {
  const t = raw as Tokens | null;
  const problem = !t || typeof t !== "object" ? "a theme is an object of tokens" : firstProblem(t);
  if (problem) throw new Error(`Invalid theme${t?.id ? ` "${t.id}"` : ""}: ${problem}.`);
  return t as Theme;
}

function firstProblem(t: Tokens): string | undefined {
  for (const check of CHECKS) {
    const problem = check(t);
    if (problem) return problem;
  }
  return undefined;
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
