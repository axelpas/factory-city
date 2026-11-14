/** Data levels (specification 6.2): 0 files, 1 git history, 2 forge, 3 facts. */
export type DataLevel = 0 | 1 | 2 | 3;
export type MetricDirection = "higher-is-worse" | "higher-is-better" | "neutral";
export type MetricKind = "number" | "ratio" | "category";
export type MetricScope = "file" | "folder" | "frame" | "factory";

export interface MetricDefinition {
  id: string;
  label: string;
  /** One sentence. */
  definition: string;
  computation: string;
  why: string;
  unit: string;
  direction: MetricDirection;
  kind: MetricKind;
  scope: MetricScope;
  level: DataLevel;
  limits: string;
  experimental: boolean;
  retrospective: boolean;
  /** Plain-language reading of a high value, for legends: "more complex". */
  higherMeans?: string;
}

function metric(
  m: Omit<MetricDefinition, "experimental" | "retrospective" | "scope" | "kind"> &
    Partial<Pick<MetricDefinition, "experimental" | "retrospective" | "scope" | "kind">>,
): MetricDefinition {
  return { experimental: false, retrospective: false, scope: "file", kind: "number", ...m };
}

/**
 * The metric registry: the single source for pickers, help and reports.
 * Ids follow CodeCharta names where an equivalent exists (ADR snapshot-format-cc-json).
 */
export const METRICS: readonly MetricDefinition[] = [
  metric({
    id: "loc",
    higherMeans: "longer",
    label: "Lines",
    definition: "Total number of lines in the file.",
    computation: "Count of line breaks plus one for a last unterminated line.",
    why: "A cheap first measure of size.",
    unit: "lines",
    direction: "higher-is-worse",
    level: 0,
    limits: "Counts blank and comment lines too.",
  }),
  metric({
    id: "rloc",
    higherMeans: "more code",
    label: "Real lines",
    definition: "Lines that are neither blank nor made only of comments.",
    computation: "Lines of the file minus blank lines and lines covered only by comment nodes.",
    why: "Size without noise; used as the default ground area.",
    unit: "lines",
    direction: "higher-is-worse",
    level: 0,
    limits: "A line mixing code and a comment counts as code.",
  }),
  metric({
    id: "comment_lines",
    higherMeans: "more comments",
    label: "Comment lines",
    definition: "Lines made only of comments.",
    computation: "Lines entirely covered by comment syntax nodes.",
    why: "Shows how much of a file is documentation or commented-out code.",
    unit: "lines",
    direction: "neutral",
    level: 0,
    limits: "Cannot tell documentation from commented-out code.",
  }),
  metric({
    id: "functions",
    higherMeans: "more functions",
    label: "Functions",
    definition: "Number of functions and methods declared in the file.",
    computation: "Count of function, method and arrow-function syntax nodes.",
    why: "A file with many functions often does many things.",
    unit: "functions",
    direction: "higher-is-worse",
    level: 0,
    limits: "Anonymous callbacks count as functions.",
  }),
  metric({
    id: "mcc",
    higherMeans: "more complex",
    label: "Complexity",
    definition: "Cyclomatic complexity of the file, summed over its functions.",
    computation:
      "One per function plus one per branch point (if, loop, case, catch, ternary, &&, ||, ??), at least 1 for a file with code, 0 for an empty one.",
    why: "More paths through the code means more tests and more risk; used as the default height.",
    unit: "paths",
    direction: "higher-is-worse",
    level: 0,
    limits: "Summed over the file, so a large file scores high even if each function is simple.",
  }),
  metric({
    id: "max_function_complexity",
    higherMeans: "a harder function",
    label: "Worst function complexity",
    definition: "Cyclomatic complexity of the most complex function in the file.",
    computation: "Maximum of the per-function complexity.",
    why: "Finds the single function that is hard to read or test.",
    unit: "paths",
    direction: "higher-is-worse",
    level: 0,
    limits: "Unavailable for files without functions.",
  }),
  metric({
    id: "max_nesting_level",
    higherMeans: "deeper nesting",
    label: "Deepest nesting",
    definition: "Deepest level of nested control structures in the file.",
    computation: "Maximum depth of nested if, loop, switch, try and callback nodes.",
    why: "Deeply nested code is hard to follow.",
    unit: "levels",
    direction: "higher-is-worse",
    level: 0,
    limits: "Callbacks count as one level each.",
  }),
  metric({
    id: "language",
    label: "Language",
    definition: "Programming language of the file.",
    computation: "Detected from the file extension; labels are listed in the analysis manifest.",
    why: "Lets the city be colored or filtered by language.",
    unit: "category",
    direction: "neutral",
    kind: "category",
    level: 0,
    limits: "Only languages with a configuration are recognized.",
  }),
  metric({
    id: "is_test",
    label: "Test file",
    definition: "Whether the file is a test (1) or not (0).",
    computation: "Folder names such as test or __tests__, and file names such as *.test.* or *.spec.*.",
    why: "Lets the viewer dim or hide tests.",
    unit: "flag",
    direction: "neutral",
    kind: "category",
    level: 0,
    limits: "A naming heuristic.",
  }),
];

const BY_ID = new Map(METRICS.map((m) => [m.id, m]));

export function getMetric(id: string): MetricDefinition | undefined {
  return BY_ID.get(id);
}

/** Metrics available at a given data level or below. */
export function metricsForLevel(level: DataLevel): MetricDefinition[] {
  return METRICS.filter((m) => m.level <= level);
}
