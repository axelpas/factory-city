import type { FactsMapping } from "../src/config.js";

/**
 * Synthetic file with the shape of a routing log: semicolon-separated, one row per attempt or review,
 * the issue written `#42`, the estimate carried by the `type` column. Every value is made up.
 */

export const HEADER = "date;project;issue;type;agent;model;result;blockers;majors;rework;minutes";

export const ROWS = [
  "2026-01-05;demo;#1;issue-S;agent-a;model-x;succeeded;0;0;0;12",
  "2026-01-06;demo;#1;review;reviewer;model-y;succeeded;1;2;0;4",
  "2026-01-07;demo;#2;issue-M;agent-a;model-x;failed;0;0;0;30",
  "2026-01-08;demo;#2;issue-M;agent-b;model-z;succeeded;0;0;2;45",
  "2026-01-08;demo;#2;review;reviewer;model-y;succeeded;0;1;0;6",
  "2026-01-09;other;#7;issue-L;agent-a;model-x;succeeded;0;0;0;99",
  "2026-01-10;demo;#3;issue-L;agent-b;model-z;abandoned;0;0;1;80",
  "2026-01-11;demo;;issue-S;agent-b;model-z;succeeded;0;0;0;5",
];

export const MAPPING: FactsMapping = {
  delimiter: ";",
  columns: {
    date: "date",
    issue: "issue",
    agent: "agent",
    model: "model",
    outcome: "result",
    estimate: "type",
    review_blockers: "blockers",
    review_majors: "majors",
    rework_rounds: "rework",
    minutes: "minutes",
  },
  filter: { column: "project", values: ["demo"] },
  values: { estimate: { "issue-S": "S", "issue-M": "M", "issue-L": "L" } },
  attempts: { column: "type", not: ["review"] },
};

export const NOW = new Date("2026-02-01T00:00:00Z");

export const text = (header = true) => [...(header ? [HEADER] : []), ...ROWS].join("\n");
