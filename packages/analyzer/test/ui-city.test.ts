import { describe, expect, it } from "vitest";
import { canRender, inPage } from "./ui-helpers.js";

describe.skipIf(!canRender)("viewer interface in a real browser", () => {
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
      await wait(2200);
      const back = label();
      key("ArrowRight");
      await wait(2200);
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
