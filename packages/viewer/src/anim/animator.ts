import type { Rgb } from "../view/color";
import { Transition } from "./transition";

export interface AnimatorSink {
  /** Both ends of the current move changed: write the instance buffers (once per step, not per image). */
  states(start: Float32Array, target: Float32Array): void;
  /** Progress of the current move, 0..1: one uniform. */
  progress(u: number): void;
  /** Reduced motion: the picture changed at once; the view cross-fades. */
  cut?(): void;
}

export interface AnimatorOptions {
  /** Share of a step spent moving; the rest is a hold so the eye can read the state. */
  moveShare?: number;
  /** Duration of a move toward a new target outside playback (jump, new preset), in milliseconds. */
  tweenMs?: number;
  secondsPerFrame?: number;
}

/** The segment of the timeline a position falls in, and the progress of its move. */
export function segmentAt(
  position: number,
  frames: number,
  moveShare: number,
): { from: number; to: number; u: number } {
  if (frames <= 1) return { from: 0, to: 0, u: 1 };
  const p = Math.min(Math.max(position, 0), frames - 1);
  const from = Math.min(Math.floor(p), frames - 2);
  return { from, to: from + 1, u: Math.min((p - from) / moveShare, 1) };
}

/**
 * Drives what is on screen. Two regimes:
 * - position: the picture is a pure function of the playhead position, so playback and dragging are continuous;
 * - tween: a timed move from what is on screen toward a new target (jump on the bar, new preset or metric).
 * A new target never snaps: it starts from the picture currently shown, even in the middle of a move.
 */
export class Animator {
  readonly transition: Transition;
  position = 0;
  playing = false;
  loop = false;
  speed = 1;
  reducedMotion = false;
  readonly moveShare: number;
  readonly tweenMs: number;
  secondsPerFrame: number;
  private frames = 1;
  private stateOf: (frame: number) => Float32Array = () => new Float32Array(0);
  private segment = -1;
  private tween: { elapsed: number; frame: number; resume: boolean } | undefined;
  private u = 1;
  private shownFrame = -1;

  constructor(
    count: number,
    delays: Float32Array,
    ramp: readonly Rgb[],
    private readonly sink: AnimatorSink,
    options: AnimatorOptions = {},
  ) {
    this.transition = new Transition(count, delays, ramp);
    this.moveShare = options.moveShare ?? 0.7;
    this.tweenMs = options.tweenMs ?? 700;
    this.secondsPerFrame = options.secondsPerFrame ?? 1.4;
  }

  get frameCount(): number {
    return this.frames;
  }

  /** The frame the playhead is on (the nearest one). */
  get frame(): number {
    return this.tween ? this.tween.frame : Math.min(Math.round(this.position), this.frames - 1);
  }

  /** True while buildings are moving. */
  get moving(): boolean {
    return this.tween !== undefined || this.playing;
  }

  get progress(): number {
    return this.u;
  }

  /** First picture: shown at once, there is nothing on screen to continue from. */
  reset(frames: number, stateOf: (frame: number) => Float32Array, position = 0): void {
    this.frames = Math.max(frames, 1);
    this.stateOf = stateOf;
    this.tween = undefined;
    this.segment = -1;
    this.shownFrame = -1;
    this.position = Math.min(Math.max(position, 0), this.frames - 1);
    this.applyPosition();
  }

  /** The states changed (preset, metric, scale, filter, theme): move from the picture on screen to the new one. */
  retarget(stateOf: (frame: number) => Float32Array, ramp?: readonly Rgb[]): void {
    const current = this.onScreen();
    this.stateOf = stateOf;
    if (ramp) this.transition.setRamp(ramp);
    this.startTween(current, this.frame, this.playing);
  }

  /** Starts from a given picture (the one a previous animator was showing) and moves to the current frame. */
  adopt(from: Float32Array): void {
    if (from.length === this.transition.start.length) this.startTween(from, this.frame, false);
  }

  /** Animated jump to a frame (click on the bar, previous, next). */
  goTo(frame: number): void {
    const k = Math.min(Math.max(Math.round(frame), 0), this.frames - 1);
    this.startTween(this.onScreen(), k, this.playing);
  }

  /** Dragging the playhead: the picture follows the position, interpolated like playback. */
  setPosition(position: number): void {
    const p = Math.min(Math.max(position, 0), this.frames - 1);
    if (this.tween) {
      // a move is running: leave it from where it is, toward the frame under the playhead
      this.startTween(this.onScreen(), Math.round(p), false);
      return;
    }
    this.position = p;
    this.applyPosition();
  }

  play(): void {
    if (this.frames <= 1) return;
    if (this.position >= this.frames - 1 && !this.tween) {
      this.playing = true;
      this.goTo(0);
      return;
    }
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
    if (this.tween) this.tween.resume = false;
  }

  /** Advances time. Returns true while something is still moving. */
  tick(dtMs: number): boolean {
    if (this.tween) {
      this.tween.elapsed += dtMs;
      const u = this.reducedMotion ? 1 : Math.min(this.tween.elapsed / this.tweenMs, 1);
      this.setProgress(u);
      if (u >= 1) {
        const { frame, resume } = this.tween;
        this.tween = undefined;
        this.position = frame;
        this.segment = -1;
        this.applyPosition();
        this.playing = resume;
      }
      return true;
    }
    if (!this.playing) return false;
    this.position += (dtMs / 1000 / this.secondsPerFrame) * this.speed;
    if (this.position >= this.frames - 1) {
      this.position = this.frames - 1;
      this.applyPosition();
      if (this.loop && this.frames > 1) this.goTo(0);
      else this.playing = false;
      return this.loop;
    }
    this.applyPosition();
    return true;
  }

  /** The states of every building as currently drawn. */
  onScreen(): Float32Array {
    return this.transition.sampleAll(this.u);
  }

  private startTween(from: Float32Array, frame: number, resume: boolean): void {
    const target = this.stateOf(frame);
    if (this.reducedMotion) {
      this.transition.setStates(target, target);
      this.sink.states(this.transition.start, this.transition.target);
      this.sink.cut?.();
    } else {
      this.transition.setStates(from, target);
      this.sink.states(this.transition.start, this.transition.target);
    }
    this.tween = { elapsed: 0, frame, resume };
    this.segment = -1;
    this.setProgress(this.reducedMotion ? 1 : 0);
  }

  private applyPosition(): void {
    if (this.reducedMotion) {
      // no movement: show whole frames, and let the view cross-fade between them
      const frame = Math.min(Math.round(this.position), this.frames - 1);
      if (frame !== this.shownFrame) {
        const state = this.stateOf(frame);
        this.transition.setStates(state, state);
        this.sink.states(this.transition.start, this.transition.target);
        if (this.shownFrame >= 0) this.sink.cut?.();
        this.shownFrame = frame;
      }
      this.setProgress(1);
      return;
    }
    const { from, to, u } = segmentAt(this.position, this.frames, this.moveShare);
    if (from !== this.segment) {
      this.segment = from;
      this.transition.setStates(this.stateOf(from), this.stateOf(to));
      this.sink.states(this.transition.start, this.transition.target);
    }
    this.setProgress(u);
  }

  private setProgress(u: number): void {
    this.u = u;
    this.sink.progress(u);
  }
}
