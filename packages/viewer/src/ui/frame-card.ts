import type { Frame } from "@factory-city/schema";
import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import { frameCardRows, frameMarkers } from "../view/lenses";
import { frameTitle } from "../view/transport";

/** The card of a frame on the timeline bar: its issue, kind, estimate against scope, quality, agent, CI, cost. */
export function fillFrameCard(card: HTMLElement, frame: Frame): void {
  clear(card);
  card.append(
    el("div", { class: "card-title", text: frameTitle(frame) }),
    el("div", { class: "muted", text: format.date(frame.date) }),
    ...frameCardRows(frame, format).map((r) =>
      el(
        "div",
        { class: "kv", title: r.note },
        el("span", { class: "k", text: r.label }),
        el("span", { class: r.value === "n/a" ? "v na" : "v", text: r.value }),
        r.note ? el("span", { class: "note", text: r.note }) : undefined,
      ),
    ),
    ...frameMarkers(frame).map((m) => el("div", { class: "muted", text: m.title })),
  );
}
