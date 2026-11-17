export type AdvisorySeverity = "critical" | "high" | "moderate" | "low" | "unknown";

/** One known vulnerability of a dependency, by the id of its advisory. */
export interface Advisory {
  id: string;
  /** As the advisory database gives it; `unknown` when it gives none. */
  severity: AdvisorySeverity;
}

/** A package version of the lockfile that has at least one known vulnerability. */
export interface AffectedPackage {
  name: string;
  version: string;
  advisories: Advisory[];
}

/**
 * Known vulnerabilities of the dependencies of a project, from its lockfile and an advisory database. It is
 * per project, not per file, and is written by `analyze --with audit` into `dependencies.json`.
 */
export interface DependencyAudit {
  kind: "dependencies";
  schemaVersion: 1;
  analyzerVersion: string;
  /** When the database was asked (UTC): the answer changes as advisories are published. */
  checkedAt: string;
  /** The lockfile that was read, relative to the analyzed folder. */
  lockfile: string;
  ecosystem: "npm";
  /** The database asked. */
  database: "osv.dev";
  /** Distinct package versions that were sent. */
  packages: number;
  /** Advisories by severity, each counted once per affected package version. */
  counts: Record<AdvisorySeverity, number>;
  /** Affected package versions, most serious first. */
  affected: AffectedPackage[];
}
