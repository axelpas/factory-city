import type { Model } from "../data/model";
import { type Bounded, type Marker, resolveMarker } from "../view/marker";
import agents from "./agents.json";
import bugMagnets from "./bug-magnets.json";
import change from "./change.json";
import cohesion from "./cohesion.json";
import contention from "./contention.json";
import cost from "./cost.json";
import duplication from "./duplication.json";
import hotspots from "./hotspots.json";
import language from "./language.json";
import security from "./security.json";
import shortcuts from "./shortcuts.json";
import structure from "./structure.json";
import threeCs from "./three-cs.json";
import waste from "./waste.json";

/** A preset sets all channels at once and states the question it answers. Declarative: no viewer code per preset. */
export interface Preset {
  id: string;
  label: string;
  group: string;
  level: number;
  question: string;
  /** Shown with an experimental badge. */
  experimental?: boolean;
  area: string;
  height: string;
  /** Candidates in order: the first one available is used. */
  color: string[];
  /** Optional extra channels, off by default. */
  /** Metric of the marker: files above its threshold carry a mark on their roof. */
  marker?: string;
  tint?: string;
  /** What to do when the preset is unavailable, added to the reason. */
  needs?: string;
}

export const PRESETS: readonly Preset[] = [
  structure as Preset,
  cohesion as Preset,
  threeCs as Preset,
  shortcuts as Preset,
  security as Preset,
  duplication as Preset,
  language as Preset,
  hotspots as Preset,
  bugMagnets as Preset,
  waste as Preset,
  contention as Preset,
  agents as Preset,
  cost as Preset,
  change as Preset,
];

/** Default preset, in order of preference: Hotspots with git history, Structure without. */
const DEFAULT_ORDER = ["hotspots", "structure"];
export const MIN_COVERAGE = 0.5;

export interface Mapping {
  area: string;
  height: string;
  color: string | null;
  /** Optional channels, off by default: the marker flags the files above a threshold, the tint colors the plinth of a district. */
  marker: Marker | null;
  tint: string | null;
  scale: "linear" | "sqrt" | "log";
  clampP99: boolean;
}

export interface PresetStatus {
  preset: Preset;
  available: boolean;
  /** Why the preset is unavailable, in plain language. */
  reason?: string;
  mapping?: Mapping;
}

function covered(model: Model, id: string): boolean {
  return (model.coverage.get(id) ?? 0) >= MIN_COVERAGE;
}

const NOT_AVAILABLE = "is not available for at least half of the code.";

/** Why a preset cannot be offered, or nothing when its area, height and marker are all known. */
function missingChannel(model: Model, preset: Preset): string | undefined {
  const id = [preset.area, preset.height, preset.marker].find((m) => m && !covered(model, m));
  return id ? `"${id}" ${NOT_AVAILABLE}` : undefined;
}

/** A preset is offered only when its metrics exist for at least half of the code. */
export function presetStatus(
  model: Model,
  preset: Preset,
  dimensions: readonly Bounded[] = [],
): PresetStatus {
  const reason = missingChannel(model, preset);
  if (reason) return { preset, available: false, reason };
  const color = preset.color.find((id) => covered(model, id));
  if (!color) {
    const missing = `None of ${preset.color.map((c) => `"${c}"`).join(", ")} is available for at least half of the code.`;
    return { preset, available: false, reason: preset.needs ? `${missing} ${preset.needs}` : missing };
  }
  return {
    preset,
    available: true,
    mapping: {
      area: preset.area,
      height: preset.height,
      color,
      marker: preset.marker ? (resolveMarker(model, preset.marker, dimensions) ?? null) : null,
      // the tint is an extra: the preset stays available when too few folders have a value
      tint: preset.tint && covered(model, preset.tint) ? preset.tint : null,
      scale: "sqrt",
      clampP99: true,
    },
  };
}

export function presetStatuses(model: Model, dimensions: readonly Bounded[] = []): PresetStatus[] {
  return PRESETS.map((p) => presetStatus(model, p, dimensions));
}

/** The first available preset: Structure, the default without git history. */
export function defaultMapping(
  model: Model,
  dimensions: readonly Bounded[] = [],
): { preset: Preset; mapping: Mapping } {
  const statuses = presetStatuses(model, dimensions);
  const first =
    DEFAULT_ORDER.map((id) => statuses.find((s) => s.preset.id === id && s.available)).find(
      (s) => s !== undefined,
    ) ?? statuses.find((s) => s.available);
  if (first?.mapping) return { preset: first.preset, mapping: first.mapping };
  const numeric = [...model.metrics.values()].filter((m) => m.kind === "number").map((m) => m.id);
  const fallback = numeric[0] ?? "loc";
  const preset = PRESETS[0] as Preset;
  return {
    preset,
    mapping: {
      area: fallback,
      height: fallback,
      color: null,
      marker: null,
      tint: null,
      scale: "sqrt",
      clampP99: true,
    },
  };
}
