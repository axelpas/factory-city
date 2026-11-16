import { describe, expect, it } from "vitest";
import { doctor } from "../src/doctor.js";
import { initRepo, makeTree } from "./helpers.js";
import { body, syntheticRepo } from "./history-helpers.js";

describe("doctor", () => {
  it("reports level 0 and how to unlock history outside a repository", async () => {
    const report = await doctor(makeTree({ "a.ts": body(1) }));
    expect(report.level).toBe(0);
    expect(report.next).toContain("level 1");
  });

  it("reports level 1 in a repository and names the next step", async () => {
    const { dir } = syntheticRepo();
    const report = await doctor(dir);
    expect(report).toMatchObject({ level: 1, levelName: "History" });
    expect(report.next).toContain("GitHub");
  });

  it("asks for a first commit in an empty repository", async () => {
    const report = await doctor(initRepo());
    expect(report.level).toBe(0);
    expect(report.next).toContain("first commit");
  });
});
