import { describe, expect, it } from "vitest";
import { kindOfSubject, lastOfEachDay } from "../src/timeline.js";

describe("helpers", () => {
  it("reads the kind from the conventional type", () => {
    expect(kindOfSubject("feat(ui): x")).toBe("feature");
    expect(kindOfSubject("fix!: y")).toBe("fix");
    expect(kindOfSubject("docs: z")).toBe("docs");
    expect(kindOfSubject("Update readme")).toBe("unknown");
  });

  it("keeps the last commit of each day", () => {
    const day = (iso: string) => ({ hash: iso, time: Date.parse(iso) / 1000, subject: iso });
    expect(
      lastOfEachDay([
        day("2026-01-01T01:00:00Z"),
        day("2026-01-01T23:00:00Z"),
        day("2026-01-02T00:30:00Z"),
      ]).map((r) => r.hash),
    ).toEqual(["2026-01-01T23:00:00Z", "2026-01-02T00:30:00Z"]);
  });
});
