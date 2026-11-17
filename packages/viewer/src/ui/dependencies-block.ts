import { el } from "../lib/dom";
import type { DependenciesView } from "../view/dependencies";

/** The Dependencies block of the Health tab: known vulnerabilities of the lockfile, per project. */
export function dependenciesBlock(view: DependenciesView): HTMLElement {
  return el(
    "section",
    { class: "dependencies" },
    el("h4", { text: "Dependencies" }),
    el("p", { class: "muted", text: view.checked }),
    view.clean
      ? el("p", { text: "No known vulnerability for these versions." })
      : el(
          "ul",
          { class: "dep-counts" },
          ...view.counts.map((c) => el("li", { class: `dep-${c.severity}`, text: `${c.value} ${c.label}` })),
        ),
    ...(view.affected.length > 0
      ? [
          el(
            "ul",
            { class: "dep-affected" },
            ...view.affected.map((a) => el("li", { text: `${a.label}: ${a.advisories}` })),
          ),
        ]
      : []),
    ...(view.more > 0 ? [el("p", { class: "muted", text: `and ${view.more} more.` })] : []),
    el("p", {
      class: "muted",
      text: "Not part of the score. A listed advisory may not apply to how the package is used.",
    }),
  );
}
