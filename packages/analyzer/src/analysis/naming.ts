import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import type { AnalysisManifest } from "@factory-city/schema";
import { bump } from "../select.js";

/** One human-readable line about what was analyzed and what was left out. */
export function summaryLine(manifest: AnalysisManifest): string {
  const labels: Record<string, string> = {
    not_source_code: "not source code",
    dependency_or_build_folder: "dependency or build folders",
    non_engineering_folder: "non-engineering folders (assets, docs...)",
    generated_or_vendored: "generated or vendored files",
    excluded_by_pattern: "excluded by pattern",
    gitignored: "ignored by .gitignore",
    "gitignored-file": "ignored by .gitignore",
  };
  const parts: string[] = [];
  const merged: Record<string, number> = {};
  for (const [reason, n] of Object.entries(manifest.ignored.files)) bump(merged, reason, n);
  for (const [reason, n] of Object.entries(manifest.ignored.folders)) bump(merged, reason, n);
  for (const [reason, n] of Object.entries(merged)) parts.push(`${n} ${labels[reason] ?? reason}`);
  const left = parts.length ? ` Left out: ${parts.join(", ")}. Use --all to include everything.` : "";
  return `Analyzed ${manifest.analyzed} file${manifest.analyzed === 1 ? "" : "s"}.${left}`;
}

export function slugFor(folder: string): string {
  const abs = resolve(folder);
  const name =
    basename(abs)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  return `${name}-${createHash("sha1").update(abs).digest("hex").slice(0, 6)}`;
}
