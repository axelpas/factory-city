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

  it("shows a compact legend on the stage, in the free area, with definitions on demand", async () => {
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
        rightOfPanel: box(legend).x >= panel.right,
        aboveTimeline: box(legend).bottom <= timeline.y,
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
      rightOfPanel: true,
      aboveTimeline: true,
      channels: ["Area", "Height", "Color"],
      glyphs: true,
      oneLine: true,
      definition: true,
      ramp: true,
      note: false,
    });
  });

  it("starts with the view panel folded to a rail, and gives its room to the city and the timeline", async () => {
    const r = await inPage<Record<string, unknown>>(`
      const panel = document.querySelector(".panel");
      const rail = { isRail: panel.classList.contains("rail"), width: box(panel).w, timelineLeft: box(document.querySelector(".timeline")).x };
      await openPanel();
      const open = {
        isRail: panel.classList.contains("rail"),
        width: box(panel).w,
        timelineLeft: box(document.querySelector(".timeline")).x,
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
    // the timeline follows the panel: it starts further left when the panel is a rail
    expect(rail.timelineLeft).toBeLessThan(open.timelineLeft - 200);
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

  it("opens the help of a channel as a popover: the row keeps its layout", async () => {
    const r = await inPage<{
      before: number;
      after: number;
      open: boolean;
      button: { w: number; h: number };
    }>(`
      await openPanel();
      const row = document.querySelector(".picker .row");
      const select = row.querySelector("select");
      const help = row.querySelector("details.metric-help");
      const before = box(select).w;
      help.querySelector("summary").click();
      await wait(60);
      return { before, after: box(select).w, open: help.open, button: box(help.querySelector("summary")) };
    `);
    expect(r.open).toBe(true);
    expect(r.after).toBe(r.before);
    // the "?" stays a small round button
    expect(Math.abs(r.button.w - r.button.h)).toBeLessThan(8);
  });

  it("closes menus and popovers the same way: one at a time, Escape, a press outside", async () => {
    const r = await inPage<Record<string, boolean>>(`
      await openPanel();
      const help = document.querySelector(".picker details.metric-help");
      const menu = document.querySelector("details.export-menu");
      const toggle = async (d) => { d.querySelector("summary").click(); await wait(60); };
      await toggle(help);
      await toggle(menu);
      const oneAtATime = menu.open && !help.open;
      key("Escape");
      const escapeCloses = !menu.open;
      await toggle(menu);
      press(document.querySelector("canvas"));
      const outsideCloses = !menu.open;
      await toggle(menu);
      press(menu.querySelector(".menu-list"));
      const insideKeeps = menu.open;
      return { oneAtATime, escapeCloses, outsideCloses, insideKeeps };
    `);
    expect(r).toEqual({ oneAtATime: true, escapeCloses: true, outsideCloses: true, insideKeeps: true });
  });

  it("draws the Export menu above the right panel, and Escape closes the menu before the panel", async () => {
    const r = await inPage<Record<string, boolean>>(`
      const menu = document.querySelector("details.export-menu");
      const health = document.querySelector(".health");
      key("h");
      await wait(60);
      menu.querySelector("summary").click();
      await wait(60);
      const items = [...menu.querySelectorAll(".menu-list button")];
      const onTop = items.every((item) => {
        const b = box(item);
        return document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2) === item;
      });
      const overlaps = items.some((item) => box(item).right > box(health).x && box(item).bottom > box(health).y);
      key("Escape");
      const panelStays = !menu.open && !health.hidden;
      key("Escape");
      return { panelOpen: true, overlaps, onTop, panelStays, panelCloses: health.hidden };
    `);
    expect(r).toEqual({ panelOpen: true, overlaps: true, onTop: true, panelStays: true, panelCloses: true });
  });
});
