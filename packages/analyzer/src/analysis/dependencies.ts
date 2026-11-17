import type { AdvisorySeverity, AffectedPackage, DependencyAudit } from "@factory-city/schema";
import { LOCKFILES, type LockfileKind, parseLockfile } from "../collectors/lockfile.js";
import { queryOsv } from "../collectors/osv.js";
import type { SourceEntry } from "../source/types.js";
import { ANALYZER_VERSION } from "./constants.js";
import type { AnalyzeOptions } from "./types.js";

const ORDER: AdvisorySeverity[] = ["critical", "high", "moderate", "low", "unknown"];

/** Refuses the audit before anything is done when the network is forbidden. */
export function checkAuditAllowed(opts: AnalyzeOptions): void {
  if (opts.audit && opts.offline)
    throw new Error(
      "--with audit needs the network (it sends package names and versions to api.osv.dev), and --offline forbids it. Remove one of them.",
    );
}

function summarize(affected: AffectedPackage[]): Record<AdvisorySeverity, number> {
  const counts: Record<AdvisorySeverity, number> = { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 };
  for (const p of affected) for (const a of p.advisories) counts[a.severity]++;
  return counts;
}

const rank = (p: AffectedPackage) => Math.min(...p.advisories.map((a) => ORDER.indexOf(a.severity)));

/**
 * `--with audit`: reads the lockfile at the root of the analyzed folder and asks OSV for the known
 * vulnerabilities of its package versions. Says what it sends before it sends it. A missing lockfile or a
 * failed request is a warning, never a failure of the analysis: nothing is written then.
 */
export async function auditDependencies(
  opts: AnalyzeOptions,
  entries: readonly SourceEntry[],
  read: (entry: SourceEntry) => Promise<Buffer>,
  warnings: string[],
): Promise<DependencyAudit | undefined> {
  if (!opts.audit) return undefined;
  const found = LOCKFILES.map((name) => ({ name, entry: entries.find((e) => e.path === name) })).find(
    (l) => l.entry,
  ) as { name: LockfileKind; entry: SourceEntry } | undefined;
  if (!found) {
    warnings.push(
      `Dependency audit skipped: no ${LOCKFILES.join(", ")} at the root of the analyzed folder. Nothing was sent.`,
    );
    return undefined;
  }
  try {
    const packages = parseLockfile(found.name, (await read(found.entry)).toString("utf8"));
    (opts.log ?? ((line) => process.stderr.write(`${line}\n`)))(
      `Dependency audit: sending ${packages.length} package names and versions from ${found.name} to api.osv.dev (nothing else leaves this machine).`,
    );
    const advisories = await queryOsv(packages, opts.auditFetch);
    const affected: AffectedPackage[] = [...advisories]
      .map(([spec, list]) => {
        const at = spec.lastIndexOf("@");
        return { name: spec.slice(0, at), version: spec.slice(at + 1), advisories: list };
      })
      .sort((a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : 1));
    return {
      kind: "dependencies",
      schemaVersion: 1,
      analyzerVersion: ANALYZER_VERSION,
      checkedAt: new Date().toISOString(),
      lockfile: found.name,
      ecosystem: "npm",
      database: "osv.dev",
      packages: packages.length,
      counts: summarize(affected),
      affected,
    };
  } catch (err) {
    warnings.push(
      `Dependency audit failed (${err instanceof Error ? err.message : String(err)}): no dependencies.json was written.`,
    );
    return undefined;
  }
}
