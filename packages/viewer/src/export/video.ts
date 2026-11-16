/** What a video export needs to know. */
export interface VideoOptions {
  width: number;
  height: number;
  /** Images per second: 30 or 60. */
  fps: number;
  /** Seconds each frame of the timeline takes. */
  secondsPerFrame: number;
  overlay: boolean;
  /** Turn slowly around the city instead of keeping the camera still. */
  orbit: boolean;
}

export interface VideoPlan {
  /** Number of images of the film. */
  images: number;
  /** Duration of one image, in seconds. */
  step: number;
  /** Playhead position (in frames of the timeline) of each image. */
  positionAt(image: number): number;
  /** Camera angle around the city (in radians, from the starting view) of each image. */
  angleAt(image: number): number;
}

/** At speed 1, each frame of the timeline takes this long in the film. */
export const BASE_SECONDS_PER_FRAME = 1.4;
/** The speeds offered for a film: a multiple of the base pace. */
export const VIDEO_SPEEDS = [0.5, 1, 2, 4] as const;

/** Seconds a frame takes at a speed (2 means twice as fast). */
export function secondsPerFrameAt(speed: number): number {
  return BASE_SECONDS_PER_FRAME / Math.max(speed, 0.01);
}

/** A duration in seconds as people read it: "38 s", "2 min 05 s". */
export function durationText(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, "0")} s`;
}

/** A full turn takes this long when the camera orbits. */
const ORBIT_SECONDS = 60;
/** The film holds on the last frame this long. */
const END_HOLD_SECONDS = 1;

/** How long the film lasts, in seconds: the frames at their pace, then a hold on the last one. */
export function videoSeconds(frames: number, secondsPerFrame: number): number {
  return Math.max(frames - 1, 0) * secondsPerFrame + END_HOLD_SECONDS;
}

/**
 * The film on a virtual clock: image `i` shows the timeline at `i / fps` seconds, whatever the machine's
 * speed. The same data gives the same images. A timeline of one frame gives a short still film.
 */
export function planVideo(
  frames: number,
  options: Pick<VideoOptions, "fps" | "secondsPerFrame" | "orbit">,
): VideoPlan {
  const { fps, secondsPerFrame } = options;
  const last = Math.max(frames - 1, 0);
  const seconds = videoSeconds(frames, secondsPerFrame);
  const images = Math.max(1, Math.round(seconds * fps));
  return {
    images,
    step: 1 / fps,
    positionAt: (image) => Math.min(image / fps / secondsPerFrame, last),
    angleAt: (image) => (options.orbit ? (image / fps / ORBIT_SECONDS) * Math.PI * 2 : 0),
  };
}

export { type EncodedVideo, encodeVideo, pixelHash } from "./video-encode";
