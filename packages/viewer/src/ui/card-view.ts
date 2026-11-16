import { el } from "../lib/dom";
import { format } from "../lib/format";
import type { CardRow, FileCard, FolderCard } from "../view/card";

/** One line of a card or of the details: a label, a value, and where the value stands in the city. */
export function rowView(r: CardRow): HTMLElement {
  const marker =
    r.marker !== undefined
      ? el(
          "span",
          { class: "scale", title: `Higher than ${format.percent(r.marker)} of files` },
          el("i", { style: { left: `${Math.round(r.marker * 100)}%` } }),
        )
      : undefined;
  return el(
    "div",
    { class: "kv", title: r.note },
    el("span", { class: "k", text: r.label }),
    el("span", { class: r.value === "n/a" ? "v na" : "v", text: r.value }),
    marker,
    r.note && r.value === "n/a" ? el("span", { class: "note", text: r.note }) : undefined,
  );
}

export function fileCardView(c: FileCard, changes: CardRow[] = []): HTMLElement {
  return el(
    "div",
    {},
    el("div", { class: "card-title", text: c.title }),
    el("div", { class: "muted", text: c.folder }),
    el("div", { class: "muted", text: `${c.language}${c.isTest ? " · test" : ""}` }),
    ...c.channels.map((r) => rowView(r)),
    c.facts.length || changes.length ? el("hr") : undefined,
    ...c.facts.map((r) => rowView({ ...r, marker: undefined })),
    ...changes.map((r) => rowView(r)),
    el("div", { class: "hint", text: c.hint }),
  );
}

export function folderCardView(c: FolderCard): HTMLElement {
  return el(
    "div",
    {},
    el("div", { class: "card-title", text: c.title }),
    el("div", { class: "muted", text: c.path }),
    ...c.rows.map((r) => rowView(r)),
    c.worst.length ? el("div", { class: "muted", text: "Most complex files" }) : undefined,
    ...c.worst.map((w) =>
      el(
        "div",
        { class: "kv" },
        el("span", { class: "k", text: w.path }),
        el("span", { class: "v", text: w.value }),
      ),
    ),
  );
}
