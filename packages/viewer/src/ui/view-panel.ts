import type { Report } from "@factory-city/schema";
import type { Model } from "../data/model";
import { clear, el } from "../lib/dom";
import { type Mapping, PRESETS, type Preset } from "../presets/index";
import { type FilterState, scaleControls, searchBox, testsChoice } from "./filter-controls";
import { icon } from "./icons";
import { markerThreshold, metricPicker, type PickerContext, type Role } from "./metric-picker";

/** What the panel shows and changes of the page: the mapping, and the filter it writes into. */
export type { TestsMode } from "./filter-controls";

export interface ViewState extends FilterState {
  preset: Preset | undefined;
  mapping: Mapping;
  /** Model of the frame under the playhead. */
  readonly model: Model;
  /** Model of the last frame: what the pickers are offered from. */
  ref: Model;
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

    const more = el(
      "details",
      { class: "more" },
      el("summary", { text: "More: marker, district tint, scale" }),
      this.picker("marker", "Marker", "Optional: marks the roof of the files above a threshold on a metric"),
      markerThreshold(this.context(s)),
      this.picker("tint", "District tint", "Optional: tints the plinth of a district by a folder metric"),
      ...scaleControls(s.mapping, (patch) => this.host.setMapping(patch)),
    );
    // open when it holds something in use, or when the user opened it
    more.open = this.moreOpen || s.mapping.marker !== null || s.mapping.tint !== null;
    more.addEventListener("toggle", () => {
      this.moreOpen = more.open;
    });
    this.element.append(more);

    const refresh = () => this.host.refresh();
    this.element.append(el("h2", { text: "Filter" }), searchBox(s, refresh), testsChoice(s, refresh));
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

  private context(s: ViewState): PickerContext {
    return {
      ref: s.ref,
      model: s.model,
      mapping: s.mapping,
      report: this.host.report(),
      setMapping: (patch) => this.host.setMapping(patch),
      rebuild: () => this.build(),
    };
  }

  private picker(role: Role, label: string, title: string): HTMLElement {
    const s = this.host.state() as ViewState;
    return metricPicker(role, label, title, this.context(s));
  }
}
