import type { ActionType, Hotspot, HotspotAction } from "@factory-city/schema";
import type { HealthExtras, HealthFile } from "./types.js";

const SHORTCUT_NAMES: Record<string, string> = {
  any: "any",
  ts_ignore: "@ts-ignore",
  ts_expect_error: "@ts-expect-error",
  ts_nocheck: "@ts-nocheck",
  type_ignore: "type-checker suppressions",
  lint_disable: "lint-disable comments",
  skipped_test: "skipped tests",
  focused_test: "focused tests",
  empty_catch: "empty catch blocks",
  unsafe_code: "unsafe blocks",
  force_cast: "forced casts and tries",
};

/** What a rule needs to word its advice. */
interface Context {
  file: HealthFile;
  extras: HealthExtras;
  /** Whether a dimension is exceeded. */
  is(dimension: string): boolean;
}

type Advice = [ActionType, string];

/** Splitting along the cohesion groups, named when the report knows them. */
function splitByCohesion({ file, extras, is }: Context): Advice | undefined {
  if (!is("cohesion")) return undefined;
  const groups = extras.groups?.get(file.path) ?? [];
  const named = groups.map((g) => g.slice(0, 3).join(", ") + (g.length > 3 ? ", ..." : ""));
  const detail =
    named.length > 1
      ? ` along its ${named.length} groups: ${named.map((n) => `(${n})`).join(" ")}`
      : " along its cohesion groups";
  return ["split-file", `Split the file${detail}.`];
}

function deduplicate({ file, extras, is }: Context): Advice | undefined {
  if (!is("duplication")) return undefined;
  const partner = extras.duplicates?.get(file.path);
  return ["deduplicate", partner ? `Deduplicate with \`${partner}\`.` : "Deduplicate the copied code."];
}

function removeShortcuts({ file, is }: Context): Advice | undefined {
  if (!is("shortcuts")) return undefined;
  const v = file.values;
  const kinds = Object.entries(SHORTCUT_NAMES)
    .filter(([kind]) => (v[`escape_${kind}`] ?? 0) > 0)
    .map(([kind, name]) => `${v[`escape_${kind}`]} ${name}`);
  return ["remove-shortcuts", `Remove shortcuts${kinds.length ? `: ${kinds.join(", ")}` : ""}.`];
}

const SECURITY_KINDS: Record<string, string> = {
  dynamic_code: "dynamic code",
  command_exec: "command execution",
  unsafe_deserialization: "unsafe deserialization",
  unsafe_function: "unsafe library functions",
  unsafe_html: "unsafe HTML",
  hardcoded_secret: "hard-coded secrets",
  tls_disabled: "disabled TLS checks",
  sql_concat: "SQL built by concatenation",
};

/** Looking at the security signals, by kind, and a word when the file is on a sensitive path. */
function reviewSecurity({ file, is }: Context): Advice | undefined {
  if (!is("security")) return undefined;
  const v = file.values;
  const kinds = Object.entries(SECURITY_KINDS)
    .filter(([kind]) => (v[`security_${kind}`] ?? 0) > 0)
    .map(([kind, name]) => `${v[`security_${kind}`]} ${name}`);
  const sensitive = v.sensitive_path === 1 ? " The path suggests sensitive code: look at it first." : "";
  return [
    "review-security",
    `Review the security signals${kinds.length ? `: ${kinds.join(", ")}` : ""}.${sensitive}`,
  ];
}

/** The advice for a dimension that is exceeded, worded from the file's numbers. */
function simple(dimension: string, type: ActionType, text: (v: Record<string, number>) => string) {
  return ({ file, is }: Context): Advice | undefined =>
    is(dimension) ? [type, text(file.values)] : undefined;
}

/** In the order they are given: the first advice of each type is the one kept. */
const RULES: Array<(c: Context) => Advice | undefined> = [
  splitByCohesion,
  simple(
    "complexity",
    "extract-functions",
    (v) => `Extract functions from the most complex one (complexity ${v.max_function_complexity}).`,
  ),
  simple(
    "nesting",
    "flatten-nesting",
    (v) => `Flatten nesting (deepest level ${v.max_nesting_level}) with early returns or extracted helpers.`,
  ),
  deduplicate,
  simple("coupling", "reduce-imports", (v) => `Reduce imports (${v.imports_out} internal modules).`),
  removeShortcuts,
  reviewSecurity,
  simple(
    "fixes",
    "add-tests",
    (v) => `Add tests before the next change (${v.fix_commits_recent} recent fixes).`,
  ),
  ({ file }) =>
    (file.values.issues_recent ?? 0) >= 3
      ? ["separate-concerns", `Separate what ${file.values.issues_recent} recent issues keep colliding on.`]
      : undefined,
  simple("size", "split-file", (v) => `Split the file (${v.rloc} real lines).`),
];

export function actionsFor(
  file: HealthFile,
  exceeded: Hotspot["exceeded"],
  extras: HealthExtras,
): HotspotAction[] {
  const context: Context = { file, extras, is: (d) => exceeded.some((e) => e.dimension === d) };
  const out: HotspotAction[] = [];
  for (const rule of RULES) {
    const advice = rule(context);
    if (advice && !out.some((a) => a.type === advice[0])) out.push({ type: advice[0], text: advice[1] });
  }
  if (out.length === 0)
    out.push({
      type: "extract-functions",
      text: "Simplify the most complex functions before the next change.",
    });
  return out;
}
