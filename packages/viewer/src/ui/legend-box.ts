import type { Model } from "../data/model";
import { el } from "../lib/dom";
import { format } from "../lib/format";
import type { Theme } from "../themes/index";
import { cssGradient, cssSteps, parseHex, toCss } from "../view/color";
import type { LegendLine, LegendModel } from "../view/legend";
import { type IconName, icon } from "./icons";

const GLYPHS: Record<LegendLine["channel"], IconName> = {
  Area: "area",
  Height: "height",
  Color: "color",
  Marker: "marker",
  "District tint": "tint",
};

type Line = LegendModel["lines"][number];
type Color = LegendModel["color"];

/** One channel: a glyph, the metric, how to read it; it opens on the definition of the metric. */
function channelLine(line: Line, model: Model): HTMLElement {
  const metric = model.metrics.get(line.metricId);
  const summary = el(
    "summary",
    { title: `${line.channel}: ${line.metric}` },
    icon(GLYPHS[line.channel]),
    el("b", { text: line.metric }),
    el("span", { class: "legend-reading", text: line.text }),
  );
  const definition = metric
    ? `${metric.definition} ${metric.limits}`
    : "A value computed by the viewer for this view.";
  return el(
    "details",
    { class: "legend-line", attrs: { "data-channel": line.channel } },
    summary,
    el("p", { class: "legend-def" }, definition),
  );
}

/** The color scale of a number metric, with its bounds. */
function rampView(color: Color, theme: Theme): HTMLElement[] {
  if (color.kind !== "sequential" || color.min === undefined || color.max === undefined) return [];
  const stops = theme.ramps.sequential.map(parseHex);
  const steps = theme.effects?.colorSteps;
  return [
    el("div", {
      class: "ramp",
      style: { background: steps ? cssSteps(stops, steps) : cssGradient(stops) },
      attrs: { role: "img", "aria-label": "Color scale from low to high" },
    }),
    el(
      "div",
      { class: "ramp-labels" },
      el("span", { text: format.number(color.min) }),
      el("span", { text: `${color.clamped ? "≥ " : ""}${format.number(color.max)}` }),
    ),
  ];
}

/** The categories of a category metric, each with a swatch whose roof tells it apart without color. */
function swatchList(color: Color): HTMLElement[] {
  if (color.kind !== "categorical" || !color.categories) return [];
  const items = color.categories.map((c) => {
    const roof = el("i", { class: "roof", style: { width: `${25 + 55 * c.roofMark}%` } });
    return el(
      "li",
      {},
      el("span", { class: "swatch", style: { background: toCss(c.color) } }, roof),
      ` ${c.label} (${format.integer(c.count)})`,
    );
  });
  return [el("ul", { class: "swatches" }, ...items)];
}

function noValueLine(count: number, theme: Theme): HTMLElement[] {
  if (count <= 0) return [];
  return [
    el(
      "div",
      { class: "legend-na" },
      el("span", { class: "swatch", style: { background: theme.colors.unavailable ?? "" } }),
      ` no value (${format.integer(count)} file${count === 1 ? "" : "s"})`,
    ),
  ];
}

/**
 * The legend on the stage: one line per channel (a glyph, the metric, how to read it), the color scale with
 * its bounds, and the color of the files that have no value. A line opens on the definition of its metric.
 */
export function renderLegendBox(box: HTMLElement, legend: LegendModel, model: Model, theme: Theme): void {
  box.replaceChildren(
    ...legend.lines.map((line) => channelLine(line, model)),
    ...rampView(legend.color, theme),
    ...swatchList(legend.color),
    ...noValueLine(legend.unavailable, theme),
    ...(legend.note ? [el("p", { class: "legend-note", text: legend.note })] : []),
  );
}
