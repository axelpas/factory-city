import type { Model } from "../data/model";
import language from "./language.json";
import structure from "./structure.json";

/** A preset sets all channels at once and states the question it answers. Declarative: no viewer code per preset. */
export interface Preset {
  id: string;
  label: string;
  group: string;
  level: number;
  question: string;
  area: string;
  height: string;
  /** Candidates in order: the first one available is used. */
  color: string[];
  /** Optional extra channels, off by default. */
  twist?: string;
  tint?: string;
}

export const PRESETS: readonly Preset[] = [structure as Preset, language as Preset];
export const MIN_COVERAGE = 0.5;

export interface Mapping {
  area: string;
  height: string;
  color: string | null;
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

/** A preset is offered only when its metrics exist for at least half of the code. */
export function presetStatus(model: Model, preset: Preset): PresetStatus {
  for (const id of [preset.area, preset.height]) {
    if (!covered(model, id)) {
      return { preset, available: false, reason: `"${id}" is not available for at least half of the code.` };
    }
  }
  const color = preset.color.find((id) => covered(model, id));
  if (!color) {
    return {
      preset,
      available: false,
      reason: `None of ${preset.color.map((c) => `"${c}"`).join(", ")} is available for at least half of the code.`,
    };
  }
  return {
    preset,
    available: true,
    mapping: { area: preset.area, height: preset.height, color, scale: "sqrt", clampP99: true },
  };
}

export function presetStatuses(model: Model): PresetStatus[] {
  return PRESETS.map((p) => presetStatus(model, p));
}

/** The first available preset: Structure, the default without git history. */
export function defaultMapping(model: Model): { preset: Preset; mapping: Mapping } {
  const first = presetStatuses(model).find((s) => s.available);
  if (first?.mapping) return { preset: first.preset, mapping: first.mapping };
  const numeric = [...model.metrics.values()].filter((m) => m.kind === "number").map((m) => m.id);
  const fallback = numeric[0] ?? "loc";
  const preset = PRESETS[0] as Preset;
  return {
    preset,
    mapping: { area: fallback, height: fallback, color: null, scale: "sqrt", clampP99: true },
  };
}
