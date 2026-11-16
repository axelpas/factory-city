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

  it("gives every control and the canvas an accessible name, with nothing to report from the automated check", async () => {
    const r = await inPage<Record<string, unknown>>(`
      await wait(300);
      document.querySelector(".panel.rail button")?.click();
      window.factoryCity.selectFirstFile();
      key("h");
      await wait(300);
      // the accessible name, in the order the browsers compute it (enough for the controls of this page)
      const nameOf = (e) => {
        const label = e.getAttribute("aria-label");
        if (label) return label.trim();
        const by = e.getAttribute("aria-labelledby");
        if (by) return by.split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
        if (e.id) { const l = document.querySelector('label[for="' + e.id + '"]'); if (l) return l.textContent.trim(); }
        const wrapping = e.closest("label");
        if (wrapping) return wrapping.textContent.trim();
        if (e.tagName === "SUMMARY" || e.tagName === "BUTTON" || e.getAttribute("role") === "tab") {
          const text = e.textContent.trim();
          if (text) return text;
        }
        return (e.getAttribute("title") ?? "").trim();
      };
      const controls = [...document.querySelectorAll('button, input, select, textarea, summary, a[href], [role="slider"], [role="tab"], [tabindex="0"]')]
        .filter((e) => !e.closest("[hidden]") && e.getClientRects().length > 0);
      const unnamed = controls.filter((e) => nameOf(e) === "").map((e) => e.outerHTML.slice(0, 90));
      const canvas = document.querySelector(".stage canvas");
      const small = controls.filter((e) => { const b = box(e); return (b.w < 24 || b.h < 24) && !e.matches('input[type="checkbox"], input[type="radio"]') && !e.closest(".track"); }).map((e) => nameOf(e) + " " + Math.round(box(e).w) + "x" + Math.round(box(e).h));
      const focusRing = getComputedStyle(document.querySelector("button"), ":focus-visible").outlineStyle;
      const landmarks = ["header", "main", "aside", "footer", "nav", "section"].filter((t) => document.querySelector(t)).length;
      return {
        unnamed,
        canvasRole: canvas.getAttribute("role"),
        canvasName: canvas.getAttribute("aria-label") ?? "",
        canvasDescription: document.getElementById(canvas.getAttribute("aria-describedby") ?? "")?.textContent ?? "",
        small,
        landmarks,
        langSet: document.documentElement.lang !== "",
        titleSet: document.title !== "",
      };
    `);
    expect(r.unnamed).toEqual([]);
    expect(r.canvasRole).toBe("img");
    expect(r.canvasName).not.toBe("");
    expect(r.canvasDescription).toMatch(/files/);
    expect(r.small).toEqual([]);
    expect(r.langSet).toBe(true);
    expect(r.titleSet).toBe(true);
  });

  it("moves focus into the help, a menu and the inspector when they open, and gives it back when they close", async () => {
    const r = await inPage<Record<string, unknown>>(`
      await wait(300);
      const help = document.querySelector(".help");
      if (!help.hidden) { key("Escape"); await wait(60); }
      const helpButton = document.querySelector('button[title^="How to read"]');
      helpButton.focus();
      helpButton.click();
      await wait(60);
      const helpIn = help.contains(document.activeElement);
      key("Escape");
      await wait(60);
      const helpBack = document.activeElement === helpButton;

      const appearance = document.querySelector('summary[aria-label="Appearance"]');
      appearance.focus();
      appearance.click();
      await wait(80);
      const menuIn = appearance.parentElement.querySelector(".menu-list").contains(document.activeElement);
      key("Escape");
      await wait(80);
      const menuBack = document.activeElement === appearance;

      const health = document.querySelector(".inspector-fold");
      health.focus();
      health.click();
      await wait(80);
      const inspector = document.querySelector(".inspector");
      const inspectorIn = inspector.contains(document.activeElement);
      key("Escape");
      await wait(80);
      const inspectorBack = document.activeElement === health;
      return { helpIn, helpBack, menuIn, menuBack, inspectorIn, inspectorBack };
    `);
    expect(r).toEqual({
      helpIn: true,
      helpBack: true,
      menuIn: true,
      menuBack: true,
      inspectorIn: true,
      inspectorBack: true,
    });
  });

  it("lets a keyboard user find a file by name and open its details", async () => {
    const r = await inPage<Record<string, unknown>>(`
      await wait(300);
      key("/");
      await wait(80);
      const finder = document.querySelector(".finder");
      const input = finder.querySelector("input");
      const focusInField = document.activeElement === input;
      const all = finder.querySelectorAll('[role="option"]').length;
      input.value = "panel";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(40);
      const options = [...finder.querySelectorAll('[role="option"]')].map((o) => o.dataset.path);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await wait(150);
      const inspector = document.querySelector(".inspector");
      return {
        focusInField,
        all,
        options,
        closed: !finder.open,
        title: inspector.querySelector(".pane-title")?.textContent,
        inspectorShown: !inspector.classList.contains("folded"),
        focusInInspector: inspector.contains(document.activeElement),
        selected: window.factoryCity.selected() !== null,
      };
    `);
    expect(r.focusInField).toBe(true);
    expect(r.all).toBeGreaterThan(1);
    expect(r.options).toEqual(["src/ui/panel.ts"]);
    expect(r.closed).toBe(true);
    expect(r.title).toBe("panel.ts");
    expect(r.inspectorShown).toBe(true);
    expect(r.focusInInspector).toBe(true);
    expect(r.selected).toBe(true);
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

  it("shows a pointer cursor over a building and the default one elsewhere", async () => {
    const r = await inPage<Record<string, unknown>>(`
      await wait(300);
      const canvas = document.querySelector(".stage canvas");
      const box_ = box(canvas);
      const at = async (fx, fy) => {
        canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: box_.x + box_.w * fx, clientY: box_.y + box_.h * fy, bubbles: true, pointerId: 1 }));
        await wait(120);
        return { over: getComputedStyle(canvas).cursor === "pointer", cursor: getComputedStyle(canvas).cursor };
      };
      let onBuilding;
      // scan the picture until a building is under the pointer
      for (let fy = 0.3; fy < 0.7 && !onBuilding; fy += 0.05)
        for (let fx = 0.3; fx < 0.7 && !onBuilding; fx += 0.05) {
          const hit = await at(fx, fy);
          if (hit.over) onBuilding = hit;
        }
      const away = await at(0.02, 0.98);
      return { onBuilding, away };
    `);
    expect(r.onBuilding).toEqual({ over: true, cursor: "pointer" });
    expect((r.away as { cursor: string }).cursor).not.toBe("pointer");
  });

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

  it("lets the user choose the speed of the exported film and tells how long it will last", async () => {
    const r = await inPage<Record<string, unknown>>(`
      await wait(300);
      const menu = document.querySelector("details.export-menu");
      menu.querySelector("summary").click();
      await wait(100);
      const select = menu.querySelector('select[aria-label="Video speed"]');
      const length = () => menu.querySelector(".video-length").textContent;
      const normal = length();
      select.value = "2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const fast = length();
      select.value = "0.5";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return { options: [...select.options].map((o) => o.value), normal, fast, slow: length() };
    `);
    expect(r.options).toEqual(["0.5", "1", "2", "4"]);
    const seconds = (t: unknown) =>
      Number(
        /(\d+)(?: min (\d+))? s/
          .exec(String(t))
          ?.slice(1)
          .reduce((a, b, i) => a + Number(b ?? 0) * (i === 0 ? (String(t).includes("min") ? 60 : 1) : 1), 0),
      );
    expect(String(r.normal)).toMatch(/^Film length: about /);
    expect(seconds(r.fast)).toBeLessThan(seconds(r.normal));
    expect(seconds(r.slow)).toBeGreaterThan(seconds(r.normal));
  });

  // ----- the flows app.ts owns, one test each: they are the safety net for splitting it

  it("changes the preset with P and from the indicator list: question, legend and picker follow", async () => {
    const r = await inPage<Record<string, unknown>>(`
      await wait(300);
      const question = () => document.querySelector(".question").textContent;
      const picker = () => document.querySelector(".lens-menu > summary").textContent;
      const legend = () => [...document.querySelectorAll(".legend-line")].map((l) => l.getAttribute("data-channel") + ":" + l.querySelector("b").textContent).join("|");
      const before = { question: question(), picker: picker(), legend: legend() };
      key("p");
      await wait(900);
      const afterKey = { question: question(), picker: picker(), legend: legend() };
      document.querySelector(".lens-menu > summary").click();
      await wait(80);
      const options = [...document.querySelectorAll(".lens-list button:not(:disabled)")];
      const other = options.find((b) => !b.textContent.startsWith(picker()));
      other.click();
      await wait(900);
      return { before, afterKey, afterList: { question: question(), picker: picker() }, open: document.querySelector(".lens-menu").open };
    `);
    const b = r.before as { question: string; picker: string };
    const k = r.afterKey as { question: string; picker: string };
    const l = r.afterList as { question: string; picker: string };
    expect(k.picker).not.toBe(b.picker);
    expect(k.question).not.toBe(b.question);
    expect(l.picker).not.toBe(k.picker);
    expect(r.open).toBe(false);
  });

  it("plays and pauses with Space and moves frame by frame with the arrows", async () => {
    const r = await inPage<Record<string, unknown>>(`
      await wait(400);
      const label = () => document.querySelector(".frame-position").textContent;
      const play = document.querySelector('.transport button.primary');
      const start = { label: label(), play: play.getAttribute("aria-label") };
      key("ArrowLeft");
      await wait(1200);
      const back = label();
      key("ArrowRight");
      await wait(1200);
      const forward = label();
      key(" ");
      await wait(200);
      const playing = play.getAttribute("aria-label");
      key(" ");
      await wait(200);
      return { start, back, forward, playing, paused: play.getAttribute("aria-label") };
    `);
    const start = r.start as { label: string; play: string };
    expect(start.play).toBe("Play");
    expect(r.back).not.toBe(start.label);
    expect(r.forward).toBe(start.label);
    expect(r.playing).toBe("Pause");
    expect(r.paused).toBe("Play");
  });

  it("switches the theme with T and from the appearance menu, and keeps the choice", async () => {
    const r = await inPage<Record<string, unknown>>(`
      await wait(300);
      const bg = () => getComputedStyle(document.documentElement).getPropertyValue("--c-background").trim();
      const select = () => document.querySelector('select[aria-label="Theme"]');
      const first = { theme: select().value, bg: bg() };
      key("t");
      await wait(400);
      const second = { theme: select().value, bg: bg() };
      select().value = first.theme;
      select().dispatchEvent(new Event("change", { bubbles: true }));
      await wait(400);
      return { first, second, back: { theme: select().value, bg: bg() }, stored: localStorage.getItem("fc.theme") };
    `);
    const first = r.first as { theme: string; bg: string };
    const second = r.second as { theme: string; bg: string };
    expect(second.theme).not.toBe(first.theme);
    expect(second.bg).not.toBe("");
    expect(r.back).toEqual(first);
    expect(r.stored).toBe(first.theme);
  });

  it("resets the camera and takes a top view without breaking the picture", async () => {
    const r = await inPage<Record<string, unknown>>(`
      await wait(300);
      key("v");
      await wait(200);
      const top = window.factoryCity.capture(320, 200, false);
      key("r");
      await wait(200);
      const reset = window.factoryCity.capture(320, 200, false);
      return { top: top?.startsWith("data:image/png;base64,"), reset: reset?.startsWith("data:image/png;base64,"), different: top !== reset };
    `);
    expect(r).toEqual({ top: true, reset: true, different: true });
  });

  it("exports a picture of the frame asked for, with or without the overlay", async () => {
    const r = await inPage<Record<string, unknown>>(`
      await wait(400);
      const first = window.factoryCity.capture(480, 300, true, 0);
      // the sample has three frames; the playhead stays where the last picture put it
      const last = window.factoryCity.capture(480, 300, true, 2);
      const plain = window.factoryCity.capture(480, 300, false);
      return { first: first?.startsWith("data:image/png"), differsByFrame: first !== last, overlayChangesPicture: last !== plain };
    `);
    expect(r).toEqual({ first: true, differsByFrame: true, overlayChangesPicture: true });
  });
});
