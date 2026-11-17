import { expect, it } from "vitest";
import { DIMENSIONS } from "../src/health/dimensions.js";
import { computeHealth, findHotspots, frameHealth, type HealthFile } from "../src/health/health.js";

const clean = (path: string, extra: Record<string, number> = {}): HealthFile => ({
  path,
  isTest: false,
  values: {
    rloc: 50,
    mcc: 4,
    max_function_complexity: 3,
    max_nesting_level: 1,
    imports_out: 1,
    escape_hatch_density: 0,
    security_signals: 0,
    ...extra,
  },
});

it("security in the score > a file with a signal is not healthy, and the score without security is kept apart", () => {
  const files = [clean("a.ts"), clean("b.ts", { security_signals: 2 })];
  const health = computeHealth(files, DIMENSIONS);
  expect(health.score).toBe(50);
  expect(health.scoreWithoutSecurity).toBe(100);
  expect(health.scored).toContain("security");
});

it("security in the score > both scores agree when no file could be rated on security", () => {
  const files = [clean("a.py", { security_signals: undefined as unknown as number })].map((f) => {
    const { security_signals: _removed, ...values } = f.values;
    return { ...f, values };
  });
  const health = computeHealth(files, DIMENSIONS);
  expect(health.score).toBe(100);
  expect(health.scoreWithoutSecurity).toBe(100);
  expect(health.scored).not.toContain("security");
});

it("security in the score > a frame keeps both scores", () => {
  const frame = frameHealth([clean("a.ts", { security_signals: 4 })], DIMENSIONS);
  expect(frame.score).toBe(0);
  expect(frame.scoreWithoutSecurity).toBe(100);
});

it("security in the score > a hotspot says which kinds of signal to review, and counts them", () => {
  const file = clean("src/auth/session.ts", {
    mcc: 40,
    security_signals: 3,
    security_hardcoded_secret: 2,
    security_dynamic_code: 1,
  });
  const [hot] = findHotspots([file], DIMENSIONS);
  const action = hot?.actions.find((a) => a.type === "review-security");
  expect(action?.text).toBe("Review the security signals: 1 dynamic code, 2 hard-coded secrets.");
  expect(JSON.stringify(hot)).not.toMatch(/password|token/i);
});

it("security in the score > a hotspot on a sensitive path says to look at it first", () => {
  const file = clean("src/auth/session.ts", {
    mcc: 40,
    security_signals: 2,
    security_dynamic_code: 2,
    sensitive_path: 1,
  });
  const [hot] = findHotspots([file], DIMENSIONS);
  const action = hot?.actions.find((a) => a.type === "review-security");
  expect(action?.text).toBe(
    "Review the security signals: 2 dynamic code. The path suggests sensitive code: look at it first.",
  );
});
