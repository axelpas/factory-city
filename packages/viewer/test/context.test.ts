import type { AnalysisManifest, TimelineManifest } from "@factory-city/schema";
import { describe, expect, it } from "vitest";
import { projectContext } from "../src/view/context";

const snapshot = (source: AnalysisManifest["source"], git = true) =>
  ({
    kind: "snapshot",
    project: "demo",
    source,
    git: { available: git, shallow: false },
  }) as AnalysisManifest;
const timeline = (mode: string, branch = "main") =>
  ({ kind: "timeline", project: "demo", source: { mode, branch } }) as unknown as TimelineManifest;

describe("project context", () => {
  it("names the branch of a timeline", () => {
    expect(projectContext(timeline("issue"), "x")).toEqual({ name: "demo", ref: "main" });
    expect(projectContext(timeline("diff", "feat/12-x"), "x").ref).toBe("feat/12-x (diff)");
  });

  it("names the revision of a snapshot, with the short commit", () => {
    expect(projectContext(snapshot({ kind: "git", commit: "4c4b20e8f1" }), "x").ref).toBe("HEAD · 4c4b20e");
    expect(projectContext(snapshot({ kind: "git", rev: "v1.2.0", commit: "4c4b20e8f1" }), "x").ref).toBe(
      "v1.2.0 · 4c4b20e",
    );
  });

  it("says where the files came from when there is no revision, and keeps the subfolder", () => {
    expect(projectContext(snapshot({ kind: "disk" }, true), "x").ref).toBe("working tree");
    expect(projectContext(snapshot({ kind: "disk" }, false), "x").ref).toBe("folder, no git");
    expect(projectContext(snapshot({ kind: "git", commit: "abcdef0", path: "packages/ui" }), "x").path).toBe(
      "packages/ui",
    );
  });

  it("falls back to the project name without a manifest", () => {
    expect(projectContext(undefined, "demo")).toEqual({ name: "demo", ref: "no manifest" });
  });
});
