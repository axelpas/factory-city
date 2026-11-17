import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { pathInFolder, readSarif } from "../src/collectors/sarif.js";
import { makeTree } from "./helpers.js";
import { values } from "./history-helpers.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/sarif/${name}`, import.meta.url));
const code = "export const a = 1;\n";

const tree = () =>
  makeTree({
    "src/a.ts": code,
    "src/b.ts": code,
    "src/c.ts": code,
    "src/a.test.ts": code,
    "tools/run.py": "import os\nos.system('ls')\n",
    "tools/clean.py": "print(1)\n",
    "tools/other.go": "package x\n",
  });

it("sarif > counts the results of a Semgrep-like file per analyzed file, by level", async () => {
  const dir = tree();
  const v = values(await analyze({ folder: dir, sarif: [fixture("semgrep-like.sarif")] }));
  // the first result has no level: the rule says error
  expect(v.get("src/a.ts")).toMatchObject({ sarif_findings: 2, sarif_error_findings: 1 });
  expect(v.get("src/b.ts")).toMatchObject({ sarif_findings: 1, sarif_error_findings: 0 });
});

it("sarif > a covered file with no result is 0; a file the tool does not read is unavailable", async () => {
  const dir = tree();
  const v = values(
    await analyze({ folder: dir, sarif: [fixture("semgrep-like.sarif"), fixture("bandit-like.sarif")] }),
  );
  expect(v.get("src/c.ts")).toMatchObject({ sarif_findings: 0, sarif_error_findings: 0 });
  expect(v.get("tools/run.py")).toMatchObject({ sarif_findings: 1, sarif_error_findings: 1 });
  // listed in the artifacts of the Python scanner, with no result
  expect(v.get("tools/clean.py")).toMatchObject({ sarif_findings: 0 });
  expect(v.get("tools/other.go")).not.toHaveProperty("sarif_findings");
});

it("sarif > counts apart what cannot be attached, and never rates a test file", async () => {
  const dir = tree();
  const result = await analyze({ folder: dir, sarif: [fixture("semgrep-like.sarif")] });
  expect(result.manifest.external).toEqual([
    {
      kind: "sarif",
      tool: "Semgrep OSS",
      version: "1.99.0",
      results: 7,
      counted: 3,
      apart: { noLocation: 1, outside: 1, notAnalyzed: 1, tests: 1 },
    },
  ]);
  expect(values(result).get("src/a.test.ts")).not.toHaveProperty("sarif_findings");
  expect(result.manifest.warnings.join(" ")).toContain("4 of 7 result(s) are not attached");
});

it("sarif > never keeps a message or a snippet in any output", async () => {
  const result = await analyze({ folder: tree(), sarif: [fixture("semgrep-like.sarif")] });
  expect(JSON.stringify(result)).not.toContain("never kept");
});

it("sarif > changes nothing without the option, and the metrics stay absent", async () => {
  const v = values(await analyze({ folder: tree() }));
  expect(v.get("src/a.ts")).not.toHaveProperty("sarif_findings");
});

it("sarif > enters the score, which is also given without it", async () => {
  const dir = makeTree({ "src/a.ts": code, "src/b.ts": code });
  const sarif = fixture("semgrep-like.sarif");
  const result = await analyze({ folder: dir, sarif: [sarif] });
  // a.ts has 2 findings (high), b.ts has 1 (moderate): neither is low on the scanner dimension
  expect(result.report.health.scored).toContain("scanner");
  expect(result.report.health.score).toBeLessThan(result.report.health.scoreWithoutSecurity);
  expect(result.report.health.scoreWithoutSecurity).toBe(100);
});

it("sarif > rejects a file that is not SARIF with a message that says which file", async () => {
  await expect(readSarif(fixture("../../package.json"))).rejects.toThrow(
    /is not a SARIF 2\.1\.0 file|could not be read/,
  );
  await expect(readSarif(join(tree(), "nope.sarif"))).rejects.toThrow(/could not be read/);
});

it("sarif > reads uris as relative, absolute and file://", () => {
  const folder = "/work/project";
  expect(pathInFolder("src/a.ts", folder)).toBe("src/a.ts");
  expect(pathInFolder("./src/a.ts", folder)).toBe("src/a.ts");
  expect(pathInFolder("/work/project/src/a.ts", folder)).toBe("src/a.ts");
  expect(pathInFolder("file:///work/project/src/a%20b.ts", folder)).toBe("src/a b.ts");
  expect(pathInFolder("/work/other/a.ts", folder)).toBeUndefined();
  expect(pathInFolder("../a.ts", folder)).toBeUndefined();
});

it("sarif > matches the paths of a scanner that ran inside the analyzed subfolder", async () => {
  const dir = makeTree({ "pkg/src/a.ts": code, "pkg/src/b.ts": code });
  const result = await analyze({ folder: dir, path: "pkg", sarif: [fixture("semgrep-like.sarif")] });
  // semgrep-like.sarif names src/a.ts and src/b.ts: the scanner ran in pkg/
  expect(values(result).get("pkg/src/a.ts")).toMatchObject({ sarif_findings: 2 });
});

it("sarif > keeps a path with a literal percent sign and does not mistake ..name for a parent folder", () => {
  expect(pathInFolder("src/100%.ts", "/work/project")).toBe("src/100%.ts");
  expect(pathInFolder("src/a%2520b.ts", "/work/project")).toBe("src/a%20b.ts");
  expect(pathInFolder("..hidden.ts", "/work/project")).toBe("..hidden.ts");
  expect(pathInFolder("../x.ts", "/work/project")).toBeUndefined();
  expect(pathInFolder("file:///work/project/src/a%20b.ts", "/work/project")).toBe("src/a b.ts");
});
