import { computeHistory, type HistoryOptions, type HistoryResult } from "./history/compute.js";
import { loadHistoryLog, revisionTime } from "./history/log.js";

export {
  computeHistory,
  type FileHistory,
  type HistoryOptions,
  type HistoryResult,
  historyMetrics,
} from "./history/compute.js";
export {
  type HistoryLog,
  loadHistoryLog,
  parseLog,
  type RawCommit,
  reachableCommits,
  revisionTime,
} from "./history/log.js";

export async function collectHistory(
  topLevel: string,
  prefix: string,
  rev: string,
  files: ReadonlySet<string>,
  options: HistoryOptions,
  scope = "",
): Promise<HistoryResult> {
  const log = await loadHistoryLog(topLevel, rev, scope);
  return computeHistory(log, await revisionTime(topLevel, rev), undefined, prefix, files, options);
}
