import type { TimelineData } from "../data/timeline";
import { frameName } from "./frame-cards";

export interface LotCard {
  kind: "lot";
  title: string;
  folder: string;
  /** Which file will stand here, or stood here, and at which frame. */
  text: string;
}

/** The nearest frame after (1) or before (-1) `from` in which the file exists, or -1. */
function nearestFrameWith(data: TimelineData, union: number, from: number, step: 1 | -1): number {
  for (let f = from + step; f >= 0 && f < data.frames.length; f += step)
    if ((data.frames[f]?.modelIndex[union] as number) >= 0) return f;
  return -1;
}

/** Card of an empty parcel: which file will stand there, or stood there, and at which frame. */
export function lotCard(data: TimelineData, frame: number, union: number): LotCard {
  const path = data.paths[union] as string;
  const cut = path.lastIndexOf("/");
  const first = data.firstFrame[union] as number;
  const last = data.lastFrame[union] as number;
  const next = nearestFrameWith(data, union, frame, 1);
  const previous = nearestFrameWith(data, union, frame, -1);
  let text: string;
  if (frame < first) text = `This file will stand here from ${frameName(data, first)}.`;
  else if (frame > last) text = `This file stood here until ${frameName(data, last)}.`;
  else if (previous >= 0 && next >= 0)
    text = `This file stood here until ${frameName(data, previous)} and comes back at ${frameName(data, next)}.`;
  else text = "This file is hidden by the current filter.";
  return { kind: "lot", title: path.slice(cut + 1), folder: cut < 0 ? "(root)" : path.slice(0, cut), text };
}
