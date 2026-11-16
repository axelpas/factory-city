const DRAG_PX = 4;

export interface ScrubHandlers {
  /** A frame position (fractional) under a horizontal pixel of the screen. */
  positionAt(clientX: number): number;
  /** The pointer moves over the track with nothing pressed. */
  onHover(clientX: number): void;
  onLeave(): void;
  /** A press has begun. */
  onPress(): void;
  /** The playhead is dragged to a position. */
  onSeek(position: number): void;
  /** The press ended: settle on the nearest frame. */
  onJump(frame: number): void;
}

/**
 * The pointer on the track of the timeline: a press without a move is a click, so the playhead travels to the
 * frame with the picture; a drag seeks, image by image.
 */
export function attachScrub(track: HTMLElement, h: ScrubHandlers): void {
  let pressed: { x: number; moved: boolean } | undefined;
  track.addEventListener("pointerdown", (e) => {
    pressed = { x: e.clientX, moved: false };
    h.onPress();
    track.setPointerCapture(e.pointerId);
  });
  track.addEventListener("pointermove", (e) => {
    if (!pressed) {
      h.onHover(e.clientX);
      return;
    }
    if (!pressed.moved && Math.abs(e.clientX - pressed.x) < DRAG_PX) return;
    pressed.moved = true;
    h.onSeek(h.positionAt(e.clientX));
  });
  track.addEventListener("pointerleave", () => h.onLeave());
  const release = (e: PointerEvent) => {
    if (!pressed) return;
    pressed = undefined;
    track.releasePointerCapture(e.pointerId);
    h.onJump(Math.round(h.positionAt(e.clientX)));
  };
  track.addEventListener("pointerup", release);
  track.addEventListener("pointercancel", release);
}
