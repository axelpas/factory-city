import { el } from "../lib/dom";
import type { PresetStatus } from "../presets/index";
import { icon } from "./icons";

/** The order of the groups in the picker. */
const GROUPS = ["Code", "History", "Factory", "Compare"];

const LEVEL_NEEDS: Record<number, string> = {
  1: "Needs git history.",
  2: "Needs issue data from GitHub.",
  3: "Needs a facts file.",
};

export interface LensItem {
  id: string;
  label: string;
  question: string;
  experimental: boolean;
  available: boolean;
  /** Why the preset cannot be chosen, in a few words. */
  needs?: string;
}

export interface LensGroup {
  name: string;
  items: LensItem[];
}

/**
 * The presets as the picker shows them: grouped, each with the question it answers, and for the ones that
 * cannot be shown the reason in a few words (what the data lacks rather than which metric is missing).
 */
export function lensGroups(statuses: readonly PresetStatus[], dataLevel: number): LensGroup[] {
  const names = [...GROUPS, ...statuses.map((s) => s.preset.group).filter((g) => !GROUPS.includes(g))];
  const groups: LensGroup[] = [];
  for (const name of new Set(names)) {
    const items = statuses
      .filter((s) => s.preset.group === name)
      .map((s): LensItem => {
        const level = LEVEL_NEEDS[s.preset.level];
        const needs = s.available
          ? undefined
          : (s.preset.needs ??
            (s.preset.level > dataLevel && level ? level : (s.reason ?? "Not available.")));
        return {
          id: s.preset.id,
          label: s.preset.label,
          question: s.preset.question,
          experimental: s.preset.experimental ?? false,
          available: s.available,
          ...(needs ? { needs } : {}),
        };
      });
    if (items.length > 0) groups.push({ name, items });
  }
  return groups;
}

/** The label of the picker's button: the preset in force, or "Custom" once a channel was changed by hand. */
export function renderLensButton(summary: HTMLElement, label: string): void {
  summary.replaceChildren(el("span", { class: "lens-name", text: label }), icon("chevron"));
}

/** Fills the list of the picker. Unavailable presets are shown, disabled, with what they need. */
export function renderLensList(
  list: HTMLElement,
  groups: readonly LensGroup[],
  current: string | undefined,
  onChoose: (id: string) => void,
): void {
  list.replaceChildren();
  for (const group of groups) {
    list.append(el("div", { class: "menu-group", text: group.name }));
    for (const item of group.items) {
      const button = el(
        "button",
        {
          class: "lens-item",
          title: item.available ? item.question : (item.needs ?? ""),
          attrs: { type: "button", "data-preset": item.id },
        },
        el(
          "span",
          { class: "lens-item-name" },
          item.label,
          item.experimental ? el("i", { class: "badge", text: "experimental" }) : null,
        ),
        el("span", { class: "lens-item-text", text: item.available ? item.question : (item.needs ?? "") }),
      );
      button.disabled = !item.available;
      if (item.id === current) button.setAttribute("aria-current", "true");
      button.addEventListener("click", () => onChoose(item.id));
      list.append(button);
    }
  }
}
