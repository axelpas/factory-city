import type { EncodedVideo, VideoOptions } from "../export/video";
import { encodeVideo, pixelHash, planVideo, secondsPerFrameAt } from "../export/video";
import { el } from "../lib/dom";
import { format } from "../lib/format";
import type { Exporter, ExporterHost } from "./exporter";

/**
 * The timelapse as a film: rendered offline, image by image, on a virtual clock (never a screen recording),
 * with the same interpolated animation as the live view. Also the fingerprints of renders, for tests.
 */
export class Film {
  private exporting = false;

  constructor(
    private readonly host: ExporterHost,
    private readonly exporter: Exporter,
  ) {}

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
    const picture = this.exporter.picture(width, height, overlay);
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
    this.exporter.settle();
    const before = { position: a.position, camera: this.host.scene.cameraState(), reduced: a.reducedMotion };
    // one view for the whole film, framed for its size
    const view = this.host.scene.exportView(options.width, options.height);
    this.exporter.fixedView = view;
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
      this.exporter.fixedView = undefined;
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
    this.exporter.settle();
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
}
