import type { Frame } from "@factory-city/schema";
import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import { trendPoints } from "../view/health";
import { frameCardRows, frameMarkers, type SeriesState, seriesStates } from "../view/lenses";

export interface TimelineBarHandlers {
  onPlayPause(): void;
  onStep(delta: number): void;
  /** The playhead is dragged: continuous position, in frames. */
  onSeek(position: number): void;
  /** A click on the bar: animated jump to a frame. */
  onJump(frame: number): void;
  onSpeed(speed: number): void;
  onLoop(loop: boolean): void;
  onOrbit(orbit: boolean): void;
}

const MAX_TICKS = 400;
const SPEEDS = [0.5, 1, 2, 4];
const STRIP_WIDTH = 1000;
const STRIP_HEIGHT = 26;
const SVG = "http://www.w3.org/2000/svg";

/**
 * The timeline bar: frame ticks, playhead, play and pause, speed, previous and next, loop, frame label and
 * totals. Lenses put the frame metrics on the bar itself: tick color by kind, markers, a trend strip that
 * follows the playhead, and a card for the frame under the pointer.
 */
export class TimelineBar {
  readonly element = el("section", { class: "timeline", attrs: { "aria-label": "Timeline", hidden: "" } });
  private readonly track = el("div", {
    class: "track",
    attrs: { role: "slider", tabindex: "0", "aria-label": "Playhead" },
  });
  private readonly ticks = el("div", { class: "ticks" });
  private readonly head = el("div", { class: "head" });
  private readonly label = el("div", { class: "frame-label" });
  private readonly totals = el("div", { class: "frame-totals" });
  private readonly play = el("button", {
    text: "Play",
    title: "Play or pause (space)",
    class: "primary",
    attrs: { type: "button" },
  });
  private readonly strip = el("div", { class: "strip" });
  private readonly stripSelect = el("select", {
    title: "Series drawn above the bar",
    attrs: { "aria-label": "Trend series" },
  });
  private readonly stripLine = document.createElementNS(SVG, "polyline");
  private readonly stripNow = document.createElementNS(SVG, "line");
  private readonly stripValue = el("span", { class: "strip-value muted" });
  private readonly card = el("div", { class: "frame-card", attrs: { role: "tooltip", hidden: "" } });
  private frames: Array<Frame | undefined> = [];
  private series: SeriesState[] = [];
  private shown = { files: 0, rloc: 0, mcc: 0 };
  private wanted = { files: 0, rloc: 0, mcc: 0 };
  private dragging = false;

  constructor(handlers: TimelineBarHandlers) {
    const button = (text: string, title: string, onClick: () => void) => {
      const b = el("button", { text, title, attrs: { type: "button" } });
      b.addEventListener("click", onClick);
      return b;
    };
    this.play.addEventListener("click", () => handlers.onPlayPause());
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

    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `0 -2 ${STRIP_WIDTH} ${STRIP_HEIGHT + 4}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "strip-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Trend of the chosen series over the frames");
    this.stripNow.setAttribute("class", "now");
    this.stripNow.setAttribute("y1", "-2");
    this.stripNow.setAttribute("y2", String(STRIP_HEIGHT + 2));
    svg.append(this.stripLine, this.stripNow);
    this.stripSelect.addEventListener("change", () => this.drawStrip());
    this.strip.append(this.stripSelect, svg, this.stripValue);

    this.track.append(this.ticks, this.head);
    this.track.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.card.hidden = true;
      this.track.setPointerCapture(e.pointerId);
      handlers.onSeek(this.positionAt(e.clientX));
    });
    this.track.addEventListener("pointermove", (e) => {
      if (this.dragging) handlers.onSeek(this.positionAt(e.clientX));
      else this.showCard(Math.round(this.positionAt(e.clientX)), e.clientX);
    });
    this.track.addEventListener("pointerleave", () => {
      this.card.hidden = true;
    });
    const release = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.track.releasePointerCapture(e.pointerId);
      // settle on the nearest frame, with a move
      handlers.onJump(Math.round(this.positionAt(e.clientX)));
    };
    this.track.addEventListener("pointerup", release);
    this.track.addEventListener("pointercancel", release);
    this.element.append(
      this.card,
      el("div", { class: "frame-info" }, this.label, this.totals),
      this.strip,
      el(
        "div",
        { class: "controls" },
        button("Previous", "Previous frame (left arrow)", () => handlers.onStep(-1)),
        this.play,
        button("Next", "Next frame (right arrow)", () => handlers.onStep(1)),
        speed,
        check("loop", "Start again from the first frame at the end", handlers.onLoop),
        check("orbit", "Turn slowly around the city", handlers.onOrbit),
        this.track,
      ),
    );
  }

  private positionAt(clientX: number): number {
    const rect = this.track.getBoundingClientRect();
    const t = Math.min(Math.max((clientX - rect.left) / Math.max(rect.width, 1), 0), 1);
    return t * Math.max(this.frames.length - 1, 0);
  }

  /** Series that cannot be drawn with this data, for the help. */
  get lenses(): readonly SeriesState[] {
    return this.series;
  }

  /** Shows the bar for a timeline of several frames; hides it for a single snapshot. */
  setFrames(frames: Array<Frame | undefined>): void {
    this.frames = frames;
    this.element.hidden = frames.length < 2;
    clear(this.ticks);
    clear(this.stripSelect);
    this.series = [];
    if (frames.length < 2) return;
    const every = Math.ceil(frames.length / MAX_TICKS);
    frames.forEach((frame, i) => {
      if (i % every !== 0 && i !== frames.length - 1) return;
      const tick = el("i", {
        class: `tick kind-${frame?.kind ?? "unknown"}`,
        style: { left: `${(i / (frames.length - 1)) * 100}%` },
      });
      for (const marker of frameMarkers(frame))
        tick.append(el("b", { class: `mark mark-${marker.type}`, title: marker.title }));
      this.ticks.append(tick);
    });
    this.track.setAttribute("aria-valuemin", "1");
    this.track.setAttribute("aria-valuemax", String(frames.length));
    this.shown = { files: 0, rloc: 0, mcc: 0 };

    // trend strip: only the series this data can draw are offered
    this.series = seriesStates(frames);
    for (const s of this.series.filter((x) => x.available)) {
      this.stripSelect.append(el("option", { text: s.series.label, attrs: { value: s.series.id } }));
    }
    this.strip.hidden = this.stripSelect.options.length === 0;
    this.drawStrip();
  }

  private current(): SeriesState | undefined {
    return this.series.find((s) => s.series.id === this.stripSelect.value);
  }

  private drawStrip(): void {
    const state = this.current();
    this.stripLine.setAttribute("points", state ? trendPoints(state.values, STRIP_WIDTH, STRIP_HEIGHT) : "");
  }

  /** The card of the frame under the pointer: issue, kind, estimate against scope, quality, agent, CI, cost. */
  private showCard(index: number, clientX: number): void {
    const frame = this.frames[index];
    if (!frame) {
      this.card.hidden = true;
      return;
    }
    clear(this.card);
    this.card.append(
      el("div", {
        class: "card-title",
        text: frame.issue
          ? `#${frame.issue.number}${frame.issue.title ? ` ${frame.issue.title}` : ""}`
          : frame.label,
      }),
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
    this.card.hidden = false;
    const box = this.element.getBoundingClientRect();
    const width = this.card.offsetWidth;
    const left = Math.min(Math.max(clientX - box.left - width / 2, 0), Math.max(box.width - width, 0));
    this.card.style.left = `${left}px`;
  }

  /** The frame under the playhead changed: new label (cross-faded) and new totals to count toward. */
  showFrame(index: number, instant: boolean): void {
    const frame = this.frames[index];
    if (!frame) return;
    this.label.classList.remove("swap");
    void this.label.offsetWidth;
    this.label.classList.add("swap");
    clear(this.label);
    this.label.append(
      el("b", { text: `${format.integer(index + 1)} / ${format.integer(this.frames.length)}` }),
      ` ${frame.label} `,
      el("span", { class: "muted", text: format.date(frame.date) }),
    );
    this.wanted = { ...frame.totals };
    if (instant || this.shown.files === 0) this.shown = { ...this.wanted };
    this.track.setAttribute("aria-valuenow", String(index + 1));
    this.track.setAttribute("aria-valuetext", frame.label);
    this.renderTotals();
    const state = this.current();
    const value = state?.values[index];
    this.stripValue.textContent =
      value !== undefined && Number.isFinite(value) ? format.number(value, 2) : "n/a";
  }

  /** Called on every image: moves the playhead, lets the strip follow it and the totals count up or down. */
  update(position: number, playing: boolean, dtMs: number): void {
    if (this.frames.length < 2) return;
    const share = position / (this.frames.length - 1);
    this.head.style.left = `${share * 100}%`;
    const x = String(share * STRIP_WIDTH);
    this.stripNow.setAttribute("x1", x);
    this.stripNow.setAttribute("x2", x);
    const text = playing ? "Pause" : "Play";
    if (this.play.textContent !== text) this.play.textContent = text;
    const k = Math.min(1, dtMs / 180);
    let changed = false;
    for (const key of ["files", "rloc", "mcc"] as const) {
      const gap = this.wanted[key] - this.shown[key];
      if (gap === 0) continue;
      this.shown[key] = Math.abs(gap) < 0.5 ? this.wanted[key] : this.shown[key] + gap * k;
      changed = true;
    }
    if (changed) this.renderTotals();
  }

  private renderTotals(): void {
    this.totals.textContent = `${format.integer(Math.round(this.shown.files))} files · ${format.integer(Math.round(this.shown.rloc))} lines · complexity ${format.integer(Math.round(this.shown.mcc))}`;
  }
}
