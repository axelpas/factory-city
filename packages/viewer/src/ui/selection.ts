import type { Layout } from "@factory-city/layout";
import type { Report } from "@factory-city/schema";
import type { Animator } from "../anim/animator";
import type { Model } from "../data/model";
import type { TimelineData } from "../data/timeline";
import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import type { Mapping } from "../presets/index";
import type { CityScene } from "../scene/CityScene";
import { frameChangeRows } from "../view/card";
import { fileDetails } from "../view/details";
import { renderFileDetails } from "./details-view";

/** What the details read of the page. */
export interface SelectionState {
  data: TimelineData;
  model: Model;
  layout: Layout;
  mapping: Mapping;
}

export interface SelectionHost {
  scene(): CityScene;
  state(): SelectionState | undefined;
  animator(): Animator | undefined;
  report(): Report | undefined;
  /** Index of a union file in the model of the current frame, or -1. */
  modelIndex(union: number): number;
  /** Brings a district to the middle of the free stage. */
  frameDistrict(path: string): void;
}

/**
 * The building the details are about: shown in the File tab, outlined in the city until another is chosen or
 * the inspector closes.
 */
export class Selection {
  readonly element = el("section", { attrs: { "aria-label": "File details", hidden: "" } });
  private union: number | null = null;

  constructor(private readonly host: SelectionHost) {}

  /** The index of the selected file, or null. */
  get selected(): number | null {
    return this.union;
  }

  open(union: number): void {
    const s = this.host.state();
    if (!s) return;
    const index = this.host.modelIndex(union);
    const file = s.model.files[index];
    if (!file) return;
    const frame = this.host.animator()?.frame ?? 0;
    const d = fileDetails(s.model, index, s.mapping, format, this.host.report()?.dimensions);
    clear(this.element);
    this.union = union;
    this.host.scene().setSelection(union);

    const changes = frameChangeRows(s.data, frame, union, s.mapping, format);
    const touching = s.data.frames
      .map((f) => f.info)
      .filter(
        (i): i is NonNullable<typeof i> =>
          i !== undefined && (i.added.includes(file.path) || i.modified.includes(file.path)),
      );
    renderFileDetails(this.element, {
      details: d,
      trail: this.breadcrumb(d.path),
      changes,
      touching,
      timeline: s.data.frames.length >= 2,
      onGoToFrame: (target) => this.host.animator()?.goTo(target),
    });
    this.element.hidden = false;
  }

  /** Selects the first file of the frame, as a click on it does. */
  selectFirst(): boolean {
    const s = this.host.state();
    if (!s) return false;
    for (let union = 0; union < s.data.paths.length; union++) {
      if (this.host.modelIndex(union) < 0) continue;
      this.open(union);
      return true;
    }
    return false;
  }

  close(): void {
    this.element.hidden = true;
    this.clearOutline();
  }

  clearOutline(): void {
    if (this.union === null) return;
    this.union = null;
    this.host.scene().setSelection(null);
  }

  /** The path of a file as a trail of folders: a click on one frames that district in the city. */
  private breadcrumb(path: string): HTMLElement {
    const parts = path.split("/");
    const trail = el("nav", { class: "breadcrumb", attrs: { "aria-label": "Path" } });
    parts.forEach((part, i) => {
      if (i > 0) trail.append(el("span", { class: "muted sep", text: "/" }));
      if (i === parts.length - 1) {
        trail.append(el("span", { class: "muted", text: part }));
        return;
      }
      const folder = parts.slice(0, i + 1).join("/");
      const button = el("button", {
        class: "link",
        text: part,
        title: `Frame ${folder} in the city`,
        attrs: { type: "button" },
      });
      button.addEventListener("click", () => this.host.frameDistrict(folder));
      trail.append(button);
    });
    return trail;
  }
}
