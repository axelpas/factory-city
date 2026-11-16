import type { Report } from "@factory-city/schema";
import type { Model } from "../data/model";
import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import { type Mapping, MIN_COVERAGE, PRESETS, type Preset } from "../presets/index";
import { resolveMarker } from "../view/marker";
import { SCALE_KINDS, type ScaleKind } from "../view/scales";
import { icon } from "./icons";

export type TestsMode = "show" | "dim" | "hide";

type Role = "area" | "height" | "color" | "marker" | "tint";

/** What the panel shows and changes of the page: the mapping, and the filter it writes into. */
export interface ViewState {
  preset: Preset | undefined;
  mapping: Mapping;
  /** Model of the frame under the playhead. */
  readonly model: Model;
  /** Model of the last frame: what the pickers are offered from. */
  ref: Model;
  search: string;
  tests: TestsMode;
}

export interface ViewPanelHost {
  state(): ViewState | undefined;
  report(): Report | undefined;
  /** The preset in force before a channel was changed by hand: the way back. */
  lastPreset(): string | undefined;
  /** The list of the biggest changes, which closes the panel. */
  changesBox: HTMLElement;
  setMapping(patch: Partial<Mapping>): void;
  choosePreset(id: string): void;
  /** The filter changed: draw the city again. */
  refresh(): void;
  /** The panel was opened or folded by the user: remember it. */
  onOpenChange(open: boolean): void;
}

/**
 * The view panel on the left. Folded, it is a rail with one button: a preset is enough for most sessions.
 * Open, it shows the three main channels, then the rest (marker, tint, scale) in a section closed by default,
 * then the filter by path and the choice for the test files.
 */
export class ViewPanel {
  private readonly stateNote = el("p", { class: "panel-state", attrs: { hidden: "" } });
  private moreOpen = false;

  constructor(
    readonly element: HTMLElement,
    private readonly host: ViewPanelHost,
    private open: boolean,
  ) {}

  /** Opens the view panel or folds it to a rail; the choice is remembered. */
  setOpen(open: boolean): void {
    this.open = open;
    this.host.onOpenChange(open);
    this.build();
  }

  /** Folds the panel without remembering it: a window made narrower folds it, the choice stays. */
  fold(): void {
    if (!this.open) return;
    this.open = false;
    this.build();
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * The view panel. Folded, it is a rail with one button: a preset is enough for most sessions. Open, it
   * shows the three main channels, then the rest (marker, tint, scale) in a section closed by default, then
   * the filter.
   */
  build(): void {
    const s = this.host.state();
    if (!s) return;
    clear(this.element);
    this.element.classList.toggle("rail", !this.open);
    if (!this.open) {
      const open = el(
        "button",
        {
          class: "icon quiet",
          title: "Channels and filter: choose the metrics yourself, search files",
          attrs: { type: "button", "aria-label": "Open the view panel", "aria-expanded": "false" },
        },
        icon("sliders"),
      );
      open.addEventListener("click", () => this.setOpen(true));
      this.element.append(open);
      if (!s.preset)
        this.element.append(el("i", { class: "rail-dot", title: "The mapping was changed by hand" }));
      return;
    }
    const fold = el(
      "button",
      {
        class: "icon quiet",
        title: "Fold the panel",
        attrs: { type: "button", "aria-label": "Fold the view panel", "aria-expanded": "true" },
      },
      icon("fold"),
    );
    fold.addEventListener("click", () => this.setOpen(false));
    this.element.append(el("div", { class: "panel-head" }, el("h2", { text: "View" }), fold), this.stateNote);
    this.renderState();
    this.element.append(this.picker("area", "Area", "Metric that sets how much ground a file gets"));
    this.element.append(this.picker("height", "Height", "Metric that sets how tall a building is"));
    this.element.append(this.picker("color", "Color", "Metric that colors a building"));

    const scale = el("select", {
      title: "How values become heights",
      attrs: { "aria-label": "Height scale" },
    });
    for (const kind of SCALE_KINDS) {
      const o = el("option", { text: kind, attrs: { value: kind } });
      if (kind === s.mapping.scale) o.selected = true;
      scale.append(o);
    }
    scale.addEventListener("change", () => this.host.setMapping({ scale: scale.value as ScaleKind }));
    const clamp = el("input", { attrs: { type: "checkbox" } });
    clamp.checked = s.mapping.clampP99;
    clamp.addEventListener("change", () => this.host.setMapping({ clampP99: clamp.checked }));
    const more = el(
      "details",
      { class: "more" },
      el("summary", { text: "More: marker, district tint, scale" }),
      this.picker("marker", "Marker", "Optional: marks the roof of the files above a threshold on a metric"),
      this.markerThreshold(),
      this.picker("tint", "District tint", "Optional: tints the plinth of a district by a folder metric"),
      el(
        "div",
        { class: "row" },
        el("label", { text: "Scale", title: "Linear, square root or logarithmic" }),
        scale,
      ),
      el(
        "label",
        {
          class: "check",
          title:
            "Values above the 99th percentile all get the maximum, so one outlier does not flatten the city",
        },
        clamp,
        " clamp outliers (99th percentile)",
      ),
    );
    // open when it holds something in use, or when the user opened it
    more.open = this.moreOpen || s.mapping.marker !== null || s.mapping.tint !== null;
    more.addEventListener("toggle", () => {
      this.moreOpen = more.open;
    });
    this.element.append(more);

    this.element.append(el("h2", { text: "Filter" }));
    const search = el("input", {
      attrs: {
        type: "search",
        placeholder: "Search path or glob: src/**/*.ts",
        "aria-label": "Search by path or glob",
      },
      title: "Plain text matches anywhere in the path; * and ? make it a glob",
    });
    search.value = s.search;
    search.addEventListener("input", () => {
      s.search = search.value;
      this.host.refresh();
    });
    const tests = el("div", {
      class: "segmented",
      title: "Test files: show, dim or hide",
      attrs: { role: "group", "aria-label": "Test files" },
    });
    for (const mode of ["show", "dim", "hide"] as const) {
      const b = el("button", {
        text: mode,
        attrs: { type: "button", "aria-pressed": String(mode === s.tests) },
      });
      b.addEventListener("click", () => {
        s.tests = mode;
        for (const other of tests.children) other.setAttribute("aria-pressed", String(other === b));
        this.host.refresh();
      });
      tests.append(b);
    }
    this.element.append(search, el("div", { class: "row" }, el("label", { text: "Tests" }), tests));
    this.element.append(this.host.changesBox);
  }

  /** Says when the channels no longer match a preset, and offers the way back. */
  renderState(): void {
    const s = this.host.state();
    clear(this.stateNote);
    this.stateNote.hidden = !s || s.preset !== undefined;
    if (!s || s.preset) return;
    const last = PRESETS.find((p) => p.id === this.host.lastPreset());
    this.stateNote.append(el("span", { class: "badge", text: "modified" }));
    if (last) {
      const back = el("button", {
        class: "link",
        text: `Back to ${last.label}`,
        title: `Drop your changes and show the ${last.label} preset again`,
        attrs: { type: "button" },
      });
      back.addEventListener("click", () => this.host.choosePreset(last.id));
      this.stateNote.append(back);
    }
  }

  private usable(role: Role): string[] {
    const s = this.host.state();
    if (!s) return [];
    return [...s.ref.metrics.values()]
      .filter((m) => m.id !== "is_test")
      .filter((m) => (role === "tint" ? m.scope === "folder" : m.scope === "file"))
      .filter((m) => role === "color" || m.kind !== "category")
      .filter((m) => (s.ref.coverage.get(m.id) ?? 0) >= MIN_COVERAGE)
      .map((m) => m.id);
  }

  private picker(role: Role, label: string, title: string): HTMLElement {
    const s = this.host.state() as ViewState;
    const select = el("select", { title, attrs: { "aria-label": label } });
    if (role === "color") select.append(el("option", { text: "none (white)", attrs: { value: "" } }));
    if (role === "marker" || role === "tint")
      select.append(el("option", { text: "none", attrs: { value: "" } }));
    const current = role === "marker" ? (s.mapping.marker?.metric ?? null) : s.mapping[role];
    for (const id of this.usable(role)) {
      const m = s.model.metrics.get(id);
      const o = el("option", { text: m?.label ?? id, attrs: { value: id } });
      if (id === current) o.selected = true;
      select.append(o);
    }
    select.addEventListener("change", () => {
      if (role === "marker") {
        const marker = select.value
          ? resolveMarker(s.ref, select.value, this.host.report()?.dimensions)
          : undefined;
        this.host.setMapping({ marker: marker ?? null });
        this.build();
        return;
      }
      const optional = role === "color" || role === "tint";
      this.host.setMapping({ [role]: optional ? select.value || null : select.value });
    });
    const help = el(
      "details",
      { class: "metric-help popover" },
      el("summary", { text: "?", title: `What does this ${label.toLowerCase()} metric mean?` }),
      this.metricHelp(current),
    );
    select.addEventListener("change", () => {
      const next = role === "color" ? select.value : select.value;
      help.replaceChildren(
        el("summary", { text: "?", title: `What does this ${label.toLowerCase()} metric mean?` }),
        this.metricHelp(next || null),
      );
    });
    return el(
      "div",
      { class: "picker" },
      el("div", { class: "row" }, el("label", { text: label }), select, help),
    );
  }

  /** The threshold of the marker: the automatic one is shown, and can be replaced by a value typed in. */
  private markerThreshold(): HTMLElement | undefined {
    const s = this.host.state();
    const marker = s?.mapping.marker;
    if (!s || !marker) return undefined;
    const automatic = resolveMarker(s.ref, marker.metric, this.host.report()?.dimensions);
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
      const next = resolveMarker(s.ref, marker.metric, this.host.report()?.dimensions, chosen);
      this.host.setMapping({ marker: next ?? null });
    });
    return el("div", { class: "row" }, el("label", { text: "above" }), input);
  }

  /** Definition, computation, why it matters, direction and limits: all from the registry. */
  private metricHelp(id: string | null): HTMLElement {
    const m = id ? this.host.state()?.model.metrics.get(id) : undefined;
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
}
