import type { Frame } from "@factory-city/schema";
import type { Formatter } from "../lib/format";
import type { CardRow } from "./card";

const KIND_NAMES: Record<string, string> = {
  feature: "feature",
  fix: "fix",
  refactor: "refactor",
  chore: "chore",
  docs: "docs",
  test: "test",
  unknown: "unknown kind",
};

type Metrics = Frame["metrics"];
type RowOf = (m: Metrics, fmt: Formatter) => CardRow | undefined;

const signed = (d: number, fmt: Formatter) =>
  d === 0 ? "unchanged" : `${d > 0 ? "+" : "−"}${fmt.number(Math.abs(d), 1)}`;

const scopeRow: RowOf = (m, fmt) => {
  const scope = `${fmt.integer(m.files_touched)} file${m.files_touched === 1 ? "" : "s"}, ${fmt.integer(m.lines_added + m.lines_deleted)} lines`;
  return {
    label: m.estimate ? `Estimate ${m.estimate}, actual scope` : "Scope",
    value: m.scope_gap ? `${scope} (well beyond)` : scope,
  };
};

const outcomeRow: RowOf = (m, fmt) => {
  if (!m.outcome) return undefined;
  const after = m.attempts && m.attempts > 1 ? ` after ${fmt.integer(m.attempts)} attempts` : "";
  return { label: "Outcome", value: `${m.outcome}${after}` };
};

const reworkRow: RowOf = (m, fmt) => {
  if (m.rework_after !== undefined)
    return { label: "Rework afterwards", value: fmt.percent(m.rework_after), note: "retrospective" };
  return m.rework_after_pending
    ? { label: "Rework afterwards", value: "n/a", note: "Pending: needs 14 days of later history." }
    : undefined;
};

/** One row per fact the frame has, in the order they are shown. */
const FRAME_ROWS: readonly RowOf[] = [
  scopeRow,
  (m, fmt) =>
    m.quality_delta === undefined ? undefined : { label: "Score", value: signed(m.quality_delta, fmt) },
  (m) =>
    m.agent || m.model
      ? { label: "Agent, model", value: [m.agent, m.model].filter(Boolean).join(", ") }
      : undefined,
  outcomeRow,
  (m, fmt) =>
    m.ci_attempts === undefined ? undefined : { label: "CI attempts", value: fmt.integer(m.ci_attempts) },
  (m, fmt) =>
    m.cycle_time_hours === undefined
      ? undefined
      : { label: "Cycle time", value: `${fmt.number(m.cycle_time_hours, 1)} h` },
  (m, fmt) =>
    m.cost === undefined
      ? undefined
      : { label: "Cost", value: `${fmt.number(m.cost)}${m.currency ? ` ${m.currency}` : ""}` },
  reworkRow,
  (m, fmt) =>
    m.caused_fixes
      ? { label: "Fixes caused", value: fmt.integer(m.caused_fixes), note: "experimental, retrospective" }
      : undefined,
];

/** The card of a frame on the timeline bar: issue, kind, estimate against actual scope, quality, agent, CI, cost. */
export function frameCardRows(frame: Frame, fmt: Formatter): CardRow[] {
  const rows = FRAME_ROWS.map((row) => row(frame.metrics, fmt)).filter((r) => r !== undefined);
  return [{ label: "Kind", value: KIND_NAMES[frame.kind] ?? frame.kind }, ...rows];
}
