import type { Frame } from "@factory-city/schema";
import type { AnalysisResult } from "../analysis/types.js";
import type { AnalyzeShared } from "../analyze.js";
import { analyze } from "../analyze.js";
import { reachability, shortHashes } from "../collectors/history.js";
import { BlobReader } from "../source/blob-reader.js";
import type { FrameRecorder } from "./recorder.js";
import type { Rev, TimelineOptions } from "./types.js";

/** What the analysis of a frame reads from the one before it: the commits reachable and the time of the frame. */
export interface RunState {
  reachable: Set<string>;
  currentTime: number;
}

export interface RunInput {
  topLevel: string;
  folder: string;
  opts: TimelineOptions;
  revs: readonly Rev[];
  shared: AnalyzeShared;
  fileCache: ReadonlyMap<string, unknown>;
  state: RunState;
  recorder: FrameRecorder;
  /** Filled while the frames are made: every metric and every warning seen. */
  metrics: Set<string>;
  warnings: Set<string>;
}

/** Analyzes every revision in order and turns each into a frame. */
export async function runFrames(
  i: RunInput,
): Promise<{ frames: Frame[]; last: AnalysisResult; lookups: number }> {
  // what the frames have in common is looked up once: hashes, reachable commits, one process to read blobs
  const hashes = i.revs.map((r) => r.hash);
  const reachable = await reachability(i.topLevel, hashes);
  i.shared.shortHashes = await shortHashes(i.topLevel, hashes);
  i.shared.blobReader = new BlobReader(i.topLevel);
  try {
    return await playFrames(i, reachable);
  } finally {
    i.shared.blobReader.close();
    i.shared.blobReader = undefined;
  }
}

async function playFrames(
  i: RunInput,
  reachable: (rev: string) => Set<string>,
): Promise<{ frames: Frame[]; last: AnalysisResult; lookups: number }> {
  const frames: Frame[] = [];
  let last: AnalysisResult | undefined;
  let lookups = 0;
  for (const [index, rev] of i.revs.entries()) {
    i.state.reachable = reachable(rev.hash);
    i.state.currentTime = rev.time;
    const sizeBefore = i.fileCache.size;
    const result = await analyze({
      folder: i.folder,
      rev: rev.hash,
      path: i.opts.path,
      all: i.opts.all,
      include: i.opts.include,
      exclude: i.opts.exclude,
      shared: i.shared,
    });
    lookups += result.manifest.selected - (i.fileCache.size - sizeBefore);
    last = result;
    for (const m of result.manifest.metrics) i.metrics.add(m);
    for (const w of result.manifest.warnings) i.warnings.add(w);
    frames.push(await i.recorder.record({ index, rev, result, reachable: i.state.reachable }));
    i.opts.onProgress?.(index + 1, i.revs.length);
  }
  if (!last) throw new Error("No frame was produced.");
  return { frames, last, lookups };
}
