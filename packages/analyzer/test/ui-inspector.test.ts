import { describe, expect, it } from "vitest";
import { canRender, inPage } from "./ui-helpers.js";

describe.skipIf(!canRender)("viewer interface in a real browser", () => {
  it("shows the file, the health and the factory in one inspector that fits the free stage", async () => {
    const r = await inPage<Record<string, unknown>>(`
      const inspector = document.querySelector(".inspector");
      const shown = () => [...inspector.querySelectorAll(".pane")].filter((p) => !p.hidden).map((p) => p.getAttribute("aria-label"));
      const selected = () => [...inspector.querySelectorAll('[role="tab"]')].filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.textContent);
      const closed = inspector.classList.contains("folded");
      key("h");
      await wait(80);
      const health = { panes: shown(), tab: selected() };
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
      return { closed, health, fits, headStays, scrolls, factory, file, closedAgain: inspector.classList.contains("folded"), foldButtons: inspector.querySelectorAll(".inspector-fold").length, tabs: [...inspector.querySelectorAll('[role="tab"]')].map((t) => t.textContent) };
    `);
    expect(r).toEqual({
      closed: true,
      health: { panes: ["Code health"], tab: ["Health"] },
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
      foldButtons: 1,
      tabs: ["Health", "File", "Factory"],
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
      const closeButton = inspector.querySelector(".inspector-fold");
      closeButton?.click();
      await wait(60);
      return { ok, trail, closed: inspector.classList.contains("folded"), selected: hook.selected?.() ?? null };
    `);
    expect(r.ok).toBe(true);
    expect((r.trail as string[]).length).toBeGreaterThan(0);
    expect(r.closed).toBe(true);
    expect(r.selected).toBeNull();
  });

  /** Opens the view panel and the file inspector, then reports what overlaps, what leaves the window, what is cut. */

  it("keeps the code health in view in the folded inspector on the right: score in percent, trend, risks, Health first", async () => {
    const r = await inPage<Record<string, unknown>>(`
      await wait(300);
      const inspector = document.querySelector(".inspector");
      const bar = document.querySelector(".bar");
      const summary = inspector.querySelector(".score-summary");
      const folded = {
        isFolded: inspector.classList.contains("folded"),
        summaryShown: !summary.hidden && box(summary).h > 0,
        value: summary.querySelector(".score-value").textContent,
        outOf100: summary.textContent.includes("out of 100"),
        trend: !!summary.querySelector(".score-trend"),
        risks: summary.querySelectorAll(".score-risks .kv").length,
        onRight: box(inspector).x > innerWidth / 2,
        tabs: [...inspector.querySelectorAll('[role="tab"]')].map((t) => t.textContent),
        selected: [...inspector.querySelectorAll('[role="tab"]')].filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.textContent),
        notInBar: ![...bar.querySelectorAll("button")].some((b) => ["Health", "Factory"].includes(b.textContent)),
      };
      inspector.querySelector(".inspector-fold").click();
      await wait(120);
      const unfolded = { folded: inspector.classList.contains("folded"), panes: [...inspector.querySelectorAll(".pane")].filter((p) => !p.hidden).map((p) => p.getAttribute("aria-label")), summaryHidden: summary.hidden };
      inspector.querySelector(".inspector-fold").click();
      await wait(120);
      return { folded, unfolded, foldedAgain: inspector.classList.contains("folded") };
    `);
    expect(r.folded).toMatchObject({
      isFolded: true,
      summaryShown: true,
      outOf100: false,
      trend: true,
      onRight: true,
      tabs: ["Health", "File", "Factory"],
      selected: ["Health"],
      notInBar: true,
    });
    expect((r.folded as { risks: number }).risks).toBe(3);
    expect((r.folded as { value: string }).value).toMatch(/\d.*%$/);
    expect(r.unfolded).toEqual({ folded: false, panes: ["Code health"], summaryHidden: true });
    expect(r.foldedAgain).toBe(true);
  });
});
