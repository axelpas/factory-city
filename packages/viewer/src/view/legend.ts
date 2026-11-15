import type { Model } from "../data/model";
import type { Mapping } from "../presets/index";
import { markedCount } from "./marker";

export interface LegendLine {
  channel: "Area" | "Height" | "Color" | "Marker" | "District tint";
  metric: string;
  /** Plain language: "taller = more complex". */
  text: string;
}

function reading(model: Model, metricId: string, template: (higher: string) => string): string {
  const metric = model.metrics.get(metricId);
  const higher = metric?.higherMeans ?? `a higher ${metric?.label.toLowerCase() ?? metricId}`;
  return template(higher);
}

/** `mode` is the theme's: on a dark background a higher value is drawn brighter, on a light one darker. */
export function legendLines(
  model: Model,
  mapping: Mapping,
  mode: "light" | "dark" = "light",
  formatNumber: (n: number) => string = String,
): LegendLine[] {
  const stronger = mode === "dark" ? "brighter" : "darker";
  const label = (id: string) => model.metrics.get(id)?.label ?? id;
  const lines: LegendLine[] = [
    {
      channel: "Area",
      metric: label(mapping.area),
      text: reading(model, mapping.area, (h) => `bigger ground = ${h}`),
    },
    {
      channel: "Height",
      metric: label(mapping.height),
      text: reading(model, mapping.height, (h) => `taller = ${h}`),
    },
  ];
  if (mapping.color === "@change") {
    lines.push({
      channel: "Color",
      metric: label(mapping.color),
      text: "blue = added or grown, red = removed or shrunk; removed files stay visible",
    });
  } else if (mapping.color) {
    const metric = model.metrics.get(mapping.color);
    const text =
      metric?.kind === "category"
        ? "each color is one value; the roof mark repeats it"
        : reading(model, mapping.color, (h) => `${stronger} = ${h}`);
    lines.push({ channel: "Color", metric: label(mapping.color), text });
  }
  if (mapping.marker) {
    const { metric, threshold, source } = mapping.marker;
    const count = markedCount(model, mapping.marker);
    const why = { risk: " (high risk)", top: " (the top tenth)", chosen: "" }[source];
    lines.push({
      channel: "Marker",
      metric: label(metric),
      text: `ring on the roof = above ${formatNumber(threshold)}${why} · ${formatNumber(count)} file${count === 1 ? "" : "s"}`,
    });
  }
  if (mapping.tint) {
    lines.push({
      channel: "District tint",
      metric: label(mapping.tint),
      text: reading(model, mapping.tint, (h) => `${stronger} ground = ${h}`),
    });
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
  if (level === 1) {
    return "Data level 1 (history). Sign in to `gh` on a GitHub repository to add issue titles and CI runs (level 2).";
  }
  if (level === 2)
    return "Data level 2 (forge): issue titles come from GitHub. A facts file unlocks level 3.";
  if (level >= 3) return "Data level 3 (facts): agent, model, outcome and cost come from your facts file.";
  const next = m?.git.available
    ? "Git history is available in this repository: it will unlock level 1 (changes, fixes)."
    : "Analyze a git repository to unlock level 1 (history).";
  return `Data level 0 (files). ${next}`;
}
