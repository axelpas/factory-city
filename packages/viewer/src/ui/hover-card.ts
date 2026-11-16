import type { Report } from "@factory-city/schema";
import type { Model } from "../data/model";
import type { TimelineData } from "../data/timeline";
import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import type { Mapping } from "../presets/index";
import type { Pick } from "../scene/CityScene";
import { fileCard, folderCard } from "../view/card";
import { placeCard } from "../view/card-place";
import { lastChangeRow, lotCard } from "../view/frame-cards";
import { freeRect, type Insets } from "../view/framing";
import { fileCardView, folderCardView } from "./card-view";

/** What a card tells about the city. */
export interface CardState {
  data: TimelineData;
  model: Model;
  mapping: Mapping;
}

export interface HoverCardHost {
  state(): CardState | undefined;
  /** The frame under the playhead. */
  frame(): number;
  report(): Report | undefined;
  /** Index of a union file in the model of the current frame, or -1. */
  modelIndex(union: number): number;
  stage: HTMLElement;
  /** What the bar, the panels and the timeline cover: the card stays in what is left. */
  insets(): Insets;
}

/**
 * The card that follows the pointer: the glance at a building, a district or an empty lot. It sits beside the
 * pointer, inside what the bar, the panels and the timeline leave free.
 */
export class HoverCard {
  readonly element = el("div", { class: "card", attrs: { role: "tooltip" } });

  constructor(private readonly host: HoverCardHost) {}

  show(pick: NonNullable<Pick>, x: number, y: number): void {
    const s = this.host.state();
    const frame = this.host.frame();
    if (!s) return;
    clear(this.element);
    if (pick.kind === "folder") {
      this.element.append(folderCardView(folderCard(s.model, pick.path, format)));
    } else {
      const m = this.host.modelIndex(pick.index);
      if (pick.kind === "lot" || m < 0) {
        const lot = lotCard(s.data, frame, pick.index);
        this.element.append(
          el(
            "div",
            {},
            el("div", { class: "card-title", text: `Empty lot: ${lot.title}` }),
            el("div", { class: "muted", text: lot.folder }),
            el("p", { class: "lot-text", text: lot.text }),
          ),
        );
      } else {
        const data = fileCard(s.model, m, s.mapping, format, this.host.report()?.dimensions);
        const last = lastChangeRow(s.data, frame, pick.index, format);
        this.element.append(fileCardView(data, last ? [last] : []));
      }
    }
    this.element.classList.add("on");
    // beside the pointer, inside what the bar, the panels and the timeline leave free
    const stage = this.host.stage.getBoundingClientRect();
    const free = freeRect({ w: stage.width, h: stage.height }, this.host.insets());
    const place = placeCard(
      { x: x - stage.left, y: y - stage.top },
      { w: this.element.offsetWidth, h: this.element.offsetHeight },
      free,
    );
    this.element.style.left = `${stage.left + place.left}px`;
    this.element.style.top = `${stage.top + place.top}px`;
  }

  hide(): void {
    this.element.classList.remove("on");
  }
}
