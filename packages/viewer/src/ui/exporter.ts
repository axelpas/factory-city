import type { Layout } from "@factory-city/layout";
import type { Report } from "@factory-city/schema";
import { el } from "../lib/dom";
import { format } from "../lib/format";
import { scoreAt } from "../view/health";
import type { DistrictLabelLayer } from "./district-labels";
import type { ExportMenu } from "./export-menu";
import { drawOverlay } from "./overlay";
import type {
  Animator,
  CameraState,
  CityScene,
  LegendModel,
  Mapping,
  Model,
  Preset,
  Theme,
  TimelineData,
} from "./types";

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
  fixedView: CameraState | undefined;

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

  picture(width: number, height: number, withOverlay: boolean): HTMLCanvasElement | undefined {
    const s = this.host.state();
    if (!s) return undefined;
    // a single picture is framed for its own size; a film sets its view once for all its images
    const saved = this.fixedView ? undefined : this.host.scene.cameraState();
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
