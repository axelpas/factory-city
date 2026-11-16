import type { VideoPlan } from "./video";
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
