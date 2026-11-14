import { format } from "../lib/format";
import type { Theme } from "../themes/index";
import { parseHex, toCss } from "../view/color";
import type { LegendLine } from "../view/legend";
import type { ColorLegend } from "../view/placements";

export interface OverlayInput {
  theme: Theme;
  project: string;
  preset: string;
  lines: LegendLine[];
  legend: ColorLegend;
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
  const pad = 32 * k;
  const text = theme.colors.text ?? "";
  const muted = theme.colors.textMuted ?? "";
  ctx.textBaseline = "top";
  ctx.fillStyle = text;
  ctx.font = `600 ${28 * k}px ${theme.font}`;
  ctx.fillText(input.project, pad, pad);
  ctx.fillStyle = muted;
  ctx.font = `${16 * k}px ${theme.font}`;
  ctx.fillText(input.preset, pad, pad + 36 * k);

  const lineHeight = 22 * k;
  let y = height - pad - lineHeight * input.lines.length;
  const legend = input.legend;
  if (legend.kind === "sequential") y -= 44 * k;
  if (legend.kind === "categorical") y -= lineHeight * Math.min(legend.categories?.length ?? 0, 9) + 8 * k;
  ctx.font = `${15 * k}px ${theme.font}`;
  for (const line of input.lines) {
    ctx.fillStyle = text;
    ctx.fillText(`${line.channel}: ${line.metric} — ${line.text}`, pad, y);
    y += lineHeight;
  }
  if (legend.kind === "sequential" && legend.min !== undefined && legend.max !== undefined) {
    const stops = theme.ramps.sequential.map(parseHex);
    const gradient = ctx.createLinearGradient(pad, 0, pad + 260 * k, 0);
    for (const [i, c] of stops.entries()) gradient.addColorStop(i / (stops.length - 1), toCss(c));
    ctx.fillStyle = gradient;
    ctx.fillRect(pad, y + 6 * k, 260 * k, 12 * k);
    ctx.fillStyle = muted;
    ctx.fillText(format.number(legend.min), pad, y + 22 * k);
    ctx.textAlign = "right";
    ctx.fillText(`${legend.clamped ? "≥ " : ""}${format.number(legend.max)}`, pad + 260 * k, y + 22 * k);
    ctx.textAlign = "left";
  } else if (legend.kind === "categorical") {
    for (const c of legend.categories ?? []) {
      ctx.fillStyle = toCss(c.color);
      ctx.fillRect(pad, y + 2 * k, 16 * k, 16 * k);
      ctx.fillStyle = text;
      ctx.fillText(`${c.label} (${format.integer(c.count)})`, pad + 24 * k, y);
      y += lineHeight;
    }
  }
}
