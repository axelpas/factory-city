import { format } from "../lib/format";
import type { Theme } from "../themes/index";
import { parseHex, rampColor, toCss } from "../view/color";
import type { LegendModel } from "../view/legend";

export interface OverlayInput {
  theme: Theme;
  project: string;
  preset: string;
  /** The same legend as on the stage: channels, color scale, files without a value, extra note. */
  legend: LegendModel;
  /** Label of the frame shown, for a timeline. */
  frame?: string;
  /** The code-health score at this image, as text ("20.8"), when there is a report. */
  health?: string;
}

/** What every drawing step needs: the canvas, the theme, the scale of the picture and the colors of the text. */
interface Pen {
  ctx: CanvasRenderingContext2D;
  theme: Theme;
  /** Size of the picture relative to 1600 pixels wide. */
  k: number;
  pad: number;
  text: string;
  muted: string;
}

type Legend = LegendModel["color"];

/** The project, the preset and the frame, top left. */
function drawTitle(p: Pen, input: OverlayInput): void {
  const { ctx, theme, k, pad } = p;
  ctx.textBaseline = "top";
  ctx.fillStyle = p.text;
  ctx.font = `600 ${28 * k}px ${theme.font}`;
  ctx.fillText(input.project, pad, pad);
  ctx.fillStyle = p.muted;
  ctx.font = `${16 * k}px ${theme.font}`;
  ctx.fillText(input.preset, pad, pad + 36 * k);
  if (!input.frame) return;
  ctx.fillStyle = p.text;
  ctx.font = `${17 * k}px ${theme.font}`;
  ctx.fillText(input.frame, pad, pad + 62 * k);
}

/** The code-health score, top right, as on the page: the label, then the score. */
function drawHealth(p: Pen, width: number, health: string): void {
  const { ctx, theme, k, pad } = p;
  ctx.textAlign = "right";
  ctx.fillStyle = p.muted;
  ctx.font = `${16 * k}px ${theme.font}`;
  ctx.fillText("Code health", width - pad, pad + 36 * k);
  ctx.fillStyle = p.text;
  ctx.font = `600 ${28 * k}px ${theme.font}`;
  ctx.fillText(health, width - pad, pad);
  ctx.textAlign = "left";
}

/** The color scale of a number metric: a gradient, or steps for a theme that shows discrete steps. */
function drawScale(p: Pen, legend: Legend, y: number): void {
  const { ctx, theme, k, pad } = p;
  if (legend.kind !== "sequential" || legend.min === undefined || legend.max === undefined) return;
  const stops = theme.ramps.sequential.map(parseHex);
  const steps = theme.effects?.colorSteps;
  if (steps && steps > 1) {
    for (let i = 0; i < steps; i++) {
      ctx.fillStyle = toCss(rampColor(stops, i / (steps - 1)));
      ctx.fillRect(pad + (260 * k * i) / steps, y + 6 * k, (260 * k) / steps + 1, 12 * k);
    }
  } else {
    const gradient = ctx.createLinearGradient(pad, 0, pad + 260 * k, 0);
    for (const [i, c] of stops.entries()) gradient.addColorStop(i / (stops.length - 1), toCss(c));
    ctx.fillStyle = gradient;
    ctx.fillRect(pad, y + 6 * k, 260 * k, 12 * k);
  }
  ctx.fillStyle = p.muted;
  ctx.fillText(format.number(legend.min), pad, y + 22 * k);
  ctx.textAlign = "right";
  ctx.fillText(`${legend.clamped ? "≥ " : ""}${format.number(legend.max)}`, pad + 260 * k, y + 22 * k);
  ctx.textAlign = "left";
}

/** The categories of a category metric, one line each, with their counts. */
function drawCategories(p: Pen, legend: Legend, y: number, lineHeight: number): void {
  if (legend.kind !== "categorical") return;
  const { ctx, k, pad } = p;
  let at = y;
  for (const c of legend.categories ?? []) {
    ctx.fillStyle = toCss(c.color);
    ctx.fillRect(pad, at + 2 * k, 16 * k, 16 * k);
    ctx.fillStyle = p.text;
    ctx.fillText(`${c.label} (${format.integer(c.count)})`, pad + 24 * k, at);
    at += lineHeight;
  }
}

/** The line for the files without a value, at the very bottom. */
function drawUnavailable(p: Pen, count: number, y: number): void {
  const { ctx, theme, k, pad } = p;
  ctx.fillStyle = theme.colors.unavailable ?? "";
  ctx.fillRect(pad, y + 2 * k, 16 * k, 16 * k);
  ctx.fillStyle = p.text;
  ctx.fillText(`no value (${format.integer(count)} file${count === 1 ? "" : "s"})`, pad + 24 * k, y);
}

/** The height the color part of the legend takes above its text lines. */
function colorHeight(legend: Legend, k: number, lineHeight: number): number {
  if (legend.kind === "sequential") return 44 * k;
  if (legend.kind === "categorical") return lineHeight * Math.min(legend.categories?.length ?? 0, 9) + 8 * k;
  return 0;
}

/** Draws the title and the legend on top of an exported picture. Sizes scale with the picture. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: OverlayInput,
): void {
  const { theme } = input;
  const k = width / 1600;
  const p: Pen = {
    ctx,
    theme,
    k,
    pad: 32 * k,
    text: theme.colors.text ?? "",
    muted: theme.colors.textMuted ?? "",
  };
  drawTitle(p, input);
  if (input.health) drawHealth(p, width, input.health);
  const lineHeight = 22 * k;
  const texts = [
    ...input.legend.lines.map((l) => `${l.channel}: ${l.metric} — ${l.text}`),
    ...(input.legend.note ? [input.legend.note] : []),
  ];
  const unavailable = input.legend.unavailable;
  const legend = input.legend.color;
  let y =
    height -
    p.pad -
    lineHeight * (texts.length + (unavailable > 0 ? 1 : 0)) -
    colorHeight(legend, k, lineHeight);
  ctx.font = `${15 * k}px ${theme.font}`;
  for (const line of texts) {
    ctx.fillStyle = p.text;
    ctx.fillText(line, p.pad, y);
    y += lineHeight;
  }
  drawScale(p, legend, y);
  drawCategories(p, legend, y, lineHeight);
  if (unavailable > 0) drawUnavailable(p, unavailable, height - p.pad - lineHeight);
}
