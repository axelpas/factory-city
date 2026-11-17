import type { Layout } from "@factory-city/layout";
import type { DependencyAudit, Factory, Report } from "@factory-city/schema";
import type { Animator } from "../../anim/animator";
import type { Available } from "../../data/load";
import type { Model } from "../../data/model";
import type { TimelineData } from "../../data/timeline";
import type { Mapping, Preset } from "../../presets/index";
import type { Pick } from "../../scene/CityScene";
import { DEFAULT_THEME, type Theme, themeById } from "../../themes/index";
import { type Insets, NO_INSETS } from "../../view/framing";
import type { ColorLegend } from "../../view/placements";
import type { ScaleKind } from "../../view/scales";
import type { TestsMode } from "../view-panel";

/** What the page shows: the data, the mapping in force, the filter, and what is pointed at or pinned. */
export interface State {
  data: TimelineData;
  /** Model of the frame under the playhead. */
  readonly model: Model;
  /** Model of the last frame: what presets and pickers are offered from. */
  ref: Model;
  layout: Layout;
  preset: Preset | undefined;
  mapping: Mapping;
  legend: ColorLegend;
  search: string;
  tests: TestsMode;
  hover: Pick;
  pinned: Pick;
}

export const HELP_KEY = "fc.help.seen";
export const THEME_KEY = "fc.theme";
export const PANEL_KEY = "fc.panel";
export const INSPECTOR_KEY = "fc.inspector";
export const MOTION_KEY = "fc.motion";
export const LABELS_KEY = "fc.districtNames";
/** Medium windows: the view panel is a rail and the inspector overlays the stage. */
export const MEDIUM_QUERY = "(max-width: 1100px)";

/** Runs something that touches the browser's storage; where there is none, or it is blocked, nothing happens. */
export function safeStorage<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** The theme to start with: `?theme=` in the address, else the last one chosen, else the default. */
export function initialTheme(): Theme {
  const asked = new URLSearchParams(location.search).get("theme");
  const stored = safeStorage(() => localStorage.getItem(THEME_KEY));
  return themeById(asked) ?? themeById(stored) ?? DEFAULT_THEME;
}

/** What the parts of the page share and change: the theme, the data in view, the animation, the report. */
export class Session {
  theme: Theme = initialTheme();
  state: State | undefined;
  animator: Animator | undefined;
  report: Report | undefined;
  factory: Factory | undefined;
  /** Known vulnerabilities of the dependencies, when `analyze --with audit` wrote them. */
  dependencies: DependencyAudit | undefined;
  factoryPeriod: "last30" | "all" = "last30";
  slug: string | undefined;
  available: Available = {};
  /** What the bar, the panels and the timeline cover, as last measured. */
  insets: Insets = NO_INSETS;
  /** The preset in force before a channel was changed by hand: the way back. */
  lastPreset: string | undefined;
  /** The scale before a theme made of blocks imposed its own. */
  scaleBeforeTheme: ScaleKind | undefined;
  /** The buildings of each frame, kept until the mapping, a filter or the theme changes. */
  stateCache = new Map<number, Float32Array>();
  /** The buildings as drawn right now, with what they were drawn for. */
  screen: { u: number; version: number; state: Float32Array } | undefined;
  /** Counts the changes of the buildings, so that `screen` knows when it is stale. */
  version = 0;
  shownFrame = -1;
}
