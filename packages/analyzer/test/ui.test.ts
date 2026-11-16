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

  it("shows the file, the health and the factory in one inspector that fits the free stage", async () => {
    const r = await inPage<Record<string, unknown>>(`
      const inspector = document.querySelector(".inspector");
      const shown = () => [...inspector.querySelectorAll(".pane")].filter((p) => !p.hidden).map((p) => p.getAttribute("aria-label"));
      const selected = () => [...inspector.querySelectorAll('[role="tab"]')].filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.textContent);
      const closed = inspector.hidden;
      key("h");
      await wait(80);
      const health = { panes: shown(), tab: selected(), pressed: document.querySelector('.bar button[aria-pressed="true"]')?.textContent };
      const timeline = box(document.querySelector(".timeline"));
      const fits = box(inspector).bottom <= timeline.y && box(inspector).y >= box(document.querySelector(".bar")).bottom;
      const body = inspector.querySelector(".inspector-body");
      const head = box(inspector.querySelector(".inspector-head"));
      body.scrollTop = 400;
      await wait(40);
      const headStays = box(inspector.querySelector(".inspector-head")).y === head.y;
      const scrolls = body.scrollHeight > body.clientHeight ? body.scrollTop > 0 : true;
      key("f");
      await wait(80);
      const factory = { panes: shown(), tab: selected() };
      inspector.querySelector('[data-tab="file"]').click();
      await wait(80);
      const file = { panes: shown(), tab: selected(), text: inspector.querySelector(".pane:not([hidden])").textContent };
      key("Escape");
      await wait(40);
      return { closed, health, fits, headStays, scrolls, factory, file, closedAgain: inspector.hidden, closeButtons: inspector.querySelectorAll('[aria-label="Close the inspector"]').length };
    `);
    expect(r).toEqual({
      closed: true,
      health: { panes: ["Code health"], tab: ["Health"], pressed: "Health" },
      fits: true,
      headStays: true,
      scrolls: true,
      factory: { panes: ["Factory"], tab: ["Factory"] },
      file: {
        panes: ["File details"],
        tab: ["File"],
        text: "Click a building to see all the metrics of its file.",
      },
      closedAgain: true,
      closeButtons: 1,
    });
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

  it("names the top-level districts on the stage, never over a panel, and lets the user switch the names off", async () => {
    const r = await inPage<Record<string, unknown>>(`
      await wait(300);
      const shown = () => [...document.querySelectorAll(".district-label")].filter((l) => l.style.visibility === "visible");
      const stage = box(document.querySelector(".stage"));
      const before = shown().map((l) => l.textContent);
      const inStage = shown().every((l) => { const b = box(l); return b.x >= stage.x && b.right <= stage.right && b.y >= stage.y && b.bottom <= stage.bottom; });
      const toggle = [...document.querySelectorAll(".menu-list .check")].find((c) => c.textContent.includes("district names")).querySelector("input");
      toggle.click();
      await wait(80);
      const off = { hidden: document.querySelector(".district-labels").hidden };
      toggle.click();
      await wait(120);
      return { before, inStage, off, backOn: shown().length > 0 };
    `);
    expect(r.before).toContain("src");
    expect(r.inStage).toBe(true);
    expect(r.off).toEqual({ hidden: true });
    expect(r.backOn).toBe(true);
  });

  it("shows the path of the selected file as a trail of folders, and keeps the file outlined until the inspector closes", async () => {
    const r = await inPage<Record<string, unknown>>(`
      const inspector = document.querySelector(".inspector");
      inspector.querySelector('[data-tab="file"]').click();
      await wait(60);
      // select a building the way a click does, through the page hook
      const hook = window.factoryCity;
      const ok = hook.selectFirstFile?.() ?? false;
      await wait(80);
      const trail = [...document.querySelectorAll(".breadcrumb button")].map((b) => b.textContent);
      document.querySelector(".breadcrumb button")?.click();
      await wait(700);
      const closeButton = inspector.querySelector('[aria-label="Close the inspector"]');
      closeButton?.click();
      await wait(60);
      return { ok, trail, closed: inspector.hidden, selected: hook.selected?.() ?? null };
    `);
    expect(r.ok).toBe(true);
    expect((r.trail as string[]).length).toBeGreaterThan(0);
    expect(r.closed).toBe(true);
    expect(r.selected).toBeNull();
  });

  /** Opens the view panel and the file inspector, then reports what overlaps, what leaves the window, what is cut. */
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
      return { ...audit, onStage, legendClear, closedByEscape: inspector.hidden };
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
