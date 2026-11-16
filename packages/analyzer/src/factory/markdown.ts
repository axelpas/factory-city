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

type Defs = Array<[string, KpiDefinition]>;

/** The table of KPIs of a period, with the previous period beside it when there is one. */
function kpiTable(period: FactoryPeriod, defs: Defs): string[] {
  const out = [
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
  return out;
}

type Group = FactoryPeriod["groups"][string];

/** One comparison by group: a table, or the reason there is none. */
function groupSection(name: string, group: Group, defs: Defs): string[] {
  const values = Object.keys(group);
  const out = ["", `### By ${name}`, ""];
  // no comparison under 10 issues per group: a small group shows its size, not its values
  if (!values.some((v) => group[v]?.comparable)) {
    out.push(
      `No group has 10 issues yet (${values.map((v) => `${v}: ${group[v]?.issues}`).join(", ")}): too few to compare.`,
    );
    return out;
  }
  const cell = (v: string, id: string, def: KpiDefinition) =>
    group[v]?.comparable ? show(group[v]?.kpis[id], def) : "too few issues";
  out.push(
    `| KPI | ${values.map((v) => `${v} (${group[v]?.issues} issues)`).join(" | ")} |`,
    `|---|${values.map(() => "---").join("|")}|`,
  );
  for (const [id, def] of defs) {
    if (values.every((v) => !group[v]?.comparable || group[v]?.kpis[id]?.value === undefined)) continue;
    out.push(`| ${def.label} | ${values.map((v) => cell(v, id, def)).join(" | ")} |`);
  }
  return out;
}

function groupSections(period: FactoryPeriod, by: string | undefined, defs: Defs): string[] {
  const names = by ? [by] : Object.keys(period.groups).filter((g) => g === "agent" || g === "model");
  return names.flatMap((name) => {
    const group = period.groups[name];
    if (group) return groupSection(name, group, defs);
    return by ? ["", `### By ${by}`, "", `No issue of this period has a known ${by}.`] : [];
  });
}

function issueLists(factory: Factory): string[] {
  const lists = Object.entries(factory.lists).filter(([, lines]) => lines.length > 0);
  const out = lists.length ? ["", "### Issues to look at"] : [];
  for (const [id, lines] of lists) {
    out.push("", `**${LIST_TITLES[id] ?? id}**`, "");
    for (const l of lines) out.push(`- ${l.url ? `[${l.label}](${l.url})` : l.label}: ${l.value}`);
  }
  return out;
}

/** The Factory section of the report: KPIs with their sample size, groups side by side, and issue lists. */
export function factoryMarkdown(factory: Factory, options: FactoryMarkdownOptions = {}): string {
  const period = factory.periods.find((p) => p.id === (options.period ?? "last30")) ?? factory.periods[0];
  if (!period) return "";
  const level = Math.max(factory.dataLevel, 1);
  const defs = Object.entries(factory.definitions).filter(([, d]) => d.level <= level);
  const hidden = Object.values(factory.definitions).filter((d) => d.level > level).length;
  const out = [
    "## Factory",
    "",
    factory.notice,
    "",
    `### ${period.label}: ${period.issues} issue${period.issues === 1 ? "" : "s"}`,
    "",
    ...kpiTable(period, defs),
    ...(hidden > 0
      ? ["", `${hidden} more KPIs need a higher data level (GitHub data, or a facts file).`]
      : []),
    ...groupSections(period, options.by, defs),
    ...issueLists(factory),
  ];
  return `${out.join("\n")}\n`;
}
