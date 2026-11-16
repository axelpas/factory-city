import type { Frame } from "@factory-city/schema";

/** The title of a frame: the issue (number and title when known), else the commit or day label. */
export function frameTitle(frame: Frame): string {
  if (!frame.issue) return frame.label;
  return `#${frame.issue.number}${frame.issue.title ? ` ${frame.issue.title}` : ""}`;
}

/** The frame under a horizontal share (0 to 1) of a track with `count` frames. */
export function frameAtShare(share: number, count: number): number {
  const clamped = Math.min(Math.max(share, 0), 1);
  return Math.round(clamped * Math.max(count - 1, 0));
}
