import type { Factory, FactoryPeriod, Kpi, KpiDefinition } from "@factory-city/schema";

function show(kpi: Kpi | undefined, def: KpiDefinition): string {
  if (!kpi || kpi.value === undefined) return "n/a";
  if (def.unit === "ratio") return `${Math.round(kpi.value * 100)}%`;
  return String(Math.round(kpi.value * 100) / 100);
}

const LIST_TITLES: Record<string, string> = {
  worst_quality_delta: "Worst quality delta (points lost)",
  widest_scope_gap: "Widest scope gap (lines touched)",
  most_ci_attempts: "Most CI attempts",
  highest_rework_after: "Highest rework afterwards (share of added lines)",
  most_caused_fixes: "Most caused fixes",
};

export interface FactoryMarkdownOptions {
  /** `last30` or `all`. */
  period?: FactoryPeriod["id"];
  /** `agent`, `model`, `kind`, `estimate`, or `tag:<name>`. */
  by?: string;
}

/** The Factory section of the report: KPIs with their sample size, groups side by side, and issue lists. */
export function factoryMarkdown(factory: Factory, options: FactoryMarkdownOptions = {}): string {
  const period = factory.periods.find((p) => p.id === (options.period ?? "last30")) ?? factory.periods[0];
  if (!period) return "";
  const defs = Object.entries(factory.definitions).filter(
    ([, d]) => d.level <= Math.max(factory.dataLevel, 1),
  );
  const out: string[] = [
    "## Factory",
    "",
    factory.notice,
    "",
    `### ${period.label}: ${period.issues} issue${period.issues === 1 ? "" : "s"}`,
    "",
    `| KPI | Value | Sample | ${period.previous ? "Previous period | " : ""}Definition |`,
    `|---|---|---|${period.previous ? "---|" : ""}---|`,
  ];
  for (const [id, def] of defs) {
    const k = period.overall[id];
    const value = k?.value === undefined ? `n/a (${k?.reason ?? "unavailable"})` : show(k, def);
    const previous = period.previous ? `${show(period.previous[id], def)} | ` : "";
    out.push(
      `| ${def.label}${def.experimental ? " (experimental)" : ""} | ${value} | ${k?.n ?? 0} | ${previous}${def.definition} |`,
    );
  }
  const hidden = Object.values(factory.definitions).filter(
    (d) => d.level > Math.max(factory.dataLevel, 1),
  ).length;
  if (hidden > 0)
    out.push("", `${hidden} more KPIs need a higher data level (GitHub data, or a facts file).`);

  const by = options.by;
  const names = by ? [by] : Object.keys(period.groups).filter((g) => g === "agent" || g === "model");
  for (const name of names) {
    const group = period.groups[name];
    if (!group) {
      if (by) out.push("", `### By ${by}`, "", `No issue of this period has a known ${by}.`);
      continue;
    }
    const values = Object.keys(group);
    out.push(
      "",
      `### By ${name}`,
      "",
      `| KPI | ${values.map((v) => `${v} (${group[v]?.issues} issues)`).join(" | ")} |`,
      `|---|${values.map(() => "---").join("|")}|`,
    );
    for (const [id, def] of defs) {
      if (values.every((v) => group[v]?.kpis[id]?.value === undefined)) continue;
      out.push(`| ${def.label} | ${values.map((v) => show(group[v]?.kpis[id], def)).join(" | ")} |`);
    }
    if (values.some((v) => !group[v]?.comparable)) {
      out.push("", "Groups under 10 issues are too small to compare: read their values as indications only.");
    }
  }

  const lists = Object.entries(factory.lists).filter(([, lines]) => lines.length > 0);
  if (lists.length) out.push("", "### Issues to look at");
  for (const [id, lines] of lists) {
    out.push("", `**${LIST_TITLES[id] ?? id}**`, "");
    for (const l of lines) out.push(`- ${l.url ? `[${l.label}](${l.url})` : l.label}: ${l.value}`);
  }
  return `${out.join("\n")}\n`;
}
