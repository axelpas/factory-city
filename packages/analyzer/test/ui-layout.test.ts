import { describe, expect, it } from "vitest";
import { canRender, inPage } from "./ui-helpers.js";

describe.skipIf(!canRender)("viewer interface in a real browser", () => {
  it("lays the top bar out on one line: every control inside the bar, none over another", async () => {
    const r = await inPage<{ outside: string[]; overlapping: string[]; count: number }>(`
      const bar = box(document.querySelector(".bar"));
      const items = [...document.querySelector(".bar").children]
        .filter((c) => !c.hidden && !c.classList.contains("spacer"))
        .map((c) => ({ name: (c.textContent || c.tagName).slice(0, 12), ...box(c.tagName === "DETAILS" ? c.querySelector("summary") : c) }));
      const outside = items
        .filter((i) => i.x < bar.x || i.right > bar.right || i.y < bar.y || i.bottom > bar.bottom)
        .map((i) => i.name);
      const overlapping = [];
      for (let a = 0; a < items.length; a++)
        for (let b = a + 1; b < items.length; b++)
          if (items[a].x < items[b].right - 1 && items[b].x < items[a].right - 1) overlapping.push(items[a].name + "/" + items[b].name);
      return { outside, overlapping, count: items.length };
    `);
    expect(r.count).toBeGreaterThan(6);
    expect(r.outside).toEqual([]);
    expect(r.overlapping).toEqual([]);
  });

  it("shows the preset and its whole question in the bar of a 1280 px window, with three selects at most", async () => {
    const r = await inPage<{
      question: string;
      cut: boolean;
      barHeight: number;
      selects: number;
      outside: string[];
      groups: string[];
      disabled: number;
    }>(
      `
      const bar = document.querySelector(".bar");
      const question = bar.querySelector(".question");
      const items = [...bar.children].filter((c) => !c.hidden && c.getBoundingClientRect().width > 0);
      const outside = items
        .filter((c) => box(c).right > box(bar).right || box(c).bottom > box(bar).bottom + 1)
        .map((c) => (c.textContent || c.tagName).slice(0, 12));
      document.querySelector(".lens-menu > summary").click();
      await wait(60);
      return {
        question: question.textContent,
        cut: question.scrollWidth > question.clientWidth + 1 || question.scrollHeight > question.clientHeight + 1,
        barHeight: box(bar).h,
        selects: [...bar.children].filter((c) => c.tagName === "SELECT" && !c.hidden).length,
        outside,
        groups: [...document.querySelectorAll(".lens-list .menu-group")].map((g) => g.textContent),
        disabled: document.querySelectorAll(".lens-list button:disabled").length,
      };
    `,
      { width: 1280, height: 760 },
    );
    expect(r.question).toMatch(/\?$/);
    expect(r.cut).toBe(false);
    expect(r.barHeight).toBeLessThanOrEqual(60);
    expect(r.selects).toBeLessThanOrEqual(3);
    expect(r.outside).toEqual([]);
    expect(r.groups).toEqual(["Code", "History", "Factory", "Compare"]);
    // some presets need data this sample lacks: they are listed, disabled
    expect(r.disabled).toBeGreaterThan(0);
  });

  it("pins a compact legend at the bottom left, under the view panel and left of the timeline, with definitions on demand", async () => {
    const r = await inPage<Record<string, unknown>>(`
      const legend = document.querySelector(".legend");
      const panel = box(document.querySelector(".panel"));
      const timeline = box(document.querySelector(".timeline"));
      const lines = [...legend.querySelectorAll("details.legend-line")];
      const first = lines[0];
      const closedHeight = box(first).h;
      first.querySelector("summary").click();
      await wait(60);
      return {
        onStage: legend.parentElement === document.querySelector(".stage").parentElement && !legend.closest(".panel"),
        visible: !legend.hidden && box(legend).w > 0,
        pinnedLeft: box(legend).x <= 16,
        pinnedBottom: innerHeight - box(legend).bottom <= 16,
        underPanel: box(legend).y >= panel.bottom,
        leftOfTimeline: box(legend).right <= timeline.x,
        channels: lines.map((l) => l.getAttribute("data-channel")),
        glyphs: lines.every((l) => l.querySelector("summary svg")),
        oneLine: closedHeight < 30,
        definition: first.open && first.querySelector(".legend-def").textContent.length > 20,
        ramp: !!legend.querySelector(".ramp") && legend.querySelectorAll(".ramp-labels span").length === 2,
        note: document.body.textContent.includes("Exact values"),
      };
    `);
    expect(r).toEqual({
      onStage: true,
      visible: true,
      pinnedLeft: true,
      pinnedBottom: true,
      underPanel: true,
      leftOfTimeline: true,
      channels: ["Area", "Height", "Color"],
      glyphs: true,
      oneLine: true,
      definition: true,
      ramp: true,
      note: false,
    });
  });

  it("starts with the view panel folded to a rail, and an open panel stays above the legend", async () => {
    const r = await inPage<Record<string, unknown>>(`
      const panel = document.querySelector(".panel");
      const rail = { isRail: panel.classList.contains("rail"), width: box(panel).w, timelineLeft: box(document.querySelector(".timeline")).x };
      const legendTop = box(document.querySelector(".legend")).y;
      await openPanel();
      const open = {
        isRail: panel.classList.contains("rail"),
        width: box(panel).w,
        timelineLeft: box(document.querySelector(".timeline")).x,
        aboveLegend: box(panel).bottom <= legendTop,
        main: [...panel.querySelectorAll(":scope > .picker label")].map((l) => l.textContent),
        moreOpen: panel.querySelector("details.more").open,
        inMore: [...panel.querySelectorAll("details.more label")].map((l) => l.textContent.trim()),
        stored: localStorage.getItem("fc.panel"),
        tests: [...panel.querySelectorAll(".segmented button")].map((b) => b.textContent + ":" + b.getAttribute("aria-pressed")),
      };
      panel.querySelector(".panel-head button").click();
      await wait(60);
      return { rail, open, foldedAgain: panel.classList.contains("rail"), storedAfter: localStorage.getItem("fc.panel") };
    `);
    expect(r.rail).toMatchObject({ isRail: true });
    const rail = r.rail as { width: number; timelineLeft: number };
    const open = r.open as { width: number; timelineLeft: number };
    expect(rail.width).toBeLessThan(60);
    expect(open.width).toBeGreaterThan(250);
    // the timeline starts right of the legend, whatever the panel does
    expect(open.timelineLeft).toBe(rail.timelineLeft);
    expect(r.open).toMatchObject({ aboveLegend: true });
    expect(r.open).toMatchObject({
      isRail: false,
      main: ["Area", "Height", "Color"],
      moreOpen: false,
      inMore: expect.arrayContaining(["Marker", "District tint", "Scale"]),
      stored: "open",
      tests: ["show:true", "dim:false", "hide:false"],
    });
    expect(r.foldedAgain).toBe(true);
    expect(r.storedAfter).toBe("rail");
  });

  it("says when the channels were changed by hand, and offers the way back to the preset", async () => {
    const r = await inPage<Record<string, unknown>>(`
      await openPanel();
      const panel = document.querySelector(".panel");
      const state = () => panel.querySelector(".panel-state");
      const lens = () => document.querySelector(".lens-menu .lens-name").textContent;
      const before = { hidden: state().hidden, lens: lens() };
      const color = panel.querySelectorAll(":scope > .picker select")[2];
      color.selectedIndex = color.selectedIndex === 1 ? 2 : 1;
      color.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(80);
      const modified = { hidden: state().hidden, text: state().textContent, lens: lens() };
      state().querySelector("button").click();
      await wait(80);
      return { before, modified, after: { hidden: state().hidden, lens: lens() } };
    `);
    const before = r.before as { hidden: boolean; lens: string };
    expect(before.hidden).toBe(true);
    expect(r.modified).toMatchObject({ hidden: false, lens: "Custom" });
    expect((r.modified as { text: string }).text).toBe(`modifiedBack to ${before.lens}`);
    expect(r.after).toEqual({ hidden: true, lens: before.lens });
  });

  it("names the project and its branch in the top bar, apart from the indicator it is read through", async () => {
    const r = await inPage<Record<string, unknown>>(`
      await wait(300);
      const bar = document.querySelector(".bar");
      const context = bar.querySelector(".context");
      const label = bar.querySelector(".bar-label");
      const rule = bar.querySelector(".bar-rule");
      const lens = bar.querySelector(".lens-menu");
      return {
        label: label.textContent,
        // reading order: project and branch, a rule, the label, then the selector, side by side
        order: box(context).right <= box(rule).x && box(rule).right <= box(label).x && box(label).right <= box(lens).x,
        sideBySide: box(lens).x - box(label).right <= 16,
        name: context.querySelector(".context-name")?.textContent ?? bar.querySelector("select").selectedOptions[0]?.textContent ?? "",
        ref: context.querySelector(".context-ref")?.textContent ?? "",
        inBar: box(context).right <= box(bar).right && box(context).bottom <= box(bar).bottom,
      };
    `);
    expect(r.label).toBe("Indicator");
    expect(r.order).toBe(true);
    expect(r.sideBySide).toBe(true);
    expect(r.name).not.toBe("");
    expect(r.ref).not.toBe("");
    expect(r.inBar).toBe(true);
  });
});
