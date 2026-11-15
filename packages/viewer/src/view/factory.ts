import type { Factory, FactoryIssueLine, FactoryPeriod, Kpi, KpiDefinition } from "@factory-city/schema";
import type { Formatter } from "../lib/format";

export interface KpiRow {
  id: string;
  label: string;
  definition: string;
  /** Formatted value, or "n/a". */
  value: string;
  /** Sample size: every KPI shows it. */
  sample: string;
  /** Value of the previous period, when there is one. */
  previous?: string;
  /** Why the KPI is unavailable. */
  reason?: string;
  experimental: boolean;
  level: number;
}

export interface GroupTable {
  name: string;
  columns: Array<{ value: string; issues: number; comparable: boolean }>;
  rows: Array<{ label: string; cells: string[] }>;
  /** True when some group is too small to compare. */
  warn: boolean;
}

export interface FactoryView {
  available: boolean;
  reason?: string;
  notice: string;
  periods: Array<{ id: FactoryPeriod["id"]; label: string; issues: number }>;
  period?: FactoryPeriod["id"];
  kpis: KpiRow[];
  /** KPIs of higher data levels, hidden with the reason. */
  hidden?: string;
  groups: GroupTable[];
  lists: Array<{ title: string; lines: FactoryIssueLine[] }>;
}

const LIST_TITLES: Record<string, string> = {
  worst_quality_delta: "Worst quality delta (points lost)",
  widest_scope_gap: "Widest scope gap (lines touched)",
  most_ci_attempts: "Most CI attempts",
  highest_rework_after: "Highest rework afterwards",
  most_caused_fixes: "Most caused fixes (experimental)",
};

export function kpiText(kpi: Kpi | undefined, def: KpiDefinition, fmt: Formatter): string {
  if (!kpi || kpi.value === undefined) return "n/a";
  if (def.unit === "ratio") return fmt.percent(kpi.value);
  return fmt.number(kpi.value, 1);
}

/** Everything the Factory panel shows for one period. */
export function factoryView(
  factory: Factory | undefined,
  periodId: FactoryPeriod["id"] | undefined,
  fmt: Formatter,
): FactoryView {
  const empty: FactoryView = { available: false, notice: "", periods: [], kpis: [], groups: [], lists: [] };
  if (!factory) {
    return {
      ...empty,
      reason:
        "Factory KPIs come with a per-issue timeline. Run factory-city timeline --by issue, then open it here.",
    };
  }
  const period = factory.periods.find((p) => p.id === periodId) ?? factory.periods[0];
  if (!period) return { ...empty, reason: "This factory file holds no period." };
  const level = Math.max(factory.dataLevel, 1);
  const shown = Object.entries(factory.definitions).filter(([, d]) => d.level <= level);
  const hiddenCount = Object.keys(factory.definitions).length - shown.length;
  const kpis = shown.map(([id, def]): KpiRow => {
    const k = period.overall[id];
    return {
      id,
      label: def.label,
      definition: def.definition,
      value: kpiText(k, def, fmt),
      sample: `${fmt.integer(k?.n ?? 0)} issue${k?.n === 1 ? "" : "s"}`,
      ...(period.previous ? { previous: kpiText(period.previous[id], def, fmt) } : {}),
      ...(k?.value === undefined ? { reason: k?.reason ?? "unavailable" } : {}),
      experimental: def.experimental === true,
      level: def.level,
    };
  });
  const groups: GroupTable[] = [];
  for (const [name, group] of Object.entries(period.groups)) {
    if (name === "kind" || name === "estimate") continue;
    const values = Object.keys(group);
    // no comparison under 10 issues per group: a small group shows its size, not its values
    const comparable = (v: string) => group[v]?.comparable === true;
    const rows = values.some(comparable)
      ? shown
          .filter(([id]) => values.some((v) => comparable(v) && group[v]?.kpis[id]?.value !== undefined))
          .map(([id, def]) => ({
            label: def.label,
            cells: values.map((v) => (comparable(v) ? kpiText(group[v]?.kpis[id], def, fmt) : "too few")),
          }))
      : [];
    groups.push({
      name,
      columns: values.map((v) => ({ value: v, issues: group[v]?.issues ?? 0, comparable: comparable(v) })),
      rows,
      warn: values.some((v) => !comparable(v)),
    });
  }
  return {
    available: true,
    notice: factory.notice,
    periods: factory.periods.map((p) => ({ id: p.id, label: p.label, issues: p.issues })),
    period: period.id,
    kpis,
    ...(hiddenCount > 0
      ? {
          hidden: `${fmt.integer(hiddenCount)} more KPIs need a higher data level: GitHub data through gh, or a facts file.`,
        }
      : {}),
    groups,
    lists: Object.entries(factory.lists)
      .filter(([, lines]) => lines.length > 0)
      .map(([id, lines]) => ({ title: LIST_TITLES[id] ?? id, lines })),
  };
}
