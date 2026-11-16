import type { Layout, Rect } from "@factory-city/layout";
import type { Animator } from "../anim/animator";
import type { TimelineData } from "../data/timeline";
import type { CityScene, Pick } from "../scene/CityScene";
import type { HoverCard } from "./hover-card";

/** The path of the folder a file is in. */
function dirOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

/** What the pointer reads and writes of the page: what is under it and what was pinned by a first tap. */
export interface PointerState {
  data: TimelineData;
  layout: Layout;
  hover: Pick;
  pinned: Pick;
}

export interface PointerHost {
  scene: CityScene;
  card: HoverCard;
  state(): PointerState | undefined;
  animator(): Animator | undefined;
  openDetails(union: number): void;
  closeDetails(): void;
  frameDistrict(path: string): void;
}

/**
 * What the mouse and the finger do on the city: pointing at a building shows its card and outlines it, a click
 * opens its details, a click elsewhere closes them, a double click frames a district. During playback a click
 * pauses and shows the card; on a touch screen a first tap shows the card and a second opens the details.
 */
export class PointerController {
  private rafPending = false;
  private pointer = { x: 0, y: 0, down: false, moved: false, startX: 0, startY: 0 };

  constructor(private readonly host: PointerHost) {}

  /** Listens to the canvas: hover, click, press and drag, double click. */
  attach(): void {
    const canvas = this.host.scene.canvas;
    canvas.addEventListener("pointermove", (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      if (e.buttons !== 0) {
        this.pointer.moved ||=
          Math.hypot(e.clientX - this.pointer.startX, e.clientY - this.pointer.startY) > 5;
        this.host.card.hide();
        return;
      }
      if (e.pointerType === "touch") return;
      this.scheduleHover();
    });
    canvas.addEventListener("pointerleave", () => this.host.card.hide());
    canvas.addEventListener("pointerdown", (e) => {
      this.pointer = {
        x: e.clientX,
        y: e.clientY,
        down: true,
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
      };
    });
    canvas.addEventListener("pointerup", (e) => {
      const wasClick = this.pointer.down && !this.pointer.moved;
      this.pointer.down = false;
      if (!wasClick) return;
      this.onClick(e);
    });
    // a double click on a district (or on a building: its district) frames it; Reset comes back
    canvas.addEventListener("dblclick", (e) => {
      const s = this.host.state();
      const pick = this.host.scene.pick(e.clientX, e.clientY);
      if (!s || !pick) return;
      this.host.frameDistrict(pick.kind === "folder" ? pick.path : dirOf(s.data.paths[pick.index] ?? ""));
    });
  }

  private scheduleHover(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.updateHover(this.pointer.x, this.pointer.y);
    });
  }

  folderOf(pick: NonNullable<Pick>): { path: string; rect: Rect } | undefined {
    const s = this.host.state();
    if (!s) return undefined;
    const path = pick.kind === "folder" ? pick.path : dirOf(s.data.paths[pick.index] ?? "");
    const rect = s.layout.folders.get(path);
    return rect ? { path, rect } : undefined;
  }

  /** The card is shown in map mode and whenever the timelapse is paused; during playback it is off. */
  private updateHover(x: number, y: number): void {
    const s = this.host.state();
    if (!s || this.host.animator()?.playing) return;
    const pick = this.host.scene.pick(x, y);
    s.hover = pick;
    // a building can be clicked: the cursor says so
    this.host.scene.canvas.style.cursor = pick?.kind === "file" ? "pointer" : "";
    if (!pick) {
      this.host.scene.setHover(null);
      this.host.card.hide();
      return;
    }
    this.host.scene.setHover(pick, this.folderOf(pick));
    this.host.card.show(pick, x, y);
  }

  private onClick(e: PointerEvent): void {
    const s = this.host.state();
    if (!s) return;
    if (this.host.animator()?.playing) {
      // during playback a click pauses and shows the card of what is under the pointer
      this.host.animator()?.pause();
      this.updateHover(e.clientX, e.clientY);
      return;
    }
    const pick = this.host.scene.pick(e.clientX, e.clientY);
    if (e.pointerType === "touch") {
      // first tap shows the card, a second tap on the same building opens the details
      const same = pick?.kind === "file" && s.pinned?.kind === "file" && pick.index === s.pinned.index;
      s.pinned = pick;
      if (same && pick?.kind === "file") {
        this.host.openDetails(pick.index);
        return;
      }
      s.hover = pick;
      this.host.scene.setHover(pick, pick ? this.folderOf(pick) : undefined);
      if (pick) this.host.card.show(pick, e.clientX, e.clientY);
      else this.host.card.hide();
      return;
    }
    if (pick?.kind === "file") this.host.openDetails(pick.index);
    else this.host.closeDetails();
  }
}
