import type { Frame } from "@factory-city/schema";
import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import { trendPoints } from "../view/health";
import { type SeriesState, seriesStates } from "../view/lenses";
import { frameAtShare } from "../view/transport";

const WIDTH = 1000;
const HEIGHT = 26;
const SVG = "http://www.w3.org/2000/svg";

/**
 * The trend of one series over the frames, drawn above the timeline: a choice of series, the curve with the
 * playhead on it, and the value at the playhead or under the pointer. Only the series this data can draw are
 * offered. It keeps its room when there is nothing to draw, so that the stage does not jump.
 */
export class TrendStrip {
  readonly element = el("div", { class: "strip" });
  private readonly select = el("select", {
    title: "Series drawn above the bar",
    attrs: { id: "trend-series" },
  });
  private readonly line = document.createElementNS(SVG, "polyline");
  private readonly now = document.createElementNS(SVG, "line");
  private readonly hover = document.createElementNS(SVG, "line");
  private readonly value = el("span", { class: "strip-value muted" });
  private series: SeriesState[] = [];
  private count = 0;
  /** The frame under the playhead. */
  private index = 0;
  /** The frame under the pointer on the strip, when it is over it. */
  private under: number | undefined;

  constructor() {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `0 -2 ${WIDTH} ${HEIGHT + 4}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "strip-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Trend of the chosen series over the frames");
    for (const [mark, name] of [
      [this.now, "now"],
      [this.hover, "hover"],
    ] as const) {
      mark.setAttribute("class", name);
      mark.setAttribute("y1", "-2");
      mark.setAttribute("y2", String(HEIGHT + 2));
    }
    this.hover.setAttribute("visibility", "hidden");
    svg.append(this.line, this.now, this.hover);
    this.select.addEventListener("change", () => {
      this.draw();
      this.renderValue();
    });
    svg.addEventListener("pointermove", (e) => {
      const rect = svg.getBoundingClientRect();
      const at = frameAtShare((e.clientX - rect.left) / Math.max(rect.width, 1), this.count);
      this.under = at;
      const x = String((at / Math.max(this.count - 1, 1)) * WIDTH);
      this.hover.setAttribute("x1", x);
      this.hover.setAttribute("x2", x);
      this.hover.removeAttribute("visibility");
      this.renderValue();
    });
    svg.addEventListener("pointerleave", () => {
      this.under = undefined;
      this.hover.setAttribute("visibility", "hidden");
      this.renderValue();
    });
    this.element.append(
      el("label", { class: "strip-label muted", text: "Trend", attrs: { for: "trend-series" } }),
      this.select,
      svg,
      this.value,
    );
  }

  /** Series that cannot be drawn with this data, for the help. */
  get lenses(): readonly SeriesState[] {
    return this.series;
  }

  /** A new timeline: the series it can draw are offered, the first one is drawn. */
  setFrames(frames: Array<Frame | undefined>): void {
    this.count = frames.length;
    clear(this.select);
    this.series = frames.length < 2 ? [] : seriesStates(frames);
    for (const s of this.series.filter((x) => x.available))
      this.select.append(el("option", { text: s.series.label, attrs: { value: s.series.id } }));
    this.element.classList.toggle("empty", this.select.options.length === 0);
    this.draw();
  }

  /** The frame under the playhead changed. */
  setIndex(index: number): void {
    this.index = index;
    this.renderValue();
  }

  /** Puts the playhead mark at a share (0 to 1) of the strip. */
  follow(share: number): void {
    const x = String(share * WIDTH);
    this.now.setAttribute("x1", x);
    this.now.setAttribute("x2", x);
  }

  private current(): SeriesState | undefined {
    return this.series.find((s) => s.series.id === this.select.value);
  }

  private draw(): void {
    const state = this.current();
    this.line.setAttribute("points", state ? trendPoints(state.values, WIDTH, HEIGHT) : "");
  }

  /** The value of the series under the pointer, else at the playhead. */
  private renderValue(): void {
    const at = this.under ?? this.index;
    const value = this.current()?.values[at];
    const text = value !== undefined && Number.isFinite(value) ? format.number(value, 2) : "n/a";
    this.value.textContent = this.under === undefined ? text : `${format.integer(at + 1)}: ${text}`;
  }
}
