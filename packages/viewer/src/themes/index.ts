import architect from "./architect.json";

export interface Theme {
  id: string;
  label: string;
  renderer: "solid" | "voxel" | "wireframe";
  mode: "light" | "dark";
  colors: Record<string, string>;
  ramps: { sequential: string[]; diverging: string[]; categorical: string[]; other: string };
  light: { ambient: number; sun: number; sunPosition: number[]; shadows: boolean };
  camera: { type: "perspective" | "orthographic"; fov: number; direction: number[] };
  font: string;
  heightScale: number;
}

export const THEMES: readonly Theme[] = [architect as Theme];
export const DEFAULT_THEME: Theme = THEMES[0] as Theme;

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
