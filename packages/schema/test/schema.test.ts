import { describe, expect, it } from "vitest";
import { buildCcJson, getMetric, METRICS, metricsForLevel, nodeId, validateCcJson } from "../src/index.js";

function sample() {
  const id = nodeId("/root/a.ts");
  return buildCcJson({
    projectName: "p",
    files: [
      { id: nodeId("/root"), name: "root", type: "Folder", children: [{ id, name: "a.ts", type: "File" }] },
    ],
    attributes: { [id]: { loc: 3, rloc: 2 } },
    attributeTypes: { loc: "absolute", rloc: "absolute" },
  });
}

describe("cc.json", () => {
  it("builds a document the CodeCharta schema accepts", () => {
    expect(validateCcJson(sample())).toEqual({ valid: true, errors: [] });
  });

  it("rejects a document with a wrong checksum", () => {
    const doc = sample();
    doc.meta.checksum = "0".repeat(32);
    expect(validateCcJson(doc).valid).toBe(false);
  });

  it("rejects an unknown major version and unknown fields", () => {
    const doc = sample();
    expect(validateCcJson({ ...doc, meta: { ...doc.meta, apiVersion: "3.0" } }).valid).toBe(false);
    expect(validateCcJson({ ...doc, extra: 1 }).valid).toBe(false);
  });

  it("gives the same id to the same path and different ids to different paths", () => {
    expect(nodeId("/root/a.ts")).toBe(nodeId("/root/a.ts"));
    expect(nodeId("/root/a.ts")).not.toBe(nodeId("/root/b.ts"));
    expect(nodeId("/root/a.ts")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("metric registry", () => {
  it("has unique ids and a complete definition for every metric", () => {
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(METRICS.length);
    for (const m of METRICS) {
      for (const key of ["label", "definition", "computation", "why", "unit", "limits"] as const) {
        expect(m[key], `${m.id}.${key}`).not.toBe("");
      }
    }
  });

  it("looks metrics up by id and by data level", () => {
    expect(getMetric("rloc")?.level).toBe(0);
    expect(getMetric("nope")).toBeUndefined();
    expect(metricsForLevel(0)).toHaveLength(METRICS.length);
    expect(metricsForLevel(0).every((m) => m.level === 0)).toBe(true);
  });
});
