import type { AdvisorySeverity, DependencyAudit } from "@factory-city/schema";
import type { Formatter } from "../lib/format";

const SEVERITIES: ReadonlyArray<[AdvisorySeverity, string]> = [
  ["critical", "critical"],
  ["high", "high"],
  ["moderate", "moderate"],
  ["low", "low"],
  ["unknown", "no severity given"],
];

/** The most affected packages shown before the rest is folded into a count. */
const SHOWN = 8;

export interface DependenciesView {
  /** "Checked 17.11.2026 against osv.dev, from pnpm-lock.yaml: 1 204 package versions." */
  checked: string;
  /** Advisories by severity, only the severities that have some. */
  counts: Array<{ severity: AdvisorySeverity; label: string; value: string }>;
  /** True when no package version has a known vulnerability. */
  clean: boolean;
  affected: Array<{ label: string; advisories: string }>;
  /** Affected package versions that are not listed. */
  more: number;
}

/** What the Dependencies block shows: the date, the counts and the most serious packages. */
export function dependenciesView(audit: DependencyAudit, fmt: Formatter): DependenciesView {
  return {
    checked: `Checked ${fmt.date(audit.checkedAt)} against ${audit.database}, from ${audit.lockfile}: ${fmt.integer(audit.packages)} package version${audit.packages === 1 ? "" : "s"}.`,
    counts: SEVERITIES.filter(([s]) => audit.counts[s] > 0).map(([severity, label]) => ({
      severity,
      label,
      value: fmt.integer(audit.counts[severity]),
    })),
    clean: audit.affected.length === 0,
    affected: audit.affected.slice(0, SHOWN).map((p) => ({
      label: `${p.name} ${p.version}`,
      advisories: p.advisories.map((a) => `${a.id} (${a.severity})`).join(", "),
    })),
    more: Math.max(0, audit.affected.length - SHOWN),
  };
}
