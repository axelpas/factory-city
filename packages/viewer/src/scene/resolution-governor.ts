/**
 * Keeps motion fluid: when several images in a row take longer than 1/40 s the picture is drawn at a lower
 * resolution, and the resolution comes back when images are fast again.
 */
export class ResolutionGovernor {
  /** Render scale while something moves: lowered when images take too long, raised back when there is room. */
  ratio: number;
  /** Smoothed time of one image while something moves, in milliseconds. */
  ms = 0;
  private slow = 0;
  private fast = 0;

  constructor(initial: number) {
    this.ratio = initial;
  }

  /** Learns from one image of `dtMs` milliseconds; returns the new render scale when it changed. */
  adapt(dtMs: number, max: number): number | undefined {
    if (dtMs > 0) this.ms = this.ms > 0 ? this.ms * 0.8 + dtMs * 0.2 : dtMs;
    if (dtMs > 25) {
      this.fast = 0;
      if (++this.slow >= 3 && this.ratio > 0.75) {
        this.slow = 0;
        this.ratio = Math.max(0.75, this.ratio * 0.8);
        return this.ratio;
      }
    } else if (dtMs > 0 && dtMs < 14) {
      this.slow = 0;
      if (++this.fast >= 90 && this.ratio < max) {
        this.fast = 0;
        this.ratio = Math.min(max, this.ratio * 1.15);
        return this.ratio;
      }
    } else {
      this.slow = 0;
    }
    return undefined;
  }
}
