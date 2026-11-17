import type { Hotspot } from "@factory-city/schema";
import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import { type HealthView, type ProfileRow, trendPoints } from "../view/health";

const SVG = "http://www.w3.org/2000/svg";
const TREND_W = 300;

/** The risk levels of a bar: the key of the share, its style, and how people call it. */
const LEVELS = [
  ["low", "risk-low", "low"],
  ["moderate", "risk-moderate", "moderate"],
  ["high", "risk-high", "high"],
  ["veryHigh", "risk-very-high", "very high"],
] as const;

/** The score of each frame as a line, with a mark on the frame shown. */
function trendView(view: HealthView): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 -2 ${TREND_W} 40`);
  svg.setAttribute("class", "trend");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Score of each frame");
  const line = document.createElementNS(SVG, "polyline");
  line.setAttribute("points", trendPoints(view.trend, TREND_W, 36));
  const mark = document.createElementNS(SVG, "line");
  const x = String((view.frame / (view.trend.length - 1)) * TREND_W);
  mark.setAttribute("x1", x);
  mark.setAttribute("x2", x);
  mark.setAttribute("y1", "-2");
  mark.setAttribute("y2", "38");
  mark.setAttribute("class", "now");
  svg.append(line, mark);
  return svg;
}

/** What the frame did: the change of score and the hotspots created and resolved. */
function movementView(view: HealthView): HTMLElement[] {
  const m = view.movement;
  if (!m) return [];
  return [
    el("h3", { text: "This frame" }),
    el("p", {
      text: `Score ${m.qualityDelta}. Hotspots created: ${format.integer(m.created.length)}, resolved: ${format.integer(m.resolved.length)}.`,
    }),
  ];
}

/** One dimension: its bar of risk levels, its reading, and its thresholds on demand. */
function riskRow(row: ProfileRow): HTMLElement {
  const bar = el("div", {
    class: "risk-bar",
    attrs: { role: "img", "aria-label": `${row.label}: ${row.text}` },
  });
  for (const [key, cls, name] of LEVELS) {
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
  return el(
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
  );
}

function riskProfile(view: HealthView): HTMLElement[] {
  const out: HTMLElement[] = [
    el("h3", { text: "Risk profile" }),
    el("p", { class: "muted", text: "Share of code, by real lines, at each risk level." }),
    ...view.profile.map(riskRow),
    el(
      "p",
      { class: "risk-key muted" },
      ...LEVELS.flatMap(([, cls, name]) => [el("i", { class: cls }), ` ${name}  `]),
    ),
  ];
  if (view.unavailable.length)
    out.push(
      el("p", {
        class: "muted",
        text: `Not rated here: ${view.unavailable.join(", ")} (needs more data, or no code to rate).`,
      }),
    );
  return out;
}

/** A button that goes to a file of the city. */
function fileLink(path: string, onGoToFile: (path: string) => void): HTMLButtonElement {
  const b = el("button", { class: "link", text: path, title: `Go to ${path}`, attrs: { type: "button" } });
  b.addEventListener("click", () => onGoToFile(path));
  return b;
}

/** Which thresholds a hotspot exceeds, or why it ranks anyway. */
function exceededText(h: Hotspot): string {
  if (h.exceeded.length === 0) return "ranks by complexity and activity";
  return h.exceeded
    .map(
      (e) => `${e.dimension} ${e.level === "veryHigh" ? "very high" : e.level} (${format.number(e.value)})`,
    )
    .join(", ");
}

function hotspotView(h: Hotspot, onGoToFile: (path: string) => void): HTMLElement {
  return el(
    "div",
    { class: "hotspot" },
    el(
      "div",
      {},
      el("b", { text: `${h.rank}. ` }),
      fileLink(h.path, onGoToFile),
      el("span", { class: "muted", text: ` size ${h.size}` }),
    ),
    el("div", { class: "muted", text: exceededText(h) }),
    el("ul", {}, ...h.actions.map((a) => el("li", { text: a.text }))),
  );
}

function hotspotsView(view: HealthView, onGoToFile: (path: string) => void): HTMLElement[] {
  const out: HTMLElement[] = [el("h3", { text: "Hotspots" })];
  if (view.hotspotsFromLatest)
    out.push(
      el("p", {
        class: "muted",
        text: "Hotspots of this frame. Suggested actions are computed for the latest frame only.",
      }),
    );
  if (view.hotspots.length === 0) {
    if (view.hotspotPaths.length === 0) out.push(el("p", { class: "muted", text: "No hotspot." }));
    for (const path of view.hotspotPaths)
      out.push(el("div", { class: "hotspot" }, fileLink(path, onGoToFile)));
  }
  for (const h of view.hotspots.slice(0, 5)) out.push(hotspotView(h, onGoToFile));
  return out;
}

function hiddenLinksView(view: HealthView): HTMLElement[] {
  if (view.hiddenLinks.length === 0) return [];
  return [
    el("h3", { text: "Hidden links (experimental)" }),
    ...view.hiddenLinks.map((l) =>
      el("p", { class: "muted", text: `${l.files.join(" and ")}: ${l.detail}` }),
    ),
  ];
}

/** The score read without the security dimension, so that both can be compared. */
function withoutSecurityLine(view: HealthView): HTMLElement[] {
  if (!view.scoreWithoutSecurityText) return [];
  return [
    el("p", {
      class: "muted score-without",
      text: `Without security signals and scanner findings: ${view.scoreWithoutSecurityText}`,
      title:
        "The same score, with the security signals and the scanner findings left out of the rating of every file",
    }),
  ];
}

/** The Health tab: the score with its trend, the risk profile, the hotspots and the hidden links. */
export function renderHealthPanel(
  panel: HTMLElement,
  view: HealthView,
  onGoToFile: (path: string) => void,
): void {
  clear(panel);
  if (!view.available) {
    panel.append(el("p", { class: "muted", text: view.reason ?? "" }));
    return;
  }
  panel.append(
    el("div", { class: "score" }, el("b", { text: format.score(view.score) })),
    ...withoutSecurityLine(view),
    ...(view.trend.length > 1 ? [trendView(view)] : []),
    el("p", { class: "muted", text: view.notice }),
    ...movementView(view),
    ...riskProfile(view),
    ...hotspotsView(view, onGoToFile),
    ...hiddenLinksView(view),
  );
}
