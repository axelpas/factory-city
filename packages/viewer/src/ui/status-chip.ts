import { el } from "../lib/dom";
import type { StatusChip, StatusDetails } from "../view/status";
import { POPOVER_CLASS } from "./popovers";

function section(title: string, ...children: Array<Node | undefined>): HTMLElement {
  return el("section", { class: "status-section" }, el("h4", { text: title }), ...children);
}

/**
 * The only text laid over the canvas outside the panels and the legend: the data level and the file count in
 * a chip. A click opens what the level gives, what the next one needs, what was left out and the warnings.
 */
export function renderStatusChip(
  box: HTMLElement,
  chip: StatusChip,
  details: StatusDetails,
  ...extra: HTMLElement[]
): void {
  const summary = el(
    "summary",
    { attrs: { "aria-label": `Data level and files: ${chip.label}, ${chip.files}. Open the details.` } },
    chip.warning
      ? el("span", { class: "status-mark", attrs: { role: "img", "aria-label": "Warnings" }, text: "!" })
      : undefined,
    el("b", { class: "status-level", text: chip.label }),
    el("span", { class: "muted", text: chip.files }),
  );
  const body = el(
    "div",
    { class: "status-body" },
    section("What this level gives", el("p", { text: details.gives })),
  );
  if (details.next) body.append(section("Next level", el("p", { text: details.next })));
  if (details.warnings.length > 0)
    body.append(
      section(
        "Warnings",
        el("ul", { class: "status-warnings" }, ...details.warnings.map((w) => el("li", { text: w }))),
      ),
    );
  if (details.leftOut.length > 0)
    body.append(
      section(
        "Left out",
        el(
          "ul",
          { class: "status-left-out" },
          ...details.leftOut.map((l) =>
            el("li", {}, el("span", { text: l.reason }), el("span", { class: "muted", text: l.count })),
          ),
        ),
        details.hint ? el("p", { class: "muted", text: details.hint }) : undefined,
      ),
    );
  if (details.coverage)
    body.append(
      section("Issue links", el("p", { text: details.coverage.text, title: details.coverage.detail })),
    );
  const popover = el("details", { class: `${POPOVER_CLASS} status-chip` }, summary, body);
  // redrawn at every frame: an open chip stays open
  popover.open = box.querySelector("details")?.open ?? false;
  box.replaceChildren(popover, ...extra);
}
