import type { ExternalFindings } from "@factory-city/schema";
import { attachSarif, readSarif } from "../collectors/sarif.js";
import type { AnalyzeOptions, FileValues } from "./types.js";

/**
 * Adds the results of the SARIF files given with `--sarif` as metrics of the files they point at. Nothing is
 * run: the file is data. Results that cannot be attached are counted in the manifest, never dropped silently.
 */
export async function addScannerFindings(
  opts: AnalyzeOptions,
  attributesByPath: FileValues,
  warnings: string[],
): Promise<{ external: ExternalFindings[]; rated: boolean }> {
  const files = opts.sarif ?? [];
  if (files.length === 0) return { external: [], rated: false };
  const runs = (await Promise.all(files.map((file) => readSarif(file)))).flat();
  const analyzed = new Map([...attributesByPath].map(([path, v]) => [path, { isTest: v.is_test === 1 }]));
  const { perFile, external } = attachSarif(runs, opts.folder, analyzed, opts.path);
  for (const [path, v] of perFile) {
    const values = attributesByPath.get(path);
    if (values) Object.assign(values, { sarif_findings: v.findings, sarif_error_findings: v.errors });
  }
  for (const e of external) {
    const apart = e.apart.noLocation + e.apart.outside + e.apart.notAnalyzed + e.apart.tests;
    if (apart > 0)
      warnings.push(
        `${e.tool}: ${apart} of ${e.results} result(s) are not attached to an analyzed file (${e.apart.noLocation} without location, ${e.apart.outside} outside the folder, ${e.apart.notAnalyzed} on files not analyzed, ${e.apart.tests} on test files).`,
      );
  }
  return { external, rated: perFile.size > 0 };
}
