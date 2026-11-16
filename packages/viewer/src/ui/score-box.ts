import { el } from "../lib/dom";
import { format } from "../lib/format";
import { type HealthView, trendPoints } from "../view/health";
import { POPOVER_CLASS } from "./popovers";

const SVG = "http://www.w3.org/2000/svg";
const TREND_W = 280;
const TREND_H = 34;
/** The dimensions listed in the box: the ones with the largest share of code at high risk. */
const TOP_DIMENSIONS = 3;

/**
 * The code-health score, always in view at the top right: a number and its change, which opens on the trend,
 * the risk it comes from, and the way to the full report. The number follows the playhead.
 */
export class ScoreBox {
  readonly element = el("details", { class: `${POPOVER_CLASS} menu score-box`, attrs: { hidden: "" } });
  private readonly value = el("b", { class: "score-value" });
  private readonly delta = el("span", { class: "score-delta muted" });
  private readonly body = el("div", { class: "menu-list score-body" });
  private shown = Number.NaN;

  /** `report` is the button that opens the full report: it lives in the box, and the app owns it. */
  constructor(private readonly report: HTMLElement) {
    this.element.append(
      el(
        "summary",
        {
          title: "Code-health score of the frame shown (H: full report)",
          attrs: { "aria-label": "Code health" },
        },
        el("span", { class: "score-label", text: "Health" }),
        this.value,
        this.delta,
      ),
      this.body,
    );
  }

  /** The score under the playhead: cheap, called at every image. */
  setScore(score: number | undefined): void {
    if (score === undefined || !Number.isFinite(score)) return;
    const rounded = Math.round(score * 10) / 10;
    if (rounded === this.shown) return;
    this.shown = rounded;
    this.value.textContent = format.number(rounded, 1);
  }

  /** What the box says for the frame shown: the change, the trend, the main risks. Called when the frame changes. */
  render(view: HealthView, position: number): void {
    this.element.hidden = !view.available;
    if (!view.available) return;
    this.setScore(view.score);
    const change = view.movement?.qualityDelta;
    this.delta.textContent = change && change !== "unchanged" ? change : "";
    this.delta.title = change ? `Change since the previous frame: ${change}` : "";

    const parts: Array<Node> = [
      el(
        "div",
        { class: "score" },
        el("b", { text: format.number(view.score, 1) }),
        el("span", { class: "muted", text: " out of 100" }),
      ),
    ];
    if (view.trend.length > 1) {
      const svg = document.createElementNS(SVG, "svg");
      svg.setAttribute("viewBox", `0 0 ${TREND_W} ${TREND_H}`);
      svg.setAttribute("class", "score-trend");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Score over the frames");
      const line = document.createElementNS(SVG, "polyline");
      line.setAttribute("points", trendPoints(view.trend, TREND_W, TREND_H));
      const now = document.createElementNS(SVG, "line");
      const x = (position / (view.trend.length - 1)) * TREND_W;
      now.setAttribute("x1", String(x));
      now.setAttribute("x2", String(x));
      now.setAttribute("y1", "0");
      now.setAttribute("y2", String(TREND_H));
      now.setAttribute("class", "now");
      svg.append(line, now);
      parts.push(svg);
    }
    const risks = [...view.profile]
      .sort((a, b) => b.share.high + b.share.veryHigh - (a.share.high + a.share.veryHigh))
      .slice(0, TOP_DIMENSIONS);
    if (risks.length > 0)
      parts.push(
        el(
          "div",
          { class: "score-risks" },
          ...risks.map((r) =>
            el(
              "div",
              { class: "kv", title: r.thresholds },
              el("span", { class: "k", text: r.label }),
              el("span", { class: "v", text: format.percent(r.share.high + r.share.veryHigh) }),
            ),
          ),
          el("p", { class: "muted score-caption", text: "Share of code at high or very high risk." }),
        ),
      );
    parts.push(el("p", { class: "muted score-caption", text: view.notice }), this.report);
    this.body.replaceChildren(...parts);
  }
}
