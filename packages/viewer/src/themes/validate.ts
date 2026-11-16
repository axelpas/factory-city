import type { Theme } from "./index";

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
