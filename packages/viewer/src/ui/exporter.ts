import type { Layout } from "@factory-city/layout";
import type { Report } from "@factory-city/schema";
import type { Animator } from "../anim/animator";
import type { Model } from "../data/model";
import type { TimelineData } from "../data/timeline";
import {
  type EncodedVideo,
  encodeVideo,
  pixelHash,
  planVideo,
  secondsPerFrameAt,
  type VideoOptions,
} from "../export/video";
import { el } from "../lib/dom";
import { format } from "../lib/format";
import type { Mapping, Preset } from "../presets/index";
import type { CameraState, CityScene } from "../scene/CityScene";
import type { Theme } from "../themes/index";
import { scoreAt } from "../view/health";
import type { LegendModel } from "../view/legend";
import type { DistrictLabelLayer } from "./district-labels";
import type { ExportMenu } from "./export-menu";
import { drawOverlay } from "./overlay";

/** What the page is showing, as far as a picture of it needs to know. */
export interface ExportState {
  data: TimelineData;
  model: Model;
  layout: Layout;
  preset: Preset | undefined;
  mapping: Mapping;
}

/** What the exporter reads from the page; it never changes the page but to move its playhead and camera. */
export interface ExporterHost {
  state(): ExportState | undefined;
  animator(): Animator | undefined;
  scene: CityScene;
  stage: HTMLElement;
  theme(): Theme;
  report(): Report | undefined;
  legend(): LegendModel | undefined;
  districtLabels: DistrictLabelLayer;
  exportMenu: ExportMenu;
  /** The buildings of a frame, for the animator when it is reset. */
  stateOf(frame: number): Float32Array;
  updateFrameViews(force?: boolean): void;
}

/**
 * Pictures and films of the city: a PNG at an exact size, the timelapse rendered image by image on a virtual
 * clock, and the fingerprints used to compare two renders. They go through the same drawing as the screen,
 * framed for the size asked for, with the title, the legend, the score and the names of the districts.
 */
export class Exporter {
  /** The view fixed for a whole film: set while one is rendered. */
  private exportCamera: CameraState | undefined;
  private exporting = false;

  constructor(private readonly host: ExporterHost) {}

  /** Lets every running move finish at once, so that a picture shows the settled city. */
  settle(): void {
    const a = this.host.animator();
    if (!a) return;
    a.pause();
    for (let i = 0; i < 20 && a.tick(100000); i++);
    this.host.updateFrameViews(true);
  }

  /** The current view as a PNG data URL at an exact size, for headless rendering. */
  capture(width: number, height: number, withOverlay = true, frame?: number): string | undefined {
    // a frame asked for (0 to the last) is shown, whole, before the picture is taken
    if (frame !== undefined) this.host.animator()?.setPosition(frame);
    this.settle();
    return this.picture(width, height, withOverlay)?.toDataURL("image/png");
  }

  exportPng(size: number | "4k", withOverlay: boolean): void {
    const s = this.host.state();
    if (!s) return;
    const base = this.host.stage.getBoundingClientRect();
    const width = size === "4k" ? 3840 : Math.round(base.width * size);
    const height = size === "4k" ? 2160 : Math.round(base.height * size);
    const canvas = this.picture(width, height, withOverlay);
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = el("a", { attrs: { href: url, download: `${s.model.project}-city.png` } });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, "image/png");
  }

  /** The score at the playhead, for the overlay of an exported picture or film. */
  private exportScore(): { health?: string } {
    const s = this.host.state();
    const score = s ? scoreAt(s.data, this.host.report(), this.host.animator()?.playhead ?? 0) : undefined;
    return score === undefined ? {} : { health: format.score(score) };
  }

  private frameText(): string | undefined {
    const s = this.host.state();
    const info = s?.data.frames[this.host.animator()?.frame ?? 0]?.info;
    if (!s || !info || s.data.frames.length < 2) return undefined;
    return `${info.label} · ${format.date(info.date)}`;
  }

  /** Paints the image of the film at a playhead position on a canvas. A pure function of its arguments. */
  private paintAt(
    target: CanvasRenderingContext2D,
    position: number,
    width: number,
    height: number,
    overlay: boolean,
  ): void {
    const a = this.host.animator();
    if (!a) return;
    a.setPosition(position);
    this.host.updateFrameViews();
    const picture = this.picture(width, height, overlay);
    if (picture) target.drawImage(picture, 0, 0);
  }

  /**
   * Renders the timelapse offline, image by image, on a virtual clock: never a screen recording. The film
   * carries the same interpolated animation as the live view.
   */
  async video(
    options: VideoOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<EncodedVideo | undefined> {
    const s = this.host.state();
    const a = this.host.animator();
    if (!s || !a) return undefined;
    this.settle();
    const before = { position: a.position, camera: this.host.scene.cameraState(), reduced: a.reducedMotion };
    // one view for the whole film, framed for its size
    const view = this.host.scene.exportView(options.width, options.height);
    this.exportCamera = view;
    // a film is made of in-between images: movement is never replaced by cuts here
    a.reducedMotion = false;
    const canvas = document.createElement("canvas");
    canvas.width = options.width;
    canvas.height = options.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    const plan = planVideo(s.data.frames.length, options);
    try {
      a.reset(s.data.frames.length, (f) => this.host.stateOf(f), 0);
      return await encodeVideo(
        canvas,
        plan,
        (i) => {
          this.host.scene.setCameraState(view, plan.angleAt(i));
          this.paintAt(ctx, plan.positionAt(i), options.width, options.height, options.overlay);
        },
        onProgress,
      );
    } finally {
      a.reducedMotion = before.reduced;
      this.exportCamera = undefined;
      this.host.scene.setCameraState(before.camera);
      a.reset(s.data.frames.length, (f) => this.host.stateOf(f), before.position);
      this.host.updateFrameViews(true);
    }
  }

  /** Fingerprints of the images at some playhead positions: lets a test compare two renders image for image. */
  imageHashes(positions: number[], width: number, height: number): string[] {
    const s = this.host.state();
    const a = this.host.animator();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!s || !a || !ctx) return [];
    this.settle();
    const reduced = a.reducedMotion;
    a.reducedMotion = false;
    a.reset(s.data.frames.length, (f) => this.host.stateOf(f), 0);
    const out = positions.map((p) => {
      this.paintAt(ctx, p, width, height, false);
      return pixelHash(ctx.getImageData(0, 0, width, height).data);
    });
    a.reducedMotion = reduced;
    return out;
  }

  /** Asks for the video options, renders the film and offers it for download. */
  async exportVideo(): Promise<void> {
    const s = this.host.state();
    if (!s || this.exporting) return;
    this.exporting = true;
    const note = el("div", { class: "export-note", text: "Rendering the video…" });
    this.host.stage.append(note);
    try {
      const result = await this.video(
        {
          width: 1920,
          height: 1080,
          fps: this.host.exportMenu.fps,
          secondsPerFrame: secondsPerFrameAt(this.host.exportMenu.speed),
          overlay: true,
          orbit: this.host.exportMenu.orbit,
        },
        (done, total) => {
          note.textContent = `Rendering the video: image ${format.integer(done)} of ${format.integer(total)}`;
        },
      );
      if (!result) return;
      const url = URL.createObjectURL(new Blob([result.bytes.slice().buffer], { type: result.mime }));
      const link = el("a", {
        attrs: {
          href: url,
          download: `${s.model.project}-timelapse.${result.mime === "video/mp4" ? "mp4" : "webm"}`,
        },
      });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      note.textContent = `The video could not be rendered: ${err instanceof Error ? err.message : String(err)}`;
      await new Promise((wait) => setTimeout(wait, 4000));
    } finally {
      note.remove();
      this.exporting = false;
    }
  }

  private picture(width: number, height: number, withOverlay: boolean): HTMLCanvasElement | undefined {
    const s = this.host.state();
    if (!s) return undefined;
    // a single picture is framed for its own size; a film sets its view once for all its images
    const saved = this.exportCamera ? undefined : this.host.scene.cameraState();
    if (saved) this.host.scene.setCameraState(this.host.scene.exportView(width, height));
    // the names are placed with the camera of the picture, at the same relative size as on screen
    const k = width / Math.max(this.host.stage.clientWidth, 1);
    const canvas = this.host.scene.renderToCanvas(width, height, (ctx) =>
      this.host.districtLabels.draw(ctx, width, height, this.host.theme(), k),
    );
    if (saved) this.host.scene.setCameraState(saved);
    if (withOverlay) {
      const ctx = canvas.getContext("2d");
      const legend = this.host.legend();
      if (ctx && legend)
        drawOverlay(ctx, width, height, {
          theme: this.host.theme(),
          project: s.model.project,
          preset: s.preset?.label ?? "Custom",
          legend,
          frame: this.frameText(),
          ...this.exportScore(),
        });
    }
    return canvas;
  }
}
