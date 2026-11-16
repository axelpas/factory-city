import { el } from "../lib/dom";
import type { Mapping } from "../presets/index";
import { SCALE_KINDS, type ScaleKind } from "../view/scales";

export type TestsMode = "show" | "dim" | "hide";

/** The filter of the panel: a search by path or glob, and what to do with the test files. */
export interface FilterState {
  search: string;
  tests: TestsMode;
}

/** The search by path or glob. */
export function searchBox(s: FilterState, onChange: () => void): HTMLInputElement {
  const search = el("input", {
    attrs: {
      type: "search",
      placeholder: "Search path or glob: src/**/*.ts",
      "aria-label": "Search by path or glob",
    },
    title: "Plain text matches anywhere in the path; * and ? make it a glob",
  });
  search.value = s.search;
  search.addEventListener("input", () => {
    s.search = search.value;
    onChange();
  });
  return search;
}

/** Show, dim or hide the test files. */
export function testsChoice(s: FilterState, onChange: () => void): HTMLElement {
  const tests = el("div", {
    class: "segmented",
    title: "Test files: show, dim or hide",
    attrs: { role: "group", "aria-label": "Test files" },
  });
  for (const mode of ["show", "dim", "hide"] as const) {
    const b = el("button", {
      text: mode,
      attrs: { type: "button", "aria-pressed": String(mode === s.tests) },
    });
    b.addEventListener("click", () => {
      s.tests = mode;
      for (const other of tests.children) other.setAttribute("aria-pressed", String(other === b));
      onChange();
    });
    tests.append(b);
  }
  return el("div", { class: "row" }, el("label", { text: "Tests" }), tests);
}

/** How values become heights, and whether outliers are clamped. */
export function scaleControls(
  mapping: Mapping,
  setMapping: (patch: Partial<Mapping>) => void,
): HTMLElement[] {
  const scale = el("select", { title: "How values become heights", attrs: { "aria-label": "Height scale" } });
  for (const kind of SCALE_KINDS) {
    const o = el("option", { text: kind, attrs: { value: kind } });
    if (kind === mapping.scale) o.selected = true;
    scale.append(o);
  }
  scale.addEventListener("change", () => setMapping({ scale: scale.value as ScaleKind }));
  const clamp = el("input", { attrs: { type: "checkbox" } });
  clamp.checked = mapping.clampP99;
  clamp.addEventListener("change", () => setMapping({ clampP99: clamp.checked }));
  return [
    el(
      "div",
      { class: "row" },
      el("label", { text: "Scale", title: "Linear, square root or logarithmic" }),
      scale,
    ),
    el(
      "label",
      {
        class: "check",
        title:
          "Values above the 99th percentile all get the maximum, so one outlier does not flatten the city",
      },
      clamp,
      " clamp outliers (99th percentile)",
    ),
  ];
}
