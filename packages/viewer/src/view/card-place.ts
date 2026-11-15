import type { Rect } from "./framing";

/** Distance kept between the pointer and the card, and between the card and the edge of the free area. */
const OFFSET = 18;
const EDGE = 8;

/**
 * Where to put the hover card: beside the pointer, on the side that has room, and always inside the part of
 * the stage that the bar, the panels and the timeline leave free.
 */
export function placeCard(
  pointer: { x: number; y: number },
  card: { w: number; h: number },
  free: Rect,
): { left: number; top: number } {
  const minLeft = free.x + EDGE;
  const maxLeft = Math.max(minLeft, free.x + free.w - EDGE - card.w);
  const minTop = free.y + EDGE;
  const maxTop = Math.max(minTop, free.y + free.h - EDGE - card.h);
  const right = pointer.x + OFFSET;
  const left = right + card.w <= free.x + free.w - EDGE ? right : pointer.x - OFFSET - card.w;
  const below = pointer.y + OFFSET;
  const top = below + card.h <= free.y + free.h - EDGE ? below : pointer.y - OFFSET - card.h;
  return {
    left: Math.round(Math.min(Math.max(left, minLeft), maxLeft)),
    top: Math.round(Math.min(Math.max(top, minTop), maxTop)),
  };
}
