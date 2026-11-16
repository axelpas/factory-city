import { type MetricDefinition, metric } from "./types.js";

/** Metrics of the registry, part 4: from `rework_ratio` to `cost_share`. */
export const METRICS_4: readonly MetricDefinition[] = [
  metric({
    id: "rework_ratio",
    higherMeans: "a larger share of fresh code thrown away",
    label: "Rework ratio",
    definition: "Share of the file's recent activity that was fresh code thrown away, from 0 to 1.",
    computation: "Reworked lines divided by the larger of reworked lines and lines added in the window.",
    why: "Shows where code is written and rewritten instead of settling.",
    unit: "ratio",
    direction: "higher-is-worse",
    kind: "ratio",
    level: 1,
    limits: "Same limits as reworked lines. 0 when nothing was reworked.",
  }),
  metric({
    id: "issues_recent",
    higherMeans: "more issues colliding",
    label: "Recent issues",
    definition: "Number of distinct issues whose commits touched the file in the recent window.",
    computation:
      "Issues linked to the first-parent steps that changed the file during the 30 days before the snapshot.",
    why: "A file many issues fight over is a point of contention and of merge conflicts.",
    unit: "issues",
    direction: "higher-is-worse",
    level: 1,
    limits:
      "Commits linked to no issue are not counted. Linking is a heuristic on messages and branch names.",
  }),
  metric({
    id: "main_agent",
    label: "Main author",
    definition: "Who wrote most of the file's current lines.",
    computation:
      "From line provenance. An author label comes from a Co-Authored-By trailer, else from the authorLabels rules of the configuration, else it is unknown.",
    why: "Shows who wrote what, whatever the mix of people and agents.",
    unit: "category",
    direction: "neutral",
    kind: "category",
    level: 1,
    limits:
      "Labels are free text and nothing assumes a human-versus-agent split. Lines brought by a merge take the label of the merged commits.",
  }),
  metric({
    id: "main_agent_share",
    higherMeans: "written mostly by one author",
    label: "Main author's share",
    definition: "Share of the file's current lines written by its main author, from 0 to 1.",
    computation: "Lines of the main author divided by the lines of the file.",
    why: "Tells a file written by one hand from a shared one.",
    unit: "ratio",
    direction: "neutral",
    kind: "ratio",
    level: 1,
    limits: "Same limits as the main author.",
  }),
  metric({
    id: "rework_after",
    higherMeans: "more of the step's code thrown away afterwards",
    label: "Rework afterwards",
    definition: "Share of the lines a step added that were deleted or rewritten within 14 days.",
    computation:
      "From line provenance, over the steps of the frame. Pending until 14 days have passed since the frame.",
    why: "Tells whether what a step delivered held.",
    unit: "ratio",
    direction: "higher-is-worse",
    kind: "ratio",
    scope: "frame",
    level: 1,
    limits: "Looks at what happened after the frame: it never changes the city drawn for that frame.",
    retrospective: true,
  }),
  metric({
    id: "caused_fixes",
    higherMeans: "more later fixes on the step's code",
    label: "Fixes caused",
    definition: "Number of later fix commits that modified or deleted lines the step introduced.",
    computation:
      "From line provenance: a fix step that removes a line points back to the step that wrote it (an SZZ-like heuristic).",
    why: "Points at steps whose code had to be repaired.",
    unit: "commits",
    direction: "higher-is-worse",
    scope: "frame",
    level: 1,
    limits:
      "A heuristic: a fix may touch a line for an unrelated reason, and a bug may sit in a line the fix did not touch.",
    experimental: true,
    retrospective: true,
  }),
  metric({
    id: "cost_share",
    higherMeans: "more money spent there",
    label: "Cost share",
    definition:
      "Cost of the issues that touched the file, split in proportion to the lines each one changed there.",
    computation:
      "For each issue with a cost in the facts file, its cost is shared among the files it changed by lines added and deleted, and summed per file up to the frame.",
    why: "Shows where the money goes.",
    unit: "cost",
    direction: "neutral",
    level: 3,
    limits:
      "Only as good as the facts file. Lines changed are a rough proxy for effort. Unavailable for files no costed issue touched.",
    experimental: true,
  }),
];
