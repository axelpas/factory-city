import { join } from "node:path";
import type { Facts, Frame, FrameHealth, RiskDimension } from "@factory-city/schema";
import type { AnalysisResult } from "../analysis/types.js";
import { addCostShares } from "../collectors/enrich.js";
import type { RawCommit } from "../collectors/history.js";
import { frameHealth } from "../health/health.js";
import { diffBlobs, factOf, lineChanges, qualityChange, snapshotTotals, writeCostShares } from "./frame.js";
import { writeAtomic } from "./io.js";
import { kindOfSubject } from "./plan.js";
import type { Rev } from "./types.js";

export interface RecorderInput {
  framesDir: string;
  mode: string;
  /** The folder prefix of the analyzed folder inside the repository. */
  prefix: string;
  byHash: Map<string, RawCommit>;
  facts: Facts | undefined;
  dimensions: readonly RiskDimension[];
  /** The metrics seen in any frame. */
  metrics: Set<string>;
}

/** What a frame needs of the revision it stands for, and of the one before. */
export interface RevisionState {
  index: number;
  rev: Rev;
  result: AnalysisResult;
  /** Commits reachable at this revision. */
  reachable: Set<string>;
}

/** The numbers of a frame that come from what changed since the previous one. */
function changesOf(
  r: RevisionState,
  input: RecorderInput,
  previousBlobs: Map<string, string>,
  previousReachable: Set<string>,
) {
  const { added, modified, deleted } = diffBlobs(r.result.blobs, previousBlobs);
  const newCommits = [...r.reachable].filter((h) => !previousReachable.has(h));
  const first = r.index === 0;
  const lines = first
    ? { linesAdded: 0, linesDeleted: 0, lines: {} }
    : lineChanges(newCommits, input.byHash, input.prefix, r.result.blobs, previousBlobs);
  const touched = [...added, ...modified, ...deleted];
  const folders = new Set(touched.map((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "")));
  return { added, modified, deleted, newCommits, touched, folders, ...lines };
}

/**
 * Turns the analysis of each revision into a frame, in order, and keeps what the next frame is compared with:
 * the files, the commits, the health and the shortcuts of the one before. Writes the snapshot of every frame.
 */
export class FrameRecorder {
  private previousBlobs = new Map<string, string>();
  private previousReachable = new Set<string>();
  private previousHealth: FrameHealth | undefined;
  private previousShortcuts = 0;
  private readonly costByFile = new Map<string, number>();

  constructor(private readonly input: RecorderInput) {}

  async record(r: RevisionState): Promise<Frame> {
    const { index, rev, result } = r;
    const c = changesOf(r, this.input, this.previousBlobs, this.previousReachable);
    const health = frameHealth(result.files, this.input.dimensions);
    const shortcuts = result.files.reduce((sum, f) => sum + (f.values.escape_hatches ?? 0), 0);
    const quality = qualityChange(health, shortcuts, this.previousHealth, this.previousShortcuts);
    this.previousHealth = health;
    this.previousShortcuts = shortcuts;
    this.addCost(r, c.lines);
    const short = rev.hash.slice(0, 8);
    const id = `${String(index + 1).padStart(4, "0")}-${short}`;
    const date = new Date(rev.time * 1000).toISOString();
    await writeAtomic(join(this.input.framesDir, `${id}.cc.json`), JSON.stringify(result.snapshot));
    this.previousBlobs = result.blobs;
    this.previousReachable = r.reachable;
    const first = index === 0;
    return {
      id,
      index,
      kind: rev.meta?.kind ?? kindOfSubject(rev.subject),
      label:
        rev.meta?.label ??
        (this.input.mode === "day" ? date.slice(0, 10) : `${short.slice(0, 7)} ${rev.subject}`),
      date,
      commit: short,
      subject: rev.subject,
      commits: first ? [short] : c.newCommits.map((h) => h.slice(0, 8)),
      snapshot: `frames.${this.input.mode}/${id}.cc.json`,
      totals: snapshotTotals(result.snapshot),
      added: first ? [] : c.added.sort(),
      modified: c.modified.sort(),
      deleted: c.deleted.sort(),
      metrics: {
        files_touched: first ? 0 : c.touched.length,
        lines_added: c.linesAdded,
        lines_deleted: c.linesDeleted,
        folders_touched: first ? 0 : c.folders.size,
        ...quality,
      },
      health,
      lines: c.lines,
      ...(rev.meta?.issue ? { issue: rev.meta.issue } : {}),
      ...(rev.meta?.unlinked ? { unlinked: true } : {}),
    };
  }

  /** Experimental: the cost of the issues that touched each file, split by the lines each one changed there. */
  private addCost(r: RevisionState, lines: Record<string, [number, number]>): void {
    const { facts, metrics } = this.input;
    if (!facts) return;
    addCostShares(this.costByFile, lines, factOf(facts, r.rev)?.cost);
    if (this.costByFile.size === 0) return;
    writeCostShares(r.result.snapshot, this.costByFile);
    metrics.add("cost_share");
  }
}
