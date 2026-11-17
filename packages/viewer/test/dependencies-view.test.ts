import type { DependencyAudit } from "@factory-city/schema";
import { expect, it } from "vitest";
import { createFormat } from "../src/lib/format";
import { dependenciesView } from "../src/view/dependencies";

const fmt = createFormat(["en-US"]);

const audit = (over: Partial<DependencyAudit> = {}): DependencyAudit => ({
  kind: "dependencies",
  schemaVersion: 1,
  analyzerVersion: "test",
  checkedAt: "2026-11-17T09:30:00.000Z",
  lockfile: "pnpm-lock.yaml",
  ecosystem: "npm",
  database: "osv.dev",
  packages: 1204,
  counts: { critical: 0, high: 1, moderate: 2, low: 0, unknown: 0 },
  affected: [
    { name: "lodash", version: "4.17.15", advisories: [{ id: "GHSA-1", severity: "high" }] },
    {
      name: "qs",
      version: "6.7.0",
      advisories: [
        { id: "GHSA-2", severity: "moderate" },
        { id: "GHSA-3", severity: "moderate" },
      ],
    },
  ],
  ...over,
});

it("dependencies view > states the date, the lockfile and how many versions were checked", () => {
  const view = dependenciesView(audit(), fmt);
  expect(view.checked).toContain("Checked");
  expect(view.checked).toContain("osv.dev");
  expect(view.checked).toContain("pnpm-lock.yaml");
  expect(view.checked).toContain("1,204 package versions");
});

it("dependencies view > lists only the severities that have advisories, and the packages with their ids", () => {
  const view = dependenciesView(audit(), fmt);
  expect(view.counts.map((c) => `${c.value} ${c.label}`)).toEqual(["1 high", "2 moderate"]);
  expect(view.affected[0]).toEqual({ label: "lodash 4.17.15", advisories: "GHSA-1 (high)" });
  expect(view.clean).toBe(false);
  expect(view.more).toBe(0);
});

it("dependencies view > folds the packages beyond the first eight into a count", () => {
  const many = Array.from({ length: 11 }, (_, i) => ({
    name: `p${i}`,
    version: "1.0.0",
    advisories: [{ id: `GHSA-${i}`, severity: "low" as const }],
  }));
  const view = dependenciesView(audit({ affected: many }), fmt);
  expect(view.affected).toHaveLength(8);
  expect(view.more).toBe(3);
});

it("dependencies view > a clean audit says so", () => {
  const view = dependenciesView(
    audit({ affected: [], counts: { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 } }),
    fmt,
  );
  expect(view.clean).toBe(true);
  expect(view.counts).toEqual([]);
});
