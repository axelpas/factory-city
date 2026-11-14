import { describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { folderCohesion, parseJsonc } from "../src/resolve.js";
import { makeTree } from "./helpers.js";

type Result = Awaited<ReturnType<typeof analyze>>;

function valuesByPath(result: Result): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  const walk = (nodes: Result["snapshot"]["files"], prefix: string) => {
    for (const n of nodes) {
      const p = prefix ? `${prefix}/${n.name}` : n.name;
      if (n.type === "File")
        out.set(p.replace(/^root\//, ""), result.snapshot.lenses.metrics.attributes[n.id] ?? {});
      else {
        out.set(`${p.replace(/^root\/?/, "")}/`, result.snapshot.lenses.metrics.attributes[n.id] ?? {});
        walk(n.children ?? [], p);
      }
    }
  };
  walk(result.snapshot.files, "");
  return out;
}

const code = (extra = "") => `export const x = 1;\n${extra}`;

describe("module coupling", () => {
  const tree = {
    "tsconfig.json": `{
      // comments and trailing commas are allowed in tsconfig
      "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["src/*"], "@lib": ["lib/index.ts"] }, },
    }`,
    "src/main.ts": [
      'import { a } from "./a.js";',
      'import u from "@app/util";',
      'import l from "@lib";',
      'import fs from "node:fs";',
      'import ext from "lodash";',
      'import p from "@ws/pkg";',
      'import s from "@ws/pkg/sub";',
      'import missing from "./does-not-exist";',
      'export * from "./a";',
    ].join("\n"),
    "src/a.ts": code(),
    "src/util.ts": code('import { a } from "./a";'),
    "lib/index.ts": code(),
    "packages/pkg/package.json": '{ "name": "@ws/pkg", "main": "dist/index.js" }',
    "packages/pkg/src/index.ts": code(),
    "packages/pkg/src/sub.ts": code(),
  };

  it("counts distinct internal modules, resolving relative paths, aliases, workspace packages and .js to .ts", async () => {
    const result = await analyze({ folder: makeTree(tree) });
    const v = valuesByPath(result);
    // a, util, lib/index, pkg index, pkg sub; node:fs, lodash and the missing file are not counted
    expect(v.get("src/main.ts")?.imports_out).toBe(5);
    expect(v.get("src/util.ts")?.imports_out).toBe(1);
    expect(v.get("lib/index.ts")?.imports_out).toBe(0);
  });

  it("counts each importing module once, however many times it imports", async () => {
    const result = await analyze({ folder: makeTree(tree) });
    const v = valuesByPath(result);
    // main imports a twice, util once: two distinct importers
    expect(v.get("src/a.ts")?.imports_in).toBe(2);
    expect(v.get("src/main.ts")?.imports_in).toBe(0);
  });

  it("leaves coupling out for files of languages without import support", async () => {
    const result = await analyze({ folder: makeTree({ "a.ts": code() }), all: true, include: ["**"] });
    expect(valuesByPath(result).get("a.ts")).toHaveProperty("imports_out");
  });

  it("handles a project without any tsconfig or package.json", async () => {
    const result = await analyze({ folder: makeTree({ "a.ts": 'import "./b";\n', "b.ts": code() }) });
    expect(valuesByPath(result).get("a.ts")?.imports_out).toBe(1);
  });
});

describe("folder cohesion", () => {
  it("divides internal links by internal plus outgoing links", async () => {
    const result = await analyze({
      folder: makeTree({
        "core/a.ts": 'import "./b";\nimport "./c";\nimport "./d";\nimport "../other/x";\n',
        "core/b.ts": 'import "./c";\n',
        "core/c.ts": code(),
        "core/d.ts": code(),
        "other/x.ts": code(),
      }),
    });
    // 4 internal links, 1 leaving
    expect(valuesByPath(result).get("core/")?.folder_cohesion).toBeCloseTo(4 / 5, 10);
  });

  it("is unavailable under 5 links, never zero", async () => {
    const result = await analyze({
      folder: makeTree({ "core/a.ts": 'import "./b";\n', "core/b.ts": code() }),
    });
    expect(valuesByPath(result).get("core/")).not.toHaveProperty("folder_cohesion");
  });

  it("computes from a plain graph", () => {
    const graph = new Map([
      ["f/a.ts", new Set(["f/b.ts", "g/c.ts"])],
      ["f/b.ts", new Set<string>()],
    ]);
    expect(folderCohesion("f", ["f/a.ts", "f/b.ts"], graph)).toBeUndefined();
  });
});

describe("tsconfig parsing", () => {
  it("accepts comments and trailing commas, and keeps strings that look like comments", () => {
    expect(parseJsonc('{ "a": "http://x", /* c */ "b": [1, 2,], // end\n }')).toEqual({
      a: "http://x",
      b: [1, 2],
    });
  });
});
