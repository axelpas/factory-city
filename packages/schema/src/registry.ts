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
  metric({
    id: "imports_out",
    higherMeans: "more modules depended on",
    label: "Modules imported",
    definition: "Number of distinct internal modules this file imports.",
    computation:
      "Distinct files of the project reached by its import, export-from, require and dynamic import statements. Relative paths, tsconfig and jsconfig path aliases and workspace packages are resolved; external packages are ignored.",
    why: "A file that depends on many modules is hard to change and to test in isolation.",
    unit: "modules",
    direction: "higher-is-worse",
    level: 0,
    limits:
      "TypeScript and JavaScript only. Resolution is heuristic: no type checker, and conditional exports are not evaluated.",
  }),
  metric({
    id: "imports_in",
    higherMeans: "more modules depending on it",
    label: "Imported by",
    definition: "Number of distinct internal modules that import this file.",
    computation: "The reverse of the internal import links.",
    why: "A file many others depend on is costly to change: it has a wide blast radius.",
    unit: "modules",
    direction: "neutral",
    level: 0,
    limits:
      "Same resolution limits as imports_out. Files used only by external tools, such as entry points, show 0.",
  }),
  metric({
    id: "cohesion_groups",
    higherMeans: "more unrelated groups of functions",
    label: "Cohesion groups",
    definition: "Number of groups of functions that work together in the file (LCOM4 generalized to a file).",
    computation:
      "Functions and methods (constructors excluded) are nodes. Two are linked when one references the other, when both use the same variable, type or class field declared in the file, or when they share a leading word in their names (Card and CardHeader, formatDate and formatNumber). The metric is the number of connected groups; 1 means everything works together.",
    why: "Several groups mean the file does several unrelated jobs and could be split along them.",
    unit: "groups",
    direction: "higher-is-worse",
    level: 0,
    limits:
      "Structural cohesion, not thematic: references are matched by name, with no type checker. Unavailable for files without functions, barrel files and test files.",
  }),
  metric({
    id: "lack_of_cohesion",
    higherMeans: "less cohesive",
    label: "Lack of cohesion",
    definition: "How far the file is from being one cohesive unit, from 0 to 1.",
    computation:
      "(groups - 1) / (functions - 1); 0 for a single function. It reads like the LCOM5 that VERSO mapped to twist.",
    why: "Drives the twist of a building: the more a building turns, the less its parts belong together.",
    unit: "ratio",
    direction: "higher-is-worse",
    kind: "ratio",
    level: 0,
    limits: "Same limits as cohesion groups.",
  }),
  metric({
    id: "folder_cohesion",
    higherMeans: "more self-contained",
    label: "Folder cohesion",
    definition: "How self-contained a folder is: links inside it compared with links leaving it.",
    computation:
      "Import links between two files of the folder's subtree, divided by those links plus the links from the subtree to the rest of the repository.",
    why: "A low value means the folder is entangled with the rest of the code; a high value means it can be understood alone.",
    unit: "ratio",
    direction: "higher-is-better",
    kind: "ratio",
    scope: "folder",
    level: 0,
    limits: "Unavailable under 5 links in total. TypeScript and JavaScript imports only.",
  }),
  metric({
    id: "escape_hatches",
    higherMeans: "more silenced checks",
    label: "Silenced checks",
    definition: "Number of places where a check was silenced instead of the problem solved.",
    computation:
      "Sum of the kinds below, each counted separately by the language's rule set: any, @ts-ignore, @ts-expect-error, @ts-nocheck, lint-disable comments, skipped or focused tests, empty catch blocks.",
    why: "Each one hides a problem the tools would otherwise report.",
    unit: "places",
    direction: "higher-is-worse",
    level: 0,
    limits: "Rule sets exist for TypeScript and JavaScript. A deliberate, justified use counts as well.",
  }),
  metric({
    id: "escape_hatch_density",
    higherMeans: "more silenced checks per line",
    label: "Silenced checks per 1,000 lines",
    definition: "Silenced checks per 1,000 real lines of code.",
    computation: "Silenced checks divided by real lines, times 1,000.",
    why: "Compares files of different sizes fairly.",
    unit: "per 1,000 lines",
    direction: "higher-is-worse",
    level: 0,
    limits: "Unavailable for files with no real line.",
  }),
  metric({
    id: "escape_any",
    label: "Uses of any",
    definition: "An any type annotation or assertion.",
    computation: "Counted by the language's declarative rule set.",
    why: "Switches type checking off for a value.",
    unit: "places",
    direction: "higher-is-worse",
    level: 0,
    limits: "TypeScript and JavaScript only.",
  }),
  metric({
    id: "escape_ts_ignore",
    label: "@ts-ignore comments",
    definition: "A @ts-ignore comment.",
    computation: "Counted by the language's declarative rule set.",
    why: "Hides every error on the next line.",
    unit: "places",
    direction: "higher-is-worse",
    level: 0,
    limits: "TypeScript and JavaScript only.",
  }),
  metric({
    id: "escape_ts_expect_error",
    label: "@ts-expect-error comments",
    definition: "A @ts-expect-error comment.",
    computation: "Counted by the language's declarative rule set.",
    why: "Hides an error expected on the next line.",
    unit: "places",
    direction: "higher-is-worse",
    level: 0,
    limits: "TypeScript and JavaScript only.",
  }),
  metric({
    id: "escape_ts_nocheck",
    label: "@ts-nocheck comments",
    definition: "A @ts-nocheck comment.",
    computation: "Counted by the language's declarative rule set.",
    why: "Switches type checking off for the whole file.",
    unit: "places",
    direction: "higher-is-worse",
    level: 0,
    limits: "TypeScript and JavaScript only.",
  }),
  metric({
    id: "escape_lint_disable",
    label: "Lint-disable comments",
    definition: "An eslint-disable, tslint:disable or biome-ignore comment.",
    computation: "Counted by the language's declarative rule set.",
    why: "Hides lint findings.",
    unit: "places",
    direction: "higher-is-worse",
    level: 0,
    limits: "TypeScript and JavaScript only.",
  }),
  metric({
    id: "escape_skipped_test",
    label: "Skipped tests",
    definition: "A test marked skip.",
    computation: "Counted by the language's declarative rule set.",
    why: "A test that no longer protects anything.",
    unit: "places",
    direction: "higher-is-worse",
    level: 0,
    limits: "TypeScript and JavaScript only.",
  }),
  metric({
    id: "escape_focused_test",
    label: "Focused tests",
    definition: "A test marked only.",
    computation: "Counted by the language's declarative rule set.",
    why: "Silently skips every other test.",
    unit: "places",
    direction: "higher-is-worse",
    level: 0,
    limits: "TypeScript and JavaScript only.",
  }),
  metric({
    id: "escape_empty_catch",
    label: "Empty catch blocks",
    definition: "A catch block with no statement.",
    computation: "Counted by the language's declarative rule set.",
    why: "Swallows an error without a trace.",
    unit: "places",
    direction: "higher-is-worse",
    level: 0,
    limits: "TypeScript and JavaScript only.",
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
