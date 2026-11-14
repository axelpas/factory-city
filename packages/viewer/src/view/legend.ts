import type { Model } from "../data/model";
import type { Mapping } from "../presets/index";

export interface LegendLine {
  channel: "Ground area" | "Height" | "Color";
  metric: string;
  /** Plain language: "taller = more complex". */
  text: string;
}

function reading(model: Model, metricId: string, template: (higher: string) => string): string {
  const metric = model.metrics.get(metricId);
  const higher = metric?.higherMeans ?? `a higher ${metric?.label.toLowerCase() ?? metricId}`;
  return template(higher);
}

export function legendLines(model: Model, mapping: Mapping): LegendLine[] {
  const label = (id: string) => model.metrics.get(id)?.label ?? id;
  const lines: LegendLine[] = [
    {
      channel: "Ground area",
      metric: label(mapping.area),
      text: reading(model, mapping.area, (h) => `bigger ground = ${h}`),
    },
    {
      channel: "Height",
      metric: label(mapping.height),
      text: reading(model, mapping.height, (h) => `taller = ${h}`),
    },
  ];
  if (mapping.color) {
    const metric = model.metrics.get(mapping.color);
    const text =
      metric?.kind === "category"
        ? "each color is one value; the roof mark repeats it"
        : reading(model, mapping.color, (h) => `darker = ${h}`);
    lines.push({ channel: "Color", metric: label(mapping.color), text });
  }
  return lines;
}

/** One line telling how much code is hidden and why, with the way to show it. */
export function hiddenContentLine(model: Model, format: (n: number) => string): string | undefined {
  const m = model.manifest;
  if (!m) return undefined;
  const files = Object.values(m.ignored.files).reduce((a, b) => a + b, 0);
  const folders = Object.values(m.ignored.folders).reduce((a, b) => a + b, 0);
  if (files + folders === 0) return undefined;
  const parts: string[] = [];
  if (files > 0) parts.push(`${format(files)} file${files === 1 ? "" : "s"}`);
  if (folders > 0) parts.push(`${format(folders)} folder${folders === 1 ? "" : "s"}`);
  return `${parts.join(" and ")} left out: assets, dependencies, generated or non-code files. Analyze with --all to show everything.`;
}

/** The data level reached and the one action that unlocks the next. */
export function dataLevelLine(model: Model): string {
  const m = model.manifest;
  const level = m?.dataLevel ?? 0;
  if (level >= 1) return `Data level ${level}.`;
  const next = m?.git.available
    ? "Git history is available in this repository: it will unlock level 1 (changes, fixes)."
    : "Analyze a git repository to unlock level 1 (history).";
  return `Data level 0 (files). ${next}`;
}
