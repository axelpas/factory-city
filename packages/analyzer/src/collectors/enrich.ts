import type { Fact, Facts, Frame } from "@factory-city/schema";
import { ciAttempts, estimateOf, hoursBetween, type Scope, scopeGap } from "./delivery.js";
import type { ForgeData } from "./issues.js";

export interface EnrichOptions {
  forge?: ForgeData;
  facts?: Facts;
  estimatePatterns?: readonly string[];
}

function factFor(frame: Frame, facts: Facts | undefined): Fact | undefined {
  if (!facts) return undefined;
  const number = frame.issue?.number;
  return facts.facts.find(
    (f) =>
      (number !== undefined && f.issue === number) ||
      (f.commit !== undefined && frame.commit.startsWith(f.commit)),
  );
}

/** Level 3: what only the facts file knows. */
function addFacts(m: Frame["metrics"], fact: Fact): void {
  if (fact.agent) m.agent = fact.agent;
  if (fact.model) m.model = fact.model;
  if (fact.outcome) m.outcome = fact.outcome;
  if (fact.attempts > 0) {
    m.attempts = fact.attempts;
    m.succeeded_attempts = fact.succeeded_attempts;
  }
  if (fact.review_blockers !== undefined) m.review_blockers = fact.review_blockers;
  if (fact.review_majors !== undefined) m.review_majors = fact.review_majors;
  if (fact.rework_rounds !== undefined) m.rework_rounds = fact.rework_rounds;
  if (fact.minutes !== undefined) m.agent_minutes = fact.minutes;
  if (fact.cost !== undefined) m.cost = fact.cost;
  if (fact.currency) m.currency = fact.currency;
  if (fact.human_interventions !== undefined) m.human_interventions = fact.human_interventions;
  if (Object.keys(fact.tags).length > 0) m.tags = fact.tags;
}

/** Level 2: cycle time and CI, from the issue and its pull request. */
function addForge(m: Frame["metrics"], issue: NonNullable<Frame["issue"]>, forge: ForgeData): void {
  const known = forge.issues.get(issue.number);
  const pull = issue.pullRequest !== undefined ? forge.pulls.get(issue.pullRequest) : undefined;
  const cycle =
    hoursBetween(known?.createdAt, known?.closedAt) ?? hoursBetween(pull?.createdAt, pull?.mergedAt);
  if (cycle !== undefined) m.cycle_time_hours = cycle;
  const ci = pull && forge.runs ? ciAttempts(forge.runs, pull.branch) : undefined;
  if (ci) {
    m.ci_attempts = ci.attempts;
    m.first_pass_green = ci.firstPassGreen;
  }
}

/**
 * Adds what the forge (level 2) and the facts file (level 3) know to the frames of a timeline, in place.
 * A field that neither source provides stays absent: unavailable, never zero.
 */
export function enrichFrames(frames: Frame[], options: EnrichOptions): void {
  const { forge, facts } = options;
  const earlier: Scope[] = [];
  for (const frame of frames) {
    const m = frame.metrics;
    const issue = frame.issue;
    const fact = factFor(frame, facts);
    if (fact) addFacts(m, fact);
    const estimate = estimateOf(issue?.labels ?? [], options.estimatePatterns) ?? fact?.estimate;
    if (estimate) m.estimate = estimate;
    if (!issue) continue;
    if (forge) addForge(m, issue, forge);
    // scope gap: against earlier issues with the same estimate
    const scope: Scope = { estimate, files: m.files_touched, lines: m.lines_added + m.lines_deleted };
    const gap = scopeGap(scope, earlier);
    if (gap !== undefined) m.scope_gap = gap;
    earlier.push(scope);
  }
}

/**
 * Splits the cost of a frame over the files it changed, in proportion to the lines changed in each, and adds
 * it to a running total per file. Returns the frame's share per file. Experimental.
 */
export function addCostShares(
  total: Map<string, number>,
  lines: Record<string, [number, number]>,
  cost: number | undefined,
): void {
  if (cost === undefined || cost <= 0) return;
  const changed = Object.entries(lines).map(([path, [added, deleted]]) => [path, added + deleted] as const);
  const sum = changed.reduce((n, [, c]) => n + c, 0);
  if (sum === 0) return;
  for (const [path, c] of changed) total.set(path, (total.get(path) ?? 0) + (cost * c) / sum);
}
