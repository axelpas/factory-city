import type { EncodedVideo, VideoOptions } from "../export/video";
import { createHub } from "./app/create-hub";
import type { Hub } from "./app/hub";

/** The whole viewer: panels, pickers, legend, hover card, details, timeline and export, around one city. */
export class App {
  private readonly hub: Hub;

  constructor(root: HTMLElement) {
    this.hub = createHub(root);
  }

  /** Loads the project list, then the current project; falls back to the drop zone. */
  start(): Promise<void> {
    return this.hub.parts.loader.start();
  }

  /** Integration hook: selects the first file of the frame, as a click on it does. */
  selectFirstFile(): boolean {
    return this.hub.ui.selection.selectFirst();
  }

  /** Integration hook: the index of the selected file, or null. */
  selected(): number | null {
    return this.hub.ui.selection.selected;
  }

  /** Lets every running move finish at once, so that a picture shows the settled city. */
  settle(): void {
    this.hub.ui.exporter.settle();
  }

  /** The current view as a PNG data URL at an exact size, for headless rendering. */
  capture(width: number, height: number, withOverlay = true, frame?: number): string | undefined {
    return this.hub.ui.exporter.capture(width, height, withOverlay, frame);
  }

  /** Renders the timelapse offline, image by image, on a virtual clock. */
  video(
    options: VideoOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<EncodedVideo | undefined> {
    return this.hub.ui.film.video(options, onProgress);
  }

  /** Fingerprints of the images at some playhead positions, to compare two renders image for image. */
  imageHashes(positions: number[], width: number, height: number): string[] {
    return this.hub.ui.film.imageHashes(positions, width, height);
  }
}
