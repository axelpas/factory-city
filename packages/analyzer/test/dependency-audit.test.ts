import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { parsePackageLock, parsePnpmLock, parseYarnLock } from "../src/collectors/lockfile.js";
import { queryOsv, severityOf } from "../src/collectors/osv.js";
import { writeAnalysis } from "../src/output.js";
import { makeTree } from "./helpers.js";

const PACKAGE_LOCK_V3 = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    "": { name: "demo", version: "1.0.0" },
    "node_modules/lodash": { version: "4.17.15" },
    "node_modules/@scope/pkg": { version: "2.0.0" },
    "node_modules/a/node_modules/lodash": { version: "4.17.21" },
    "node_modules/linked": { link: true, version: "1.0.0" },
    "node_modules/from-git": { version: "git+https://example.com/x.git" },
    "node_modules/lodash-copy": { name: "lodash", version: "4.17.15" },
  },
});

const PACKAGE_LOCK_V1 = JSON.stringify({
  lockfileVersion: 1,
  dependencies: { express: { version: "4.17.1", dependencies: { qs: { version: "6.7.0" } } } },
});

const PNPM_V9 = `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      lodash:
        specifier: ^4.17.15
        version: 4.17.15

packages:

  '@scope/pkg@2.0.0':
    resolution: {integrity: sha512-x}

  lodash@4.17.15:
    resolution: {integrity: sha512-y}

  react-dom@18.2.0(react@18.2.0):
    resolution: {integrity: sha512-z}

snapshots:

  lodash@4.17.15: {}
`;

const PNPM_V6 = `lockfileVersion: '6.0'

packages:

  /@scope/pkg@2.0.0:
    resolution: {integrity: sha512-x}
    dev: false

  /lodash@4.17.15:
    resolution: {integrity: sha512-y}
    dev: false
`;

const YARN_CLASSIC = `# yarn lockfile v1

"@scope/pkg@^2.0.0":
  version "2.0.0"
  resolved "https://registry.yarnpkg.com/x"

lodash@^4.17.0, lodash@^4.17.15:
  version "4.17.15"
  resolved "https://registry.yarnpkg.com/y"
`;

const YARN_BERRY = `__metadata:
  version: 6

"@scope/pkg@npm:^2.0.0":
  version: 2.0.0
  resolution: "@scope/pkg@npm:2.0.0"

"lodash@npm:^4.17.15":
  version: 4.17.15
  resolution: "lodash@npm:4.17.15"
`;

const LODASH = { name: "lodash", version: "4.17.15" };
const SCOPED = { name: "@scope/pkg", version: "2.0.0" };

it("lockfiles > package-lock.json version 3: names, scopes, nesting; links and git sources are left out", () => {
  expect(parsePackageLock(PACKAGE_LOCK_V3)).toEqual([SCOPED, LODASH, { name: "lodash", version: "4.17.21" }]);
});

it("lockfiles > package-lock.json version 1 nests its dependencies", () => {
  expect(parsePackageLock(PACKAGE_LOCK_V1)).toEqual([
    { name: "express", version: "4.17.1" },
    { name: "qs", version: "6.7.0" },
  ]);
});

it("lockfiles > pnpm-lock.yaml, version 9 and version 6; the peer suffix is dropped", () => {
  expect(parsePnpmLock(PNPM_V9)).toEqual([SCOPED, LODASH, { name: "react-dom", version: "18.2.0" }]);
  expect(parsePnpmLock(PNPM_V6)).toEqual([SCOPED, LODASH]);
});

it("lockfiles > yarn.lock, classic and berry", () => {
  expect(parseYarnLock(YARN_CLASSIC)).toEqual([SCOPED, LODASH]);
  expect(parseYarnLock(YARN_BERRY)).toEqual([SCOPED, LODASH]);
});

/** Recorded answers of api.osv.dev (the shape of its published API), replayed: no test touches the network. */
function osvReplay() {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const answer = (value: unknown) => ({ ok: true, status: 200, json: async () => value }) as Response;
  const fetcher = (async (url: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init?.method ?? "GET", url, body });
    if (url.endsWith("/v1/querybatch"))
      return answer({
        results: (body.queries as Array<{ package: { name: string }; version: string }>).map((q) =>
          q.package.name === "lodash" && q.version === "4.17.15"
            ? { vulns: [{ id: "GHSA-p6mc-m468-83gw" }, { id: "GHSA-35jh-r3h4-6jhm" }] }
            : q.package.name === "@scope/pkg"
              ? { vulns: [{ id: "GHSA-aaaa-bbbb-cccc" }] }
              : {},
        ),
      });
    if (url.endsWith("/v1/vulns/GHSA-p6mc-m468-83gw"))
      return answer({ id: "GHSA-p6mc-m468-83gw", database_specific: { severity: "HIGH" } });
    if (url.endsWith("/v1/vulns/GHSA-35jh-r3h4-6jhm"))
      return answer({ id: "GHSA-35jh-r3h4-6jhm", database_specific: { severity: "MODERATE" } });
    if (url.endsWith("/v1/vulns/GHSA-aaaa-bbbb-cccc")) return answer({ id: "GHSA-aaaa-bbbb-cccc" });
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

it("osv > a replayed answer gives the advisories of each package version, with their severity", async () => {
  const { fetcher, calls } = osvReplay();
  const found = await queryOsv([SCOPED, LODASH, { name: "qs", version: "6.7.0" }], fetcher);
  expect(found.get("lodash@4.17.15")).toEqual([
    { id: "GHSA-35jh-r3h4-6jhm", severity: "moderate" },
    { id: "GHSA-p6mc-m468-83gw", severity: "high" },
  ]);
  expect(found.get("@scope/pkg@2.0.0")).toEqual([{ id: "GHSA-aaaa-bbbb-cccc", severity: "unknown" }]);
  expect(found.has("qs@6.7.0")).toBe(false);
  // one batch with names and versions, then one read per distinct advisory: only api.osv.dev is asked
  expect(calls.every((c) => c.url.startsWith("https://api.osv.dev/"))).toBe(true);
  expect(calls[0]?.body).toEqual({
    queries: [
      { package: { name: "@scope/pkg", ecosystem: "npm" }, version: "2.0.0" },
      { package: { name: "lodash", ecosystem: "npm" }, version: "4.17.15" },
      { package: { name: "qs", ecosystem: "npm" }, version: "6.7.0" },
    ],
  });
  expect(calls).toHaveLength(4);
});

it("osv > reads the severity words an advisory can carry", () => {
  const of = (severity: unknown) => severityOf({ database_specific: { severity } });
  expect([of("CRITICAL"), of("High"), of("MEDIUM"), of("moderate"), of("LOW"), of("weird"), of(3)]).toEqual([
    "critical",
    "high",
    "moderate",
    "moderate",
    "low",
    "unknown",
    "unknown",
  ]);
  expect(severityOf(null)).toBe("unknown");
});

const project = () => makeTree({ "src/a.ts": "export const a = 1;\n", "pnpm-lock.yaml": PNPM_V9 });

it("audit > a replayed answer produces the counts, the affected packages and the date", async () => {
  const { fetcher } = osvReplay();
  const result = await analyze({ folder: project(), audit: true, auditFetch: fetcher });
  const audit = result.dependencies;
  expect(audit).toMatchObject({
    kind: "dependencies",
    lockfile: "pnpm-lock.yaml",
    ecosystem: "npm",
    database: "osv.dev",
    packages: 3,
    counts: { critical: 0, high: 1, moderate: 1, low: 0, unknown: 1 },
  });
  expect(audit?.affected.map((p) => `${p.name}@${p.version}`)).toEqual([
    "lodash@4.17.15",
    "@scope/pkg@2.0.0",
  ]);
  expect(Number.isNaN(Date.parse(audit?.checkedAt ?? ""))).toBe(false);
});

it("audit > says what it sends before it sends it", async () => {
  const events: string[] = [];
  const { fetcher } = osvReplay();
  const spy = ((url: string, init?: unknown) => {
    events.push(`fetch ${url}`);
    return (fetcher as unknown as (u: string, i?: unknown) => Promise<Response>)(url, init);
  }) as unknown as typeof fetch;
  await analyze({
    folder: project(),
    audit: true,
    auditFetch: spy,
    log: (line) => events.push(`say ${line}`),
  });
  expect(events[0]).toMatch(
    /^say Dependency audit: sending 3 package names and versions from pnpm-lock\.yaml to api\.osv\.dev/,
  );
  expect(events[1]).toMatch(/^fetch https:\/\/api\.osv\.dev\//);
});

it("audit > without the option nothing is sent and nothing is produced", async () => {
  const { fetcher, calls } = osvReplay();
  const result = await analyze({ folder: project(), auditFetch: fetcher });
  expect(calls).toHaveLength(0);
  expect(result.dependencies).toBeUndefined();
});

it("audit > --offline refuses it, and nothing is sent", async () => {
  const { fetcher, calls } = osvReplay();
  await expect(
    analyze({ folder: project(), audit: true, offline: true, auditFetch: fetcher }),
  ).rejects.toThrow(/--offline forbids it/);
  expect(calls).toHaveLength(0);
});

it("audit > a folder with no lockfile is a warning, and nothing is sent", async () => {
  const { fetcher, calls } = osvReplay();
  const result = await analyze({
    folder: makeTree({ "src/a.ts": "export const a = 1;\n" }),
    audit: true,
    auditFetch: fetcher,
  });
  expect(calls).toHaveLength(0);
  expect(result.dependencies).toBeUndefined();
  expect(result.manifest.warnings.join(" ")).toContain("Dependency audit skipped: no pnpm-lock.yaml");
});

it("audit > a failed request is a warning, and the analysis still stands", async () => {
  const failing = (async () => ({
    ok: false,
    status: 503,
    json: async () => ({}),
  })) as unknown as typeof fetch;
  const result = await analyze({ folder: project(), audit: true, auditFetch: failing });
  expect(result.dependencies).toBeUndefined();
  expect(result.manifest.analyzed).toBe(1);
  expect(result.manifest.warnings.join(" ")).toContain("Dependency audit failed (api.osv.dev answered 503");
});

it("audit > dependencies.json is written with the analysis, and an earlier one does not outlive a run without audit", async () => {
  const { fetcher } = osvReplay();
  const out = mkdtempSync(join(tmpdir(), "fc-deps-"));
  await writeAnalysis(await analyze({ folder: project(), audit: true, auditFetch: fetcher }), out);
  expect(JSON.parse(readFileSync(join(out, "dependencies.json"), "utf8")).counts.high).toBe(1);
  await writeAnalysis(await analyze({ folder: project() }), out);
  expect(existsSync(join(out, "dependencies.json"))).toBe(false);
});
