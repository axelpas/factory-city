import type { Frame } from "@factory-city/schema";
import { clear, el } from "../lib/dom";
import { format } from "../lib/format";

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

/** The timeline bar: frame ticks, playhead, play and pause, speed, previous and next, loop, frame label and totals. */
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
    attrs: { type: "button" },
  });
  private frames: Array<Frame | undefined> = [];
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
    this.track.append(this.ticks, this.head);
    this.track.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.track.setPointerCapture(e.pointerId);
      handlers.onSeek(this.positionAt(e.clientX));
    });
    this.track.addEventListener("pointermove", (e) => {
      if (this.dragging) handlers.onSeek(this.positionAt(e.clientX));
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
      el("div", { class: "frame-info" }, this.label, this.totals),
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

  /** Shows the bar for a timeline of several frames; hides it for a single snapshot. */
  setFrames(frames: Array<Frame | undefined>): void {
    this.frames = frames;
    this.element.hidden = frames.length < 2;
    clear(this.ticks);
    if (frames.length < 2) return;
    const every = Math.ceil(frames.length / MAX_TICKS);
    frames.forEach((frame, i) => {
      if (i % every !== 0 && i !== frames.length - 1) return;
      this.ticks.append(
        el("i", {
          class: "tick",
          title: frame?.label ?? `Frame ${i + 1}`,
          style: { left: `${(i / (frames.length - 1)) * 100}%` },
        }),
      );
    });
    this.track.setAttribute("aria-valuemin", "1");
    this.track.setAttribute("aria-valuemax", String(frames.length));
    this.shown = { files: 0, rloc: 0, mcc: 0 };
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
  }

  /** Called on every image: moves the playhead and lets the totals count up or down. */
  update(position: number, playing: boolean, dtMs: number): void {
    if (this.frames.length < 2) return;
    this.head.style.left = `${(position / (this.frames.length - 1)) * 100}%`;
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
