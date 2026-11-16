import { el } from "../lib/dom";
import { DEFAULT_THEME, THEMES, type Theme, themeById } from "../themes/index";
import { icon } from "./icons";
import { POPOVER_CLASS } from "./popovers";

export type MotionSetting = "auto" | "full" | "reduced";

/** What the menu changes of the page, and what it reads of it. */
export interface AppearanceHost {
  theme(): Theme;
  setTheme(theme: Theme): void;
  /** The motion setting changed. */
  onMotion(): void;
  setDistrictNames(on: boolean): void;
  setGlow(on: boolean): void;
  /** A choice was made: remember it (name and value). */
  remember(key: "motion" | "districtNames", value: string): void;
}

/**
 * The Appearance menu: the theme, how much things move, the names of the districts and, for a theme that has
 * one, the glow around the edges. None of it carries data. It keeps these settings.
 */
export class AppearanceMenu {
  readonly element = el("details", { class: `${POPOVER_CLASS} menu` });
  motion: MotionSetting;
  districtNames: boolean;
  glow = true;
  private readonly list = el("div", { class: "menu-list" });
  private readonly themeSelect = el("select", {
    title: "Theme: the look changes, the data and the legend stay the same (T)",
    attrs: { "aria-label": "Theme" },
  });

  constructor(
    private readonly host: AppearanceHost,
    initial: { motion: MotionSetting; districtNames: boolean },
  ) {
    this.motion = initial.motion;
    this.districtNames = initial.districtNames;
    for (const t of THEMES) {
      const o = el("option", { text: t.label, attrs: { value: t.id } });
      if (t.id === host.theme().id) o.selected = true;
      this.themeSelect.append(o);
    }
    this.themeSelect.addEventListener("change", () =>
      host.setTheme(themeById(this.themeSelect.value) ?? DEFAULT_THEME),
    );
    this.element.append(
      el(
        "summary",
        {
          class: "icon quiet",
          title: "Appearance: theme (T: next theme) and motion",
          attrs: { "aria-label": "Appearance" },
        },
        icon("appearance"),
      ),
      this.list,
    );
    this.render();
  }

  /** The theme changed (from here or from a key): show it in the select and offer its own effects. */
  showTheme(theme: Theme): void {
    this.themeSelect.value = theme.id;
    this.render();
  }

  private render(): void {
    const motion = el("select", {
      title: "Auto follows your system's reduced-motion setting",
      attrs: { "aria-label": "Motion" },
    });
    for (const [value, label] of [
      ["auto", "auto"],
      ["full", "full"],
      ["reduced", "reduced"],
    ] as const) {
      const o = el("option", { text: label, attrs: { value } });
      if (value === this.motion) o.selected = true;
      motion.append(o);
    }
    motion.addEventListener("change", () => {
      this.motion = motion.value as MotionSetting;
      this.host.remember("motion", this.motion);
      this.host.onMotion();
    });
    this.list.replaceChildren(
      el("label", { class: "field" }, el("span", { text: "Theme" }), this.themeSelect),
      el("label", { class: "field" }, el("span", { text: "Motion" }), motion),
    );
    const names = el("input", { attrs: { type: "checkbox" } });
    names.checked = this.districtNames;
    names.addEventListener("change", () => {
      this.districtNames = names.checked;
      this.host.remember("districtNames", this.districtNames ? "on" : "off");
      this.host.setDistrictNames(this.districtNames);
    });
    this.list.append(
      el(
        "label",
        { class: "check", title: "Write the name of the districts on the ground" },
        names,
        " district names",
      ),
    );
    if (this.host.theme().effects?.glow) {
      const glow = el("input", { attrs: { type: "checkbox" } });
      glow.checked = this.glow;
      glow.addEventListener("change", () => {
        this.glow = glow.checked;
        this.host.setGlow(this.glow);
      });
      this.list.append(
        el(
          "label",
          { class: "check", title: "A soft glow around the edges; it carries no data" },
          glow,
          " edge glow",
        ),
      );
    }
  }
}
