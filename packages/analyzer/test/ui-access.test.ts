import { describe, expect, it } from "vitest";
import { canRender, inPage } from "./ui-helpers.js";

describe.skipIf(!canRender)("viewer interface in a real browser", () => {
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
});
