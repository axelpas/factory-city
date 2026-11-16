import { durationText, secondsPerFrameAt, VIDEO_SPEEDS, videoSeconds } from "../export/video";
import { el } from "../lib/dom";
import { format } from "../lib/format";
import { icon } from "./icons";
import { POPOVER_CLASS } from "./popovers";

export interface ExportMenuHandlers {
  /** A PNG was asked for: 1x, 2x or 4K, with or without the title and the legend. */
  onPicture(size: number | "4k", overlay: boolean): void;
  onVideo(): void;
  /** How many frames the timeline has, for the length of the film. */
  frameCount(): number;
}

/**
 * The Export menu: pictures at three sizes, and the film with its images per second, its speed and an optional
 * slow orbit. It keeps the film options; the page reads them when it renders.
 */
export class ExportMenu {
  readonly element = el("details", { class: `${POPOVER_CLASS} menu export-menu` });
  /** Images per second of the film. */
  fps = 30;
  /** How fast the film runs: a multiple of the base pace of 1.4 s per frame. */
  speed = 1;
  orbit = false;

  constructor(private readonly handlers: ExportMenuHandlers) {
    this.element.append(
      el(
        "summary",
        {
          class: "icon quiet",
          title: "Export a picture, or the timelapse as a video (E: PNG)",
          attrs: { "aria-label": "Export" },
        },
        icon("export"),
      ),
      this.buildList(),
    );
  }

  private button(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = el("button", { text, title, attrs: { type: "button" } });
    b.addEventListener("click", onClick);
    return b;
  }

  private buildList(): HTMLElement {
    const overlay = el("input", { attrs: { type: "checkbox", checked: "" } });
    const list = el("div", { class: "menu-list" });
    const sizes: Array<[string, number | "4k"]> = [
      ["PNG 1x", 1],
      ["PNG 2x", 2],
      ["PNG 4K", "4k"],
    ];
    for (const [label, size] of sizes) {
      list.append(
        this.button(label, `Download the view as ${label}`, () => {
          this.element.open = false;
          this.handlers.onPicture(size, overlay.checked);
        }),
      );
    }
    list.append(el("label", { class: "check" }, overlay, " with title and legend"));

    const fps = el("select", {
      title: "Images per second of the video",
      attrs: { "aria-label": "Video images per second" },
    });
    for (const n of [30, 60])
      fps.append(el("option", { text: `Video at ${n} images per second`, attrs: { value: String(n) } }));
    fps.addEventListener("change", () => {
      this.fps = Number(fps.value);
    });

    const speed = el("select", {
      title: "How fast the film runs through the frames",
      attrs: { "aria-label": "Video speed" },
    });
    for (const v of VIDEO_SPEEDS) {
      const label = v < 1 ? "slow" : v === 1 ? "normal" : "fast";
      const o = el("option", {
        text: `Video speed ${format.number(v)}× (${label})`,
        attrs: { value: String(v) },
      });
      if (v === this.speed) o.selected = true;
      speed.append(o);
    }
    const length = el("p", { class: "muted video-length" });
    const showLength = () => {
      const seconds = videoSeconds(this.handlers.frameCount(), secondsPerFrameAt(this.speed));
      length.textContent = `Film length: about ${durationText(seconds)}`;
    };
    speed.addEventListener("change", () => {
      this.speed = Number(speed.value);
      showLength();
    });
    this.element.addEventListener("toggle", () => {
      if (this.element.open) showLength();
    });

    const orbit = el("input", { attrs: { type: "checkbox" } });
    orbit.addEventListener("change", () => {
      this.orbit = orbit.checked;
    });
    list.append(
      this.button(
        "Video of the timelapse",
        "Render the timelapse image by image and download it (MP4, or WebM)",
        () => {
          this.element.open = false;
          this.handlers.onVideo();
        },
      ),
      fps,
      speed,
      length,
      el("label", { class: "check" }, orbit, " slow orbit in the video"),
    );
    return list;
  }
}
