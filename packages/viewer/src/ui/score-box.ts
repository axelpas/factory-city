import { el } from "../lib/dom";
import { format } from "../lib/format";
import { type HealthView, trendPoints } from "../view/health";

const SVG = "http://www.w3.org/2000/svg";
const TREND_W = 280;
const TREND_H = 34;
/** The dimensions listed in the box: the ones with the largest share of code at high risk. */
const TOP_DIMENSIONS = 3;

/**
 * What the code-health tab says when the inspector is folded, so that it is always in view: the score and its
 * change, the trend over the frames with the playhead on it, and the three kinds of risk that weigh most. The
 * number follows the playhead.
 */
export class ScoreBox {
  readonly element = el("div", { class: "score-summary" });
  private readonly value = el("b", { class: "score-value" });
  private readonly delta = el("span", { class: "score-delta muted" });
  private readonly body = el("div", { class: "score-body" });
  private readonly row = el(
    "div",
    { class: "score", title: "Code-health score of the frame shown (H: full report)" },
    this.value,
    this.delta,
  );
  private readonly without = el("p", { class: "muted score-without", attrs: { hidden: "" } });
  private readonly message = el("p", { class: "muted", attrs: { hidden: "" } });
  private shown = Number.NaN;

  constructor() {
    this.element.append(this.row, this.without, this.body, this.message);
  }

  /** The score under the playhead: cheap, called at every image. */
  setScore(score: number | undefined): void {
    if (score === undefined || !Number.isFinite(score)) return;
    const rounded = Math.round(score * 10) / 10;
    if (rounded === this.shown) return;
    this.shown = rounded;
    this.value.textContent = format.score(rounded);
  }

  /** What the box says for the frame shown: the change, the trend, the main risks. Called when the frame changes. */
  render(view: HealthView, position: number): void {
    this.row.hidden = !view.available;
    this.body.hidden = !view.available;
    this.message.hidden = view.available;
    if (!view.available) {
      this.message.textContent = view.reason ?? "No code-health data.";
      return;
    }
    this.setScore(view.score);
    this.without.hidden = !view.scoreWithoutSecurityText;
    this.without.textContent = view.scoreWithoutSecurityText
      ? `${view.scoreWithoutSecurityLabel ?? "Without security"}: ${view.scoreWithoutSecurityText}`
      : "";
    const change = view.movement?.qualityDelta;
    this.delta.textContent = change && change !== "unchanged" ? ` ${change}` : "";
    // a higher score is better: green when it went up, red when it went down
    this.delta.classList.toggle("positive", Boolean(change?.startsWith("+")));
    this.delta.classList.toggle("negative", Boolean(change?.startsWith("−")));
    this.delta.title = change ? `Change since the previous frame: ${change}` : "";

    const parts: Array<Node> = [];
    if (view.trend.length > 1) {
      const svg = document.createElementNS(SVG, "svg");
      svg.setAttribute("viewBox", `0 0 ${TREND_W} ${TREND_H}`);
      svg.setAttribute("preserveAspectRatio", "none");
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
          { class: "score-risks", title: "Share of code at high or very high risk" },
          ...risks.map((r) =>
            el(
              "div",
              { class: "kv", title: r.thresholds },
              el("span", { class: "k", text: r.label }),
              el("span", { class: "v", text: format.percent(r.share.high + r.share.veryHigh) }),
            ),
          ),
        ),
      );
    this.body.replaceChildren(...parts);
  }
}
