import { el } from "../lib/dom";
import { format } from "../lib/format";
import type { CardRow } from "../view/card";
import type { DetailRow, FileDetails } from "../view/details";
import { rowView } from "./card-view";

export interface FileDetailsInput {
  details: FileDetails;
  /** The path as a trail of folders. */
  trail: HTMLElement;
  /** What the frame shown did to the file. */
  changes: CardRow[];
  /** The frames that added or modified the file, oldest first (the frame info of each). */
  touching: Array<{ label: string; date: string; index: number }>;
  /** True when the data is a timeline: the history of the file is then worth showing. */
  timeline: boolean;
  onGoToFrame(index: number): void;
}

function detailRow(r: DetailRow): HTMLElement {
  return el(
    "div",
    { class: "kv", title: r.title, attrs: { "data-metric": r.id } },
    el("span", { class: "k", text: r.label }),
    el("span", { class: "v", text: r.value }),
    r.rank !== undefined
      ? el(
          "span",
          { class: "rank", title: `Higher than ${format.percent(r.rank)} of the files` },
          el("i", { style: { width: `${Math.round(r.rank * 100)}%` } }),
        )
      : undefined,
  );
}

/** A button that puts the path of the file on the clipboard. */
function copyButton(path: string): HTMLButtonElement {
  const copy = el("button", {
    class: "quiet copy",
    text: "Copy path",
    title: "Copy the path of the file",
    attrs: { type: "button" },
  });
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(path).then(() => {
      copy.textContent = "Copied";
      setTimeout(() => {
        copy.textContent = "Copy path";
      }, 1500);
    });
  });
  return copy;
}

/** One group of metrics: a heading and its rows, or, for a list of zeros, one line that opens on them. */
function groupView(group: FileDetails["groups"][number]): HTMLElement[] {
  if (!group.allZero)
    return [
      el("h3", { text: group.name, attrs: { "data-group": group.name } }),
      ...group.rows.map(detailRow),
    ];
  // a list of zeros says one thing: say it once, and keep the list one click away
  return [
    el(
      "details",
      { class: "zero-group", attrs: { "data-group": group.name } },
      el(
        "summary",
        {},
        el("b", { class: "zero-name", text: group.name }),
        el("span", { class: "muted", text: group.zeroText }),
      ),
      ...group.rows.map(detailRow),
    ),
  ];
}

/** The frames that changed the file, newest first, each a way to jump there. */
function historyView(input: FileDetailsInput): HTMLElement {
  if (input.touching.length === 0)
    return el("p", { class: "muted", text: "No frame of this timeline changed this file." });
  const history = el("div", { class: "kvs" });
  for (const f of input.touching.slice(-30).reverse()) {
    const jump = el("button", {
      class: "link",
      text: f.label,
      title: "Go to this frame",
      attrs: { type: "button" },
    });
    jump.addEventListener("click", () => input.onGoToFrame(f.index));
    history.append(
      el("div", { class: "kv" }, jump, el("span", { class: "muted", text: format.date(f.date) })),
    );
  }
  return history;
}

/** Fills the File tab: the path, the risks, what the city shows, what the frame did, every metric by family. */
export function renderFileDetails(container: HTMLElement, input: FileDetailsInput): void {
  const d = input.details;
  container.append(
    el("h2", { class: "pane-title", text: d.title }),
    el("div", { class: "pane-path" }, input.trail, copyButton(d.path)),
    el("div", { class: "muted", text: `${d.language}${d.isTest ? " · test file" : ""}` }),
    ...(d.risks.length ? [el("p", { class: "risks", text: d.risks.join(" · ") })] : []),
    el("h3", { text: "Shown in the city" }),
    ...d.channels.map((r) => rowView(r)),
  );
  if (input.changes.length)
    container.append(el("h3", { text: "This frame" }), ...input.changes.map((r) => rowView(r)));
  for (const group of d.groups) container.append(...groupView(group));
  if (d.unavailable.length)
    container.append(
      el("h3", { text: "Not available for this file" }),
      ...d.unavailable.map((u) =>
        el(
          "div",
          { class: "kv" },
          el("span", { class: "k", text: u.label }),
          el("span", { class: "v na", text: "n/a" }),
          el("span", { class: "note", text: u.note }),
        ),
      ),
    );
  if (input.timeline) container.append(el("h3", { text: "Frames that changed it" }), historyView(input));
}
