import type { Model } from "../data/model";
import type { Mapping } from "../presets/index";
import { markedCount } from "./marker";
import type { ColorLegend } from "./placements";

export interface LegendLine {
  channel: "Area" | "Height" | "Color" | "Marker" | "District tint";
  /** Id of the metric, to look its definition up. */
  metricId: string;
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
      metricId: mapping.area,
      metric: label(mapping.area),
      text: reading(model, mapping.area, (h) => `bigger ground = ${h}`),
    },
    {
      channel: "Height",
      metricId: mapping.height,
      metric: label(mapping.height),
      text: reading(model, mapping.height, (h) => `taller = ${h}`),
    },
  ];
  if (mapping.color === "@change") {
    lines.push({
      channel: "Color",
      metricId: mapping.color,
      metric: label(mapping.color),
      text: "blue = added or grown, red = removed or shrunk; removed files stay visible",
    });
  } else if (mapping.color) {
    const metric = model.metrics.get(mapping.color);
    const text =
      metric?.kind === "category"
        ? "each color is one value; the roof mark repeats it"
        : reading(model, mapping.color, (h) => `${stronger} = ${h}`);
    lines.push({ channel: "Color", metricId: mapping.color, metric: label(mapping.color), text });
  }
  if (mapping.marker) {
    const { metric, threshold, source } = mapping.marker;
    const count = markedCount(model, mapping.marker);
    const why = { risk: " (high risk)", top: " (the top tenth)", chosen: "" }[source];
    lines.push({
      channel: "Marker",
      metricId: metric,
      metric: label(metric),
      text: `pyramid roof, steeper as it grows = above ${formatNumber(threshold)}${why} · ${formatNumber(count)} file${count === 1 ? "" : "s"}`,
    });
  }
  if (mapping.tint) {
    lines.push({
      channel: "District tint",
      metricId: mapping.tint,
      metric: label(mapping.tint),
      text: reading(model, mapping.tint, (h) => `${stronger} ground = ${h}`),
    });
  }
  return lines;
}

/** Everything the legend shows, on screen and on an exported picture alike. */
export interface LegendModel {
  lines: LegendLine[];
  color: ColorLegend;
  /** Files with no value for the color metric: they are drawn in the "unavailable" color. */
  unavailable: number;
  /** An extra line, such as what one block is worth. */
  note?: string;
}

export function legendModel(
  model: Model,
  mapping: Mapping,
  color: ColorLegend,
  mode: "light" | "dark" = "light",
  formatNumber: (n: number) => string = String,
  note?: string,
): LegendModel {
  const metric = mapping.color && !mapping.color.startsWith("@") ? mapping.color : undefined;
  const unavailable = metric ? model.files.filter((f) => f.values[metric] === undefined).length : 0;
  return {
    lines: legendLines(model, mapping, mode, formatNumber),
    color,
    unavailable,
    ...(note ? { note } : {}),
  };
}
