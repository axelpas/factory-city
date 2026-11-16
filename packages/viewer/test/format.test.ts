import { describe, expect, it } from "vitest";
import { createFormat, FALLBACK_LOCALE, resolveLocale } from "../src/lib/format";

describe("lib/format", () => {
  it("uses the first supported browser locale", () => {
    expect(resolveLocale(["en-GB", "fr-CH"])).toBe("en-GB");
  });

  it("falls back to fr-CH when no locale is usable", () => {
    expect(resolveLocale(undefined)).toBe(FALLBACK_LOCALE);
    expect(resolveLocale([])).toBe(FALLBACK_LOCALE);
    expect(resolveLocale(["not a locale!!"])).toBe(FALLBACK_LOCALE);
  });

  it("formats numbers and percentages in the chosen locale", () => {
    const en = createFormat(["en-US"]);
    expect(en.integer(1234567)).toBe("1,234,567");
    expect(en.number(1234.567)).toBe("1,234.57");
    expect(en.percent(0.256)).toBe("26%");
  });

  it("formats dates in the chosen locale and time zone", () => {
    const en = createFormat(["en-US"], { timeZone: "UTC" });
    expect(en.date("2026-11-14T23:30:00Z")).toBe("Nov 14, 2026");
    const zurich = createFormat(["en-US"], { timeZone: "Europe/Zurich" });
    expect(zurich.date("2026-11-14T23:30:00Z")).toBe("Nov 15, 2026");
  });
});

describe("score", () => {
  it("writes the code-health score as a percentage with one decimal", () => {
    expect(createFormat(["en-US"]).score(41.8)).toBe("41.8%");
    expect(createFormat(["en-US"]).score(100)).toBe("100.0%");
    expect(createFormat(["fr-CH"]).score(20.75)).toMatch(/^20[.,][78] ?%$/);
  });
});
