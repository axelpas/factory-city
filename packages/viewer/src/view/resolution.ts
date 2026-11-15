/** A still picture may take this long to draw; a moving one must stay fluid. */
export const REST_BUDGET_MS = 500;
/** The scene is at rest when nothing has moved for this long. */
export const REST_DELAY_MS = 180;

/**
 * Thickness of the building edges in rendered pixels: about 0.6 CSS pixel, and never under one rendered pixel
 * (a thinner line would fade out). On a dense screen at full scale this is a hairline; at a reduced scale the
 * line stays one rendered pixel instead of growing with the pixels.
 */
export function edgeWidth(pixelRatio: number): number {
  return Math.max(1, 0.6 * pixelRatio);
}

/**
 * Render scale of the picture at rest. While something moves the scale may be lowered to stay fluid
 * (`motionRatio`, with `motionMs` per image); once it stops, the picture is drawn again as sharp as the
 * screen allows, within the time budget of one still picture (drawing time grows with the pixel count).
 */
export function restRatio(motionRatio: number, motionMs: number, max: number): number {
  if (motionRatio >= max || motionMs <= 0) return max;
  const affordable = motionRatio * Math.sqrt(REST_BUDGET_MS / motionMs);
  return Math.min(max, Math.max(motionRatio, affordable));
}
