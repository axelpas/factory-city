import type { Report } from "@factory-city/schema";
import type { Model } from "../data/model";
import { el } from "../lib/dom";
import { format } from "../lib/format";
import { type Mapping, MIN_COVERAGE } from "../presets/index";
import { resolveMarker } from "../view/marker";

export type Role = "area" | "height" | "color" | "marker" | "tint";

/** What a picker offers and reads: the metrics of the last frame, the model of this one, the mapping in force. */
export interface PickerContext {
  /** Model of the last frame: what is offered. */
  ref: Model;
  /** Model of the frame under the playhead: what is named. */
  model: Model;
  mapping: Mapping;
  report: Report | undefined;
  setMapping(patch: Partial<Mapping>): void;
  /** The panel must be drawn again (the marker appears or goes). */
  rebuild(): void;
}

/** The metrics a role can use: enough of them is known, and the kind fits (a folder metric for the tint). */
function usable(role: Role, ref: Model): string[] {
  return [...ref.metrics.values()]
    .filter((m) => m.id !== "is_test")
    .filter((m) => (role === "tint" ? m.scope === "folder" : m.scope === "file"))
    .filter((m) => role === "color" || m.kind !== "category")
    .filter((m) => (ref.coverage.get(m.id) ?? 0) >= MIN_COVERAGE)
    .map((m) => m.id);
}

/** Definition, computation, why it matters, direction and limits: all from the registry. */
function metricHelp(model: Model, id: string | null): HTMLElement {
  const m = id ? model.metrics.get(id) : undefined;
  if (!m) return el("div", { class: "help-body", text: "Buildings stay white." });
  const direction = {
    "higher-is-worse": "A higher value is worse.",
    "higher-is-better": "A higher value is better.",
    neutral: "Neither high nor low is good or bad.",
  }[m.direction];
  return el(
    "div",
    { class: "help-body" },
    el("p", { text: m.definition }),
    el("p", {}, el("b", { text: "How: " }), m.computation),
    el("p", {}, el("b", { text: "Why: " }), m.why),
    el("p", { text: direction }),
    el("p", {}, el("b", { text: "Limits: " }), m.limits),
    el("p", {
      class: "muted",
      text: `Data level ${m.level}${m.experimental ? " · experimental" : ""}${m.retrospective ? " · retrospective" : ""}`,
    }),
  );
}

function optionsOf(role: Role, c: PickerContext, current: string | null): HTMLOptionElement[] {
  const none =
    role === "color"
      ? [el("option", { text: "none (white)", attrs: { value: "" } })]
      : role === "marker" || role === "tint"
        ? [el("option", { text: "none", attrs: { value: "" } })]
        : [];
  const metrics = usable(role, c.ref).map((id) => {
    const o = el("option", { text: c.model.metrics.get(id)?.label ?? id, attrs: { value: id } });
    if (id === current) o.selected = true;
    return o;
  });
  return [...none, ...metrics];
}

function applyChoice(role: Role, value: string, c: PickerContext): void {
  if (role === "marker") {
    const marker = value ? resolveMarker(c.ref, value, c.report?.dimensions) : undefined;
    c.setMapping({ marker: marker ?? null });
    c.rebuild();
    return;
  }
  const optional = role === "color" || role === "tint";
  c.setMapping({ [role]: optional ? value || null : value });
}

/** A choice of metric for a channel, with the help of the metric on demand. */
export function metricPicker(role: Role, label: string, title: string, c: PickerContext): HTMLElement {
  const current = role === "marker" ? (c.mapping.marker?.metric ?? null) : c.mapping[role];
  const select = el("select", { title, attrs: { "aria-label": label } }, ...optionsOf(role, c, current));
  const summary = () =>
    el("summary", { text: "?", title: `What does this ${label.toLowerCase()} metric mean?` });
  const help = el("details", { class: "metric-help popover" }, summary(), metricHelp(c.model, current));
  select.addEventListener("change", () => {
    applyChoice(role, select.value, c);
    help.replaceChildren(summary(), metricHelp(c.model, select.value || null));
  });
  return el(
    "div",
    { class: "picker" },
    el("div", { class: "row" }, el("label", { text: label }), select, help),
  );
}

/** The threshold of the marker: the automatic one is shown, and can be replaced by a value typed in. */
export function markerThreshold(c: PickerContext): HTMLElement | undefined {
  const marker = c.mapping.marker;
  if (!marker) return undefined;
  const automatic = resolveMarker(c.ref, marker.metric, c.report?.dimensions);
  const input = el("input", {
    title: "Files above this value are marked. Leave empty for the automatic threshold.",
    attrs: {
      type: "number",
      step: "any",
      "aria-label": "Marker threshold",
      placeholder: automatic ? format.number(automatic.threshold) : "",
    },
  });
  if (marker.source === "chosen") input.value = String(marker.threshold);
  input.addEventListener("change", () => {
    const chosen = input.value.trim() === "" ? undefined : Number(input.value);
    const next = resolveMarker(c.ref, marker.metric, c.report?.dimensions, chosen);
    c.setMapping({ marker: next ?? null });
  });
  return el("div", { class: "row" }, el("label", { text: "above" }), input);
}
