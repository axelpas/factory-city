import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import { icon } from "./icons";
import { POPOVER_CLASS } from "./popovers";

const SPEEDS = [0.5, 1, 2, 4];

export interface PlaybackOptionsHandlers {
  onSpeed(speed: number): void;
  onLoop(loop: boolean): void;
  onOrbit(orbit: boolean): void;
  onSource(key: string): void;
}

/** The playback options menu of the timeline: the way the history is cut, the speed, loop and orbit. */
export class PlaybackOptions {
  readonly element: HTMLElement;
  private readonly sourceSelect = el("select", {
    title: "How the history is cut into frames",
    attrs: { "aria-label": "Frames" },
  });
  private readonly sourceField = el(
    "label",
    { class: "field", attrs: { hidden: "" } },
    el("span", { text: "Frames" }),
    this.sourceSelect,
  );

  constructor(handlers: PlaybackOptionsHandlers) {
    const speed = el("select", { title: "Playback speed", attrs: { "aria-label": "Speed" } });
    for (const s of SPEEDS) {
      const o = el("option", { text: `${format.number(s)}×`, attrs: { value: String(s) } });
      if (s === 1) o.selected = true;
      speed.append(o);
    }
    speed.addEventListener("change", () => handlers.onSpeed(Number(speed.value)));
    const check = (text: string, title: string, onChange: (on: boolean) => void) => {
      const input = el("input", { attrs: { type: "checkbox" } });
      input.addEventListener("change", () => onChange(input.checked));
      return el("label", { class: "check", title }, input, ` ${text}`);
    };
    this.sourceSelect.addEventListener("change", () => handlers.onSource(this.sourceSelect.value));
    this.element = el(
      "details",
      { class: `${POPOVER_CLASS} menu timeline-options` },
      el(
        "summary",
        { class: "icon", title: "Playback options", attrs: { "aria-label": "Playback options" } },
        icon("sliders"),
      ),
      el(
        "div",
        { class: "menu-list" },
        this.sourceField,
        el("label", { class: "field" }, el("span", { text: "Speed" }), speed),
        check("Loop", "Start again from the first frame at the end", handlers.onLoop),
        check("Orbit", "Turn slowly around the city", handlers.onOrbit),
      ),
    );
  }

  /** The ways of cutting the history that exist for this project; hidden when there is only one. */
  setSources(options: Array<{ value: string; label: string }>, current: string): void {
    clear(this.sourceSelect);
    for (const o of options) {
      const node = el("option", { text: o.label, attrs: { value: o.value } });
      if (o.value === current) node.selected = true;
      this.sourceSelect.append(node);
    }
    this.sourceField.hidden = options.length < 2;
  }
}
