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

export interface EncodedVideo {
  bytes: Uint8Array;
  mime: "video/mp4" | "video/webm";
  /** `avc` (H.264), `vp9` or `vp8`; `mediarecorder` for the fallback. */
  codec: string;
  images: number;
}

/**
 * Encodes a film image by image. `draw(i)` must paint image `i` on the canvas. MP4 with H.264 when the browser
 * can encode it, otherwise WebM; without WebCodecs, the browser's own recorder.
 */
export async function encodeVideo(
  canvas: HTMLCanvasElement,
  plan: VideoPlan,
  draw: (image: number) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<EncodedVideo> {
  if (typeof VideoEncoder === "undefined") return recordVideo(canvas, plan, draw, onProgress);
  const mb = await import("mediabunny");
  const size = { width: canvas.width, height: canvas.height };
  const mp4 = await mb.canEncodeVideo("avc", size);
  const format = mp4 ? new mb.Mp4OutputFormat() : new mb.WebMOutputFormat();
  const codec = mp4 ? "avc" : (await mb.canEncodeVideo("vp9", size)) ? "vp9" : "vp8";
  if (!mp4 && !(await mb.canEncodeVideo(codec as "vp9" | "vp8", size)))
    return recordVideo(canvas, plan, draw, onProgress);
  const target = new mb.BufferTarget();
  const output = new mb.Output({ format, target });
  const source = new mb.CanvasSource(canvas, {
    codec: codec as "avc" | "vp9" | "vp8",
    bitrate: mb.QUALITY_HIGH,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: Math.round(1 / plan.step) });
  await output.start();
  for (let i = 0; i < plan.images; i++) {
    draw(i);
    await source.add(i * plan.step, plan.step);
    onProgress?.(i + 1, plan.images);
  }
  await output.finalize();
  if (!target.buffer) throw new Error("The video encoder produced no data.");
  return {
    bytes: new Uint8Array(target.buffer),
    mime: mp4 ? "video/mp4" : "video/webm",
    codec,
    images: plan.images,
  };
}

/** Fallback without WebCodecs: the browser records the canvas while images are drawn at their real pace. */
async function recordVideo(
  canvas: HTMLCanvasElement,
  plan: VideoPlan,
  draw: (image: number) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<EncodedVideo> {
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise<void>((done) => {
    recorder.onstop = () => done();
  });
  recorder.start();
  for (let i = 0; i < plan.images; i++) {
    draw(i);
    track?.requestFrame?.();
    onProgress?.(i + 1, plan.images);
    await new Promise((wait) => setTimeout(wait, plan.step * 1000));
  }
  recorder.stop();
  await stopped;
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
  return { bytes, mime: "video/webm", codec: "mediarecorder", images: plan.images };
}

/** A short fingerprint of a picture's pixels, to compare two renders image for image. */
export function pixelHash(data: Uint8ClampedArray): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i] as number;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
