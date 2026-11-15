import { describe, expect, it } from "vitest";
import { canRender, inPage } from "./ui-helpers.js";

describe.skipIf(!canRender)("viewer interface in a real browser", () => {
  it("opens the help of a channel as a popover: the row keeps its layout", async () => {
    const r = await inPage<{
      before: number;
      after: number;
      open: boolean;
      button: { w: number; h: number };
    }>(`
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
      const help = document.querySelector(".picker details.metric-help");
      const menu = document.querySelector("details.menu");
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
      const menu = document.querySelector("details.menu");
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
