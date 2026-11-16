import { describe, expect, it } from "vitest";
import { canRender, inPage } from "./ui-helpers.js";

describe.skipIf(!canRender)("viewer interface in a real browser", () => {
  const AUDIT = `
    await wait(300);
    const railBefore = document.querySelector(".panel").classList.contains("rail");
    const rail = document.querySelector(".panel.rail button");
    if (rail) { rail.click(); await wait(120); }
    window.factoryCity.selectFirstFile();
    await wait(250);
    const vis = (e) => e && !e.hidden && e.getBoundingClientRect().width > 0;
    const named = { bar: ".bar", panel: ".panel", inspector: ".inspector", timeline: ".timeline", legend: ".legend", status: ".status" };
    const boxes = {};
    for (const [k, sel] of Object.entries(named)) { const e = document.querySelector(sel); if (vis(e)) boxes[k] = box(e); }
    const keys = Object.keys(boxes);
    const overlap = (a, b) => a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1;
    const overlaps = [];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (overlap(boxes[keys[i]], boxes[keys[j]])) overlaps.push(keys[i] + "/" + keys[j]);
    const outside = keys.filter((k) => boxes[k].x < -1 || boxes[k].right > innerWidth + 1 || boxes[k].bottom > innerHeight + 1 || boxes[k].y < -1);
    const barItems = [...document.querySelector(".bar").children].filter((c) => vis(c));
    const barCut = barItems.filter((c) => box(c).right > innerWidth || box(c).x < 0).map((c) => (c.textContent || c.tagName).slice(0, 12));
    const question = document.querySelector(".question");
    const questionCut = vis(question) && (question.scrollWidth > question.clientWidth + 1 || question.scrollHeight > question.clientHeight + 1);
    const status = document.querySelector(".status-chip summary");
    const statusCut = vis(status) && status.scrollWidth > status.clientWidth + 1;
    const frame = document.querySelector(".frame-label");
    const frameCut = vis(frame) && frame.scrollWidth > frame.clientWidth + 1 && !frame.querySelector(".frame-title");
    return { overlaps, outside, barCut, questionCut, statusCut, frameCut, railBefore, barHeight: box(document.querySelector(".bar")).h, boxes };
  `;

  it("keeps everything apart at 1280 px with the view panel and the inspector open", async () => {
    const r = await inPage<Record<string, unknown>>(AUDIT, { width: 1280, height: 760 });
    expect(r.overlaps).toEqual([]);
    expect(r.outside).toEqual([]);
    expect(r.barCut).toEqual([]);
    expect(r.questionCut).toBe(false);
    expect(r.statusCut).toBe(false);
  });

  it("under 1100 px folds the view panel to a rail and lets the inspector overlay the stage", async () => {
    const r = await inPage<Record<string, unknown>>(
      `
      ${AUDIT.replace("return {", "const audit = {").replace(/};\s*$/, "};")}
      const inspector = document.querySelector(".inspector");
      const stage = box(document.querySelector(".stage"));
      const onStage = box(inspector).x > stage.x && box(inspector).right <= stage.right + 1;
      const legendClear = !document.querySelector(".legend") || box(document.querySelector(".legend")).right <= box(inspector).x + 1 || box(document.querySelector(".legend")).bottom <= box(inspector).y;
      key("Escape");
      await wait(60);
      return { ...audit, onStage, legendClear, closedByEscape: inspector.classList.contains("folded") };
    `,
      { width: 1000, height: 760 },
    );
    expect(r.railBefore).toBe(true);
    expect(r.onStage).toBe(true);
    expect(r.closedByEscape).toBe(true);
    // the inspector overlays the stage: it may cover it, but never the bar or the timeline
    expect(r.overlaps).not.toContain("inspector/bar");
    expect(r.overlaps).not.toContain("inspector/timeline");
    expect(r.outside).toEqual([]);
    expect(r.barCut).toEqual([]);
  });

  it("under 820 px wraps the bar on two lines at most and opens the panels as sheets over the stage", async () => {
    const r = await inPage<Record<string, unknown>>(AUDIT, { width: 700, height: 760 });
    expect(r.outside).toEqual([]);
    expect(r.barCut).toEqual([]);
    expect(r.barHeight as number).toBeLessThanOrEqual(110);
    const boxes = r.boxes as Record<string, { x: number; right: number; bottom: number }>;
    // a sheet takes the width of the window
    expect(boxes.inspector?.x).toBeLessThanOrEqual(16);
    expect(boxes.inspector?.right).toBeGreaterThanOrEqual(700 - 16);
  });
});
