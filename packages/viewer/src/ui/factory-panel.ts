import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import type { FactoryView } from "../view/factory";

type Kpi = FactoryView["kpis"][number];
type Group = FactoryView["groups"][number];
type IssueList = FactoryView["lists"][number];

/** The choice of period: the KPIs and the lists follow it. */
function periodSelect(view: FactoryView, onPeriod: (period: "last30" | "all") => void): HTMLSelectElement {
  const period = el("select", { title: "Period of the KPIs", attrs: { "aria-label": "Period" } });
  for (const p of view.periods) {
    const o = el("option", {
      text: `${p.label} (${format.integer(p.issues)} issues)`,
      attrs: { value: p.id },
    });
    if (p.id === view.period) o.selected = true;
    period.append(o);
  }
  period.addEventListener("change", () => onPeriod(period.value as "last30" | "all"));
  return period;
}

function kpiRow(k: Kpi, hasPrevious: boolean): HTMLElement {
  const previous = hasPrevious && k.previous !== undefined ? ` · previous period: ${k.previous}` : "";
  return el(
    "div",
    { class: "kpi", title: k.definition },
    el(
      "span",
      { class: "k" },
      k.label,
      k.experimental ? el("i", { class: "badge", text: "experimental" }) : undefined,
    ),
    el("span", { class: k.value === "n/a" ? "v na" : "v", text: k.value }),
    el("span", { class: "note" }, k.reason ? `${k.reason} · ` : "", k.sample, previous),
  );
}

/** A comparison by agent, model, kind or estimate: a table, or why there is none yet. */
function groupView(g: Group): HTMLElement[] {
  if (g.rows.length === 0) {
    const sizes = g.columns.map((c) => `${c.value}: ${format.integer(c.issues)}`).join(", ");
    return [
      el("p", {
        class: "muted",
        text: `By ${g.name}: no group has 10 issues yet (${sizes}), too few to compare.`,
      }),
    ];
  }
  const table = el("table", { class: "groups" });
  table.append(
    el(
      "tr",
      {},
      el("th", { text: `By ${g.name}` }),
      ...g.columns.map((c) => el("th", { text: `${c.value} (${format.integer(c.issues)})` })),
    ),
  );
  for (const row of g.rows)
    table.append(el("tr", {}, el("td", { text: row.label }), ...row.cells.map((c) => el("td", { text: c }))));
  const note = g.warn
    ? [
        el("p", {
          class: "muted",
          text: "Groups under 10 issues are too small to compare: their values are not shown.",
        }),
      ]
    : [];
  return [table, ...note];
}

/** The issues to look at, worst first, each a way to jump to its frame. */
function issueList(list: IssueList, onGoToFrame: (frame: number) => void): HTMLElement[] {
  const lines = list.lines.map((line) => {
    const go = el("button", {
      class: "link",
      text: line.label,
      title: "Go to this frame",
      attrs: { type: "button" },
    });
    go.addEventListener("click", () => onGoToFrame(line.frame));
    return el("div", { class: "kv" }, go, el("span", { class: "v", text: format.number(line.value, 2) }));
  });
  return [el("h3", { text: list.title }), ...lines];
}

/** The Factory tab: the KPIs of a period, the comparison by group and the lists of issues to look at. */
export function renderFactoryPanel(
  panel: HTMLElement,
  view: FactoryView,
  handlers: { onPeriod(period: "last30" | "all"): void; onGoToFrame(frame: number): void },
): void {
  clear(panel);
  if (!view.available) {
    panel.append(el("p", { class: "muted", text: view.reason ?? "" }));
    return;
  }
  const hasPrevious = view.kpis.some((k) => k.previous !== undefined);
  panel.append(
    el("p", { class: "muted", text: view.notice }),
    periodSelect(view, handlers.onPeriod),
    ...view.kpis.map((k) => kpiRow(k, hasPrevious)),
    ...(view.hidden ? [el("p", { class: "muted", text: view.hidden })] : []),
    ...view.groups.flatMap(groupView),
    ...view.lists.flatMap((l) => issueList(l, handlers.onGoToFrame)),
  );
}
