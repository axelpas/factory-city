import type { Hotspot, Report, RiskDimension, RiskLevel } from "@factory-city/schema";

const LEVEL_NAMES: Record<RiskLevel, string> = {
  low: "low",
  moderate: "moderate",
  high: "high",
  veryHigh: "very high",
};
const pct = (share: number) => `${Math.round(share * 100)}%`;

const METRIC_LABELS: Record<string, string> = {
  rloc: "real lines",
  mcc: "complexity",
  max_function_complexity: "worst function complexity",
  max_nesting_level: "deepest nesting",
  imports_out: "modules imported",
  cohesion_groups: "cohesion groups",
  escape_hatches: "silenced checks",
  recent_commits: "recent commits",
  fix_commits_recent: "recent fixes",
  rework_ratio: "rework ratio",
  issues_recent: "recent issues",
};

function bounds(d: RiskDimension): string {
  const [a, b, c] = d.bounds;
  return `low up to ${a}, moderate up to ${b}, high up to ${c}`;
}

function hotspotBlock(h: Hotspot, dimensions: readonly RiskDimension[]): string {
  const label = (id: string) => dimensions.find((d) => d.id === id)?.label.toLowerCase() ?? id;
  const metrics = Object.entries(h.metrics)
    .map(([id, value]) => `${METRIC_LABELS[id] ?? id} ${Math.round(value * 100) / 100}`)
    .join(", ");
  const exceeded = h.exceeded.length
    ? h.exceeded
        .map((e) => `${label(e.dimension)} is ${LEVEL_NAMES[e.level]} (${e.value}, bound ${e.bound})`)
        .join("; ")
    : "no threshold exceeded: it ranks by complexity and activity";
  const first = h.actions[0];
  const lines = [
    `### ${h.rank}. ${h.path}`,
    "",
    `**Title:** ${first ? first.text.replace(/\.$/, "") : "Simplify"} in \`${h.path}\``,
    "",
    "**Context**",
    `${h.basis === "complexity-and-change" ? "Complex code that changes often." : "Complex and large code."} ${exceeded}.`,
    `Metrics: ${metrics}.`,
    "",
    "**To do**",
    ...h.actions.map((a) => `- ${a.text}`),
    "",
    "**Acceptance criteria**",
    ...(h.exceeded.length
      ? h.exceeded.map((e) => `- [ ] ${label(e.dimension)} of \`${h.path}\` is at most ${e.bound}`)
      : [`- [ ] \`${h.path}\` leaves the top hotspots`]),
    "- [ ] behavior is unchanged and tests pass",
    "",
    `**Size:** ${h.size}`,
  ];
  return lines.join("\n");
}

/** The report as Markdown, with one issue-ready block per hotspot. */
export function reportMarkdown(report: Report, top = 5): string {
  const { health, dimensions } = report;
  const out: string[] = [
    `# Code health: ${report.project}`,
    "",
    `Snapshot ${report.commit ?? "of the files on disk"}, data level ${report.dataLevel}.`,
    "",
    `## Score: ${health.score} out of 100`,
    "",
    report.notice,
    `Dimensions used: ${health.scored.map((id) => dimensions.find((d) => d.id === id)?.label ?? id).join(", ") || "none"}.`,
    "",
    "## Risk profile",
    "",
    "Share of code, by real lines, at each risk level.",
    "",
    "| Dimension | Low | Moderate | High | Very high | Rated code |",
    "|---|---|---|---|---|---|",
  ];
  for (const d of dimensions) {
    const share = health.profile[d.id];
    if (!share) continue;
    out.push(
      `| ${d.label} | ${pct(share.low)} | ${pct(share.moderate)} | ${pct(share.high)} | ${pct(share.veryHigh)} | ${pct(share.rated)} |`,
    );
  }
  const missing = dimensions.filter((d) => !health.profile[d.id]);
  if (missing.length)
    out.push(
      "",
      `Unavailable at this data level or for this code: ${missing.map((d) => d.label).join(", ")}.`,
    );
  out.push("", "## Thresholds", "");
  for (const d of dimensions) {
    out.push(
      `- **${d.label}** (\`${d.metric}\`${d.minRloc ? `, files of at least ${d.minRloc} real lines` : ""}): ${bounds(d)}. Source: ${d.source}.`,
    );
  }
  out.push("", `## Hotspots (top ${Math.min(top, report.hotspots.length)})`, "");
  if (report.hotspots.length === 0) out.push("No hotspot: no source file with measured complexity.");
  for (const h of report.hotspots.slice(0, top)) out.push(hotspotBlock(h, dimensions), "");
  if (report.hiddenLinks.length) {
    out.push("## Hidden links (experimental)", "");
    for (const link of report.hiddenLinks)
      out.push(`- ${link.files.map((f) => `\`${f}\``).join(" and ")}: ${link.detail}`);
    out.push("");
  }
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}
