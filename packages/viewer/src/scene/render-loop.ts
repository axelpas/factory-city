import type * as THREE from "three";
import { edgeWidth, REST_DELAY_MS, restRatio } from "../view/resolution";
import { ResolutionGovernor } from "./resolution-governor";

/** What the loop moves and draws. */
export interface LoopHost {
  renderer: THREE.WebGLRenderer;
  /** Advances what moves besides the animation (the camera, the outlines); true while something does. */
  advance(dtMs: number): boolean;
  /** Draws the scene on screen. */
  draw(): void;
  /** Called on every frame with the elapsed milliseconds; true while the animation moves. */
  tickAnimation(dtMs: number): boolean;
  /** The canvas changed size or scale. */
  resize(): void;
  setEdgeWidth(width: number): void;
}

/**
 * The animation clock of the city: one frame at a time, drawing only when something changed, at the render
 * scale that keeps motion fluid and, at rest, as sharp as the screen allows.
 */
export class RenderLoop {
  private dirty = true;
  private frame = 0;
  private lastTime = 0;
  private lastMotion = 0;
  /** Current render scale. */
  private pixelRatio: number;
  private readonly governor: ResolutionGovernor;
  /** Images drawn during the last second, for performance checks. */
  fps = 0;
  private fpsFrames = 0;
  private fpsSince = 0;
  /** Called after each image drawn on screen: whatever is laid over the canvas follows the camera. */
  onRendered: (() => void) | undefined;

  constructor(private readonly host: LoopHost) {
    this.pixelRatio = this.maxRatio();
    this.governor = new ResolutionGovernor(this.pixelRatio);
    host.renderer.setPixelRatio(this.pixelRatio);
    host.setEdgeWidth(edgeWidth(this.pixelRatio));
  }

  start(): void {
    const loop = (time: number) => {
      this.frame = requestAnimationFrame(loop);
      this.tick(time);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
  }

  requestRender(): void {
    this.dirty = true;
  }

  /** One animation frame: advance what moves, pick the render scale, draw when something changed. */
  private tick(time: number): void {
    const dt = this.lastTime ? Math.min(time - this.lastTime, 100) : 0;
    this.lastTime = time;
    const animating = this.host.tickAnimation(dt);
    const moving = this.host.advance(dt) || animating;
    this.chooseResolution(moving, time);
    if (this.dirty || moving) {
      this.dirty = false;
      this.host.draw();
      this.onRendered?.();
      this.fpsFrames++;
      if (moving) this.adaptResolution(dt);
    }
    if (time - this.fpsSince >= 1000) {
      this.fps = (this.fpsFrames * 1000) / (time - this.fpsSince);
      this.fpsFrames = 0;
      this.fpsSince = time;
    }
  }

  /** While something moves the scale is the one that keeps motion fluid; at rest it is as sharp as the screen allows. */
  private chooseResolution(moving: boolean, time: number): void {
    if (moving) {
      this.lastMotion = time;
      if (this.pixelRatio !== this.governor.ratio) this.setPixelRatio(this.governor.ratio);
    } else if (time - this.lastMotion > REST_DELAY_MS) {
      // draw the still picture once more, as sharp as the screen allows
      const rest = restRatio(this.governor.ratio, this.governor.ms, this.maxRatio());
      if (rest > this.pixelRatio + 0.01) this.setPixelRatio(rest);
    }
  }

  /** Draws at a lower resolution when images take too long, and back when they are fast again. */
  private adaptResolution(dtMs: number): void {
    const next = this.governor.adapt(dtMs, this.maxRatio());
    if (next !== undefined) this.setPixelRatio(next);
  }

  private maxRatio(): number {
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  private setPixelRatio(ratio: number): void {
    this.pixelRatio = ratio;
    this.host.renderer.setPixelRatio(ratio);
    this.host.setEdgeWidth(edgeWidth(ratio));
    this.host.resize();
  }
}
