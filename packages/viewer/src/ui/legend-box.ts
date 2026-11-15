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

/**
 * The legend on the stage: one line per channel (a glyph, the metric, how to read it), the color scale with
 * its bounds, and the color of the files that have no value. A line opens on the definition of its metric.
 */
export function renderLegendBox(box: HTMLElement, legend: LegendModel, model: Model, theme: Theme): void {
  box.replaceChildren();
  for (const line of legend.lines) {
    const metric = model.metrics.get(line.metricId);
    const summary = el(
      "summary",
      { title: `${line.channel}: ${line.metric}` },
      icon(GLYPHS[line.channel]),
      el("b", { text: line.metric }),
      el("span", { class: "legend-reading", text: line.text }),
    );
    box.append(
      el(
        "details",
        { class: "legend-line", attrs: { "data-channel": line.channel } },
        summary,
        el(
          "p",
          { class: "legend-def" },
          metric ? `${metric.definition} ${metric.limits}` : "A value computed by the viewer for this view.",
        ),
      ),
    );
  }
  const color = legend.color;
  if (color.kind === "sequential" && color.min !== undefined && color.max !== undefined) {
    const stops = theme.ramps.sequential.map(parseHex);
    box.append(
      el("div", {
        class: "ramp",
        style: {
          background: theme.effects?.colorSteps
            ? cssSteps(stops, theme.effects.colorSteps)
            : cssGradient(stops),
        },
        attrs: { role: "img", "aria-label": "Color scale from low to high" },
      }),
      el(
        "div",
        { class: "ramp-labels" },
        el("span", { text: format.number(color.min) }),
        el("span", { text: `${color.clamped ? "≥ " : ""}${format.number(color.max)}` }),
      ),
    );
  } else if (color.kind === "categorical" && color.categories) {
    const list = el("ul", { class: "swatches" });
    for (const c of color.categories) {
      const roof = el("i", { class: "roof", style: { width: `${25 + 55 * c.roofMark}%` } });
      list.append(
        el(
          "li",
          {},
          el("span", { class: "swatch", style: { background: toCss(c.color) } }, roof),
          ` ${c.label} (${format.integer(c.count)})`,
        ),
      );
    }
    box.append(list);
  }
  if (legend.unavailable > 0) {
    box.append(
      el(
        "div",
        { class: "legend-na" },
        el("span", { class: "swatch", style: { background: theme.colors.unavailable ?? "" } }),
        ` no value (${format.integer(legend.unavailable)} file${legend.unavailable === 1 ? "" : "s"})`,
      ),
    );
  }
  if (legend.note) box.append(el("p", { class: "legend-note", text: legend.note }));
}
