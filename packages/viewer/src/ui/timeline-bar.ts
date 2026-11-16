import type { Frame } from "@factory-city/schema";
import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import { frameMarkers, type SeriesState } from "../view/lenses";
import { frameTitle } from "../view/transport";
import { fillFrameCard } from "./frame-card";
import { icon } from "./icons";
import { PlaybackOptions } from "./playback-options";
import { attachScrub } from "./scrub";
import { TrendStrip } from "./trend-strip";

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
  /** Another way of cutting the history was chosen (per commit, per day, per issue). */
  onSource(key: string): void;
}

const MAX_TICKS = 400;
/** Pointer travel (px) from which a press on the track is a drag and no more a click. */

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
    title: "Play (space)",
    class: "primary icon",
    attrs: { type: "button", "aria-label": "Play" },
  });
  private playing = false;
  private readonly options: PlaybackOptions;
  private readonly strip = new TrendStrip();
  private readonly card = el("div", { class: "frame-card", attrs: { role: "tooltip", hidden: "" } });
  private frames: Array<Frame | undefined> = [];
  private shown = { files: 0, rloc: 0, mcc: 0 };
  private wanted = { files: 0, rloc: 0, mcc: 0 };

  constructor(handlers: TimelineBarHandlers) {
    const button = (name: "prev" | "next", title: string, onClick: () => void) => {
      const b = el("button", { title, class: "icon", attrs: { type: "button", "aria-label": title } });
      b.append(icon(name));
      b.addEventListener("click", onClick);
      return b;
    };
    this.play.addEventListener("click", () => handlers.onPlayPause());
    this.renderPlay();
    this.options = new PlaybackOptions(handlers);

    this.track.append(this.ticks, this.head);
    attachScrub(this.track, {
      positionAt: (x) => this.positionAt(x),
      onHover: (x) => this.showCard(Math.round(this.positionAt(x)), x),
      onLeave: () => {
        this.card.hidden = true;
      },
      onPress: () => {
        this.card.hidden = true;
      },
      onSeek: (position) => handlers.onSeek(position),
      onJump: (frame) => handlers.onJump(frame),
    });
    this.element.append(
      this.card,
      el("div", { class: "frame-info" }, this.label, this.totals),
      el(
        "div",
        { class: "controls" },
        el(
          "div",
          { class: "transport" },
          button("prev", "Previous frame (left arrow)", () => handlers.onStep(-1)),
          this.play,
          button("next", "Next frame (right arrow)", () => handlers.onStep(1)),
        ),
        this.track,
        this.options.element,
      ),
      this.strip.element,
    );
  }

  /** The ways of cutting the history that exist for this project; hidden when there is only one. */
  setSources(options: Array<{ value: string; label: string }>, current: string): void {
    this.options.setSources(options, current);
  }

  private renderPlay(): void {
    const label = this.playing ? "Pause (space)" : "Play (space)";
    this.play.title = label;
    this.play.setAttribute("aria-label", this.playing ? "Pause" : "Play");
    this.play.replaceChildren(icon(this.playing ? "pause" : "play"));
  }

  private positionAt(clientX: number): number {
    const rect = this.track.getBoundingClientRect();
    const t = Math.min(Math.max((clientX - rect.left) / Math.max(rect.width, 1), 0), 1);
    return t * Math.max(this.frames.length - 1, 0);
  }

  /** Series that cannot be drawn with this data, for the help. */
  get lenses(): readonly SeriesState[] {
    return this.strip.lenses;
  }

  /** Shows the bar for a timeline of several frames; hides it for a single snapshot. */
  setFrames(frames: Array<Frame | undefined>): void {
    this.frames = frames;
    this.element.hidden = frames.length < 2;
    clear(this.ticks);
    this.strip.setFrames(frames);
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
  }

  /** The card of the frame under the pointer: issue, kind, estimate against scope, quality, agent, CI, cost. */
  private showCard(index: number, clientX: number): void {
    const frame = this.frames[index];
    if (!frame) {
      this.card.hidden = true;
      return;
    }
    fillFrameCard(this.card, frame);
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
      el("b", {
        class: "frame-position",
        text: `${format.integer(index + 1)} / ${format.integer(this.frames.length)}`,
      }),
      el("span", { class: "frame-title", text: frameTitle(frame), title: frameTitle(frame) }),
      el("span", { class: "muted", text: format.date(frame.date) }),
    );
    this.wanted = { ...frame.totals };
    if (instant || this.shown.files === 0) this.shown = { ...this.wanted };
    this.track.setAttribute("aria-valuenow", String(index + 1));
    this.track.setAttribute("aria-valuetext", frame.label);
    this.renderTotals();
    this.strip.setIndex(index);
  }

  /** Called on every image: moves the playhead, lets the strip follow it and the totals count up or down. */
  update(position: number, playing: boolean, dtMs: number): void {
    if (this.frames.length < 2) return;
    const share = position / (this.frames.length - 1);
    this.head.style.left = `${share * 100}%`;
    this.strip.follow(share);
    if (playing !== this.playing) {
      this.playing = playing;
      this.renderPlay();
    }
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
