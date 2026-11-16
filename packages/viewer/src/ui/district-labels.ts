import type { Layout } from "@factory-city/layout";
import { el } from "../lib/dom";
import type { CityScene } from "../scene/CityScene";
import type { Theme } from "../themes/index";
import { type DistrictLabel, districtLabels, type Projector, placeLabels } from "../view/district-labels";

/** Names are measured once; a city with more folders than this names the biggest ones only. */
const MAX_NODES = 400;
/** Even a fast frame leaves the browser this much time: names are recomputed less often when it is costly. */
const MAX_INTERVAL_MS = 150;

/**
 * The names of the districts, laid over the canvas. They follow the camera and the buildings: each frame
 * drawn on screen asks for a new placement, spaced out when a placement is costly. The same placement draws
 * the names on an exported picture.
 */
export class DistrictLabelLayer {
  readonly element = el("div", { class: "district-labels", attrs: { "aria-hidden": "true" } });
  private labels: DistrictLabel[] = [];
  private readonly nodes = new Map<string, HTMLElement>();
  private readonly sizes = new Map<string, { w: number; h: number }>();
  private enabled = true;
  private lastRun = 0;
  private lastCost = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly scene: CityScene) {
    scene.onRendered = () => this.request();
  }

  get shown(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.element.hidden = !on;
    if (on) this.request();
  }

  /** A new layout: the names are those of its folders. */
  setLayout(layout: Layout): void {
    this.labels = districtLabels(layout).slice(0, MAX_NODES);
    this.nodes.clear();
    this.sizes.clear();
    this.element.replaceChildren();
    for (const label of this.labels) {
      const node = el("div", {
        class: `district-label depth-${Math.min(label.depth, 3)}`,
        text: label.name,
        attrs: { "data-path": label.path },
      });
      node.style.visibility = "hidden";
      this.nodes.set(label.path, node);
      this.element.append(node);
    }
    this.request(true);
  }

  private projector(): Projector {
    return {
      project: (x, y, z) => this.scene.project(x, y, z),
      blocked: (x, y) => this.scene.blocked(x, y),
    };
  }

  /** Asks for a new placement: at once for a cheap one, spaced out for a costly one. */
  request(now = false): void {
    if (!this.enabled || this.labels.length === 0) return;
    const wait = now
      ? 0
      : Math.max(0, this.lastRun + Math.min(this.lastCost * 4, MAX_INTERVAL_MS) - performance.now());
    if (this.timer !== undefined) return;
    if (wait === 0) this.place();
    else this.timer = setTimeout(() => this.place(), wait);
  }

  private measure(): void {
    if (this.sizes.size > 0 || !this.element.isConnected) return;
    for (const [path, node] of this.nodes) {
      node.style.visibility = "hidden";
      this.sizes.set(path, { w: node.offsetWidth, h: node.offsetHeight });
    }
  }

  private place(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.measure();
    const started = performance.now();
    const placed = placeLabels(
      this.labels,
      this.projector(),
      (l) => this.sizes.get(l.path) ?? { w: 60, h: 16 },
      this.scene.freeArea(),
    );
    const at = new Map(placed.map((p) => [p.path, p.box]));
    for (const [path, node] of this.nodes) {
      const box = at.get(path);
      if (!box) {
        node.style.visibility = "hidden";
        continue;
      }
      node.style.transform = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`;
      node.style.visibility = "visible";
    }
    this.lastRun = performance.now();
    this.lastCost = this.lastRun - started;
  }

  /** Writes the names on an exported picture, placed for that picture's camera, size and scale. */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, theme: Theme, scale: number): void {
    if (!this.enabled) return;
    const px = 11 * scale;
    ctx.font = `600 ${px}px ${theme.font}`;
    ctx.textBaseline = "middle";
    const pad = 4 * scale;
    const boxes = placeLabels(
      this.labels,
      this.projector(),
      (l) => ({ w: ctx.measureText(l.name).width + 2 * pad, h: px * 1.6 }),
      { x: 0, y: 0, w: width, h: height },
    );
    for (const { name, box } of boxes) {
      ctx.fillStyle = theme.colors.panel ?? "";
      ctx.globalAlpha = 0.8;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.colors.text ?? "";
      ctx.fillText(name, box.x + pad, box.y + box.h / 2);
    }
  }
}
