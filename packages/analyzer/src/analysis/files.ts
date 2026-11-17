import { detectDuplication } from "../collectors/duplication.js";
import { inspectContent } from "../inspect.js";
import { LANGUAGES } from "../languages/index.js";
import { computeMetrics, plainMetrics } from "../metrics/file-metrics.js";
import { getParser } from "../parse.js";
import { bump, type emptySummary, type selectEntries } from "../select.js";
import type { Source } from "../source/types.js";
import type { AnalyzeOptions, CachedFile, FileValues } from "./types.js";

const LANGUAGE_CODES = new Map(LANGUAGES.map((l, i) => [l.id, i]));

type Candidate = ReturnType<typeof selectEntries>[number];

export interface MeasuredFiles {
  attributesByPath: FileValues;
  importsByFile: Map<string, string[]>;
  groupNames: Map<string, string[][]>;
  /** The metric ids that at least one file has. */
  present: Set<string>;
  /** Blob id per analyzed path, when the source is a git revision. */
  blobs: Map<string, string>;
  analyzedEntries: Array<Candidate["entry"]>;
  syntaxErrorFiles: number;
}

/** The key under which the metrics of a file are cached: its content, how it is read and how it is measured. */
function cacheKeyOf(candidate: Candidate, opts: AnalyzeOptions): string | undefined {
  const { entry, language, isTest } = candidate;
  if (!entry.blobId) return undefined;
  return `${entry.blobId}|${language?.id ?? ""}|${isTest ? 1 : 0}|${opts.all ? 1 : 0}`;
}

/** The metrics of one candidate: from the cache when its content is known, else read, checked and measured. */
async function measure(source: Source, candidate: Candidate, opts: AnalyzeOptions): Promise<CachedFile> {
  const { entry, language, isTest } = candidate;
  const cache = opts.shared?.fileCache;
  const cacheKey = cacheKeyOf(candidate, opts);
  const known = cacheKey ? cache?.get(cacheKey) : undefined;
  if (known) return known;
  const inspected = inspectContent(await source.read(entry), !opts.all);
  const measured: CachedFile =
    inspected.problem || inspected.text === undefined
      ? { problem: inspected.problem ?? "non_utf8" }
      : {
          result: language
            ? computeMetrics(await getParser(language.grammar), language, inspected.text, isTest)
            : plainMetrics(inspected.text),
        };
  if (cacheKey) cache?.set(cacheKey, measured);
  return measured;
}

/** Records a file that was measured in the totals of the run. */
function record(
  out: MeasuredFiles,
  candidate: Candidate,
  result: Extract<CachedFile, { result: unknown }>["result"],
) {
  const { entry, language, isTest } = candidate;
  out.analyzedEntries.push(entry);
  if (entry.blobId) out.blobs.set(entry.path, entry.blobId);
  if (language?.imports || language?.modules) out.importsByFile.set(entry.path, result.imports);
  if (result.syntaxErrors) out.syntaxErrorFiles++;
  if (result.groups) out.groupNames.set(entry.path, result.groups);
  const values: Record<string, number> = { ...result.metrics, is_test: isTest ? 1 : 0 };
  // the code is the language's position in the fixed list, so that it means the same in every frame
  if (language) values.language = LANGUAGE_CODES.get(language.id) as number;
  for (const key of Object.keys(values)) out.present.add(key);
  out.attributesByPath.set(entry.path, values);
}

/** Reads and measures every selected file; a file that cannot be read is counted, not measured. */
export async function measureFiles(
  source: Source,
  candidates: Candidate[],
  opts: AnalyzeOptions,
  summary: ReturnType<typeof emptySummary>,
): Promise<MeasuredFiles> {
  const out: MeasuredFiles = {
    attributesByPath: new Map(),
    importsByFile: new Map(),
    groupNames: new Map(),
    present: new Set(),
    blobs: new Map(),
    analyzedEntries: [],
    syntaxErrorFiles: 0,
  };
  for (const candidate of candidates) {
    const cached = await measure(source, candidate, opts);
    if ("problem" in cached) {
      if (cached.problem === "generated_or_vendored") bump(summary.files, cached.problem);
      else bump(summary.warnings, cached.problem);
    } else record(out, candidate, cached.result);
  }
  return out;
}

/** Optional (`--with duplication`): copied blocks, found in memory across the analyzed files. */
export async function addDuplication(
  source: Source,
  entries: MeasuredFiles["analyzedEntries"],
  attributesByPath: FileValues,
  opts: AnalyzeOptions,
): Promise<Map<string, string>> {
  const duplicates = new Map<string, string>();
  const texts: Array<{ path: string; text: string }> = [];
  for (const entry of entries) {
    const { text } = inspectContent(await source.read(entry), !opts.all);
    if (text !== undefined) texts.push({ path: entry.path, text });
  }
  for (const [path, found] of await detectDuplication(texts)) {
    const values = attributesByPath.get(path);
    if (!values) continue;
    values.duplicated_lines = found.lines;
    const loc = values.loc ?? 0;
    if (loc > 0) values.duplication_ratio = Math.min(1, found.lines / loc);
    if (found.partner) duplicates.set(path, found.partner);
  }
  return duplicates;
}
