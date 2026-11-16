import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import type { FactoryView } from "../view/factory";
import { type HealthView, trendPoints } from "../view/health";

/** The Health tab: the score with its trend, the risk profile, the hotspots and the hidden links. */
export function renderHealthPanel(
  panel: HTMLElement,
  view: HealthView,
  onGoToFile: (path: string) => void,
): void {
  clear(panel);
  clear(panel);
  if (!view.available) {
    panel.append(el("p", { class: "muted", text: view.reason ?? "" }));
    return;
  }
  panel.append(el("div", { class: "score" }, el("b", { text: format.score(view.score) })));
  if (view.trend.length > 1) {
    const points = trendPoints(view.trend, 300, 36);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 -2 300 40");
    svg.setAttribute("class", "trend");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Score of each frame");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", points);
    const mark = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const x = String((view.frame / (view.trend.length - 1)) * 300);
    mark.setAttribute("x1", x);
    mark.setAttribute("x2", x);
    mark.setAttribute("y1", "-2");
    mark.setAttribute("y2", "38");
    mark.setAttribute("class", "now");
    svg.append(line, mark);
    panel.append(svg);
  }
  panel.append(el("p", { class: "muted", text: view.notice }));
  if (view.movement) {
    const m = view.movement;
    panel.append(
      el("h3", { text: "This frame" }),
      el("p", {
        text: `Score ${m.qualityDelta}. Hotspots created: ${format.integer(m.created.length)}, resolved: ${format.integer(m.resolved.length)}.`,
      }),
    );
  }
  panel.append(
    el("h3", { text: "Risk profile" }),
    el("p", { class: "muted", text: "Share of code, by real lines, at each risk level." }),
  );
  const levels = [
    ["low", "risk-low", "low"],
    ["moderate", "risk-moderate", "moderate"],
    ["high", "risk-high", "high"],
    ["veryHigh", "risk-very-high", "very high"],
  ] as const;
  for (const row of view.profile) {
    const bar = el("div", {
      class: "risk-bar",
      attrs: { role: "img", "aria-label": `${row.label}: ${row.text}` },
    });
    for (const [key, cls, name] of levels) {
      const share = row.share[key];
      if (share <= 0) continue;
      bar.append(
        el("i", {
          class: cls,
          title: `${name}: ${format.percent(share)}`,
          style: { width: `${share * 100}%` },
        }),
      );
    }
    panel.append(
      el(
        "details",
        { class: "risk" },
        el(
          "summary",
          {},
          el("span", { class: "risk-name", text: row.label }),
          bar,
          el("span", { class: "muted risk-text", text: row.text }),
        ),
        el("p", { class: "muted", text: row.thresholds }),
      ),
    );
  }
  panel.append(
    el(
      "p",
      { class: "risk-key muted" },
      ...levels.flatMap(([, cls, name]) => [el("i", { class: cls }), ` ${name}  `]),
    ),
  );
  if (view.unavailable.length) {
    panel.append(
      el("p", {
        class: "muted",
        text: `Not rated here: ${view.unavailable.join(", ")} (needs more data, or no code to rate).`,
      }),
    );
  }
  panel.append(el("h3", { text: "Hotspots" }));
  if (view.hotspotsFromLatest) {
    panel.append(
      el("p", {
        class: "muted",
        text: "Hotspots of this frame. Suggested actions are computed for the latest frame only.",
      }),
    );
  }
  const link = (path: string) => {
    const b = el("button", {
      class: "link",
      text: path,
      title: `Go to ${path}`,
      attrs: { type: "button" },
    });
    b.addEventListener("click", () => onGoToFile(path));
    return b;
  };
  if (view.hotspots.length === 0) {
    if (view.hotspotPaths.length === 0) panel.append(el("p", { class: "muted", text: "No hotspot." }));
    for (const path of view.hotspotPaths) panel.append(el("div", { class: "hotspot" }, link(path)));
  }
  for (const h of view.hotspots.slice(0, 5)) {
    panel.append(
      el(
        "div",
        { class: "hotspot" },
        el(
          "div",
          {},
          el("b", { text: `${h.rank}. ` }),
          link(h.path),
          el("span", { class: "muted", text: ` size ${h.size}` }),
        ),
        el("div", {
          class: "muted",
          text: h.exceeded.length
            ? h.exceeded
                .map(
                  (e) =>
                    `${e.dimension} ${e.level === "veryHigh" ? "very high" : e.level} (${format.number(e.value)})`,
                )
                .join(", ")
            : "ranks by complexity and activity",
        }),
        el("ul", {}, ...h.actions.map((a) => el("li", { text: a.text }))),
      ),
    );
  }
  if (view.hiddenLinks.length) {
    panel.append(el("h3", { text: "Hidden links (experimental)" }));
    for (const l of view.hiddenLinks)
      panel.append(el("p", { class: "muted", text: `${l.files.join(" and ")}: ${l.detail}` }));
  }
}

/** The Factory tab: the KPIs of a period, the comparison by group and the lists of issues to look at. */
export function renderFactoryPanel(
  panel: HTMLElement,
  view: FactoryView,
  handlers: { onPeriod(period: "last30" | "all"): void; onGoToFrame(frame: number): void },
): void {
  clear(panel);
  clear(panel);
  if (!view.available) {
    panel.append(el("p", { class: "muted", text: view.reason ?? "" }));
    return;
  }
  panel.append(el("p", { class: "muted", text: view.notice }));
  const period = el("select", { title: "Period of the KPIs", attrs: { "aria-label": "Period" } });
  for (const p of view.periods) {
    const o = el("option", {
      text: `${p.label} (${format.integer(p.issues)} issues)`,
      attrs: { value: p.id },
    });
    if (p.id === view.period) o.selected = true;
    period.append(o);
  }
  period.addEventListener("change", () => {
    handlers.onPeriod(period.value as "last30" | "all");
  });
  panel.append(period);
  const hasPrevious = view.kpis.some((k) => k.previous !== undefined);
  for (const k of view.kpis) {
    panel.append(
      el(
        "div",
        { class: "kpi", title: k.definition },
        el(
          "span",
          { class: "k" },
          k.label,
          k.experimental ? el("i", { class: "badge", text: "experimental" }) : undefined,
        ),
        el("span", { class: k.value === "n/a" ? "v na" : "v", text: k.value }),
        el(
          "span",
          { class: "note" },
          k.reason ? `${k.reason} · ` : "",
          k.sample,
          hasPrevious && k.previous !== undefined ? ` · previous period: ${k.previous}` : "",
        ),
      ),
    );
  }
  if (view.hidden) panel.append(el("p", { class: "muted", text: view.hidden }));
  for (const g of view.groups) {
    if (g.rows.length === 0) {
      const sizes = g.columns.map((c) => `${c.value}: ${format.integer(c.issues)}`).join(", ");
      panel.append(
        el("p", {
          class: "muted",
          text: `By ${g.name}: no group has 10 issues yet (${sizes}), too few to compare.`,
        }),
      );
      continue;
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
      table.append(
        el("tr", {}, el("td", { text: row.label }), ...row.cells.map((c) => el("td", { text: c }))),
      );
    panel.append(table);
    if (g.warn)
      panel.append(
        el("p", {
          class: "muted",
          text: "Groups under 10 issues are too small to compare: their values are not shown.",
        }),
      );
  }
  for (const list of view.lists) {
    panel.append(el("h3", { text: list.title }));
    for (const line of list.lines) {
      const go = el("button", {
        class: "link",
        text: line.label,
        title: "Go to this frame",
        attrs: { type: "button" },
      });
      go.addEventListener("click", () => handlers.onGoToFrame(line.frame));
      panel.append(
        el("div", { class: "kv" }, go, el("span", { class: "v", text: format.number(line.value, 2) })),
      );
    }
  }
}
