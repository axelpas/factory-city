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

  if (input.frame) {
    ctx.fillStyle = text;
    ctx.font = `${17 * k}px ${theme.font}`;
    ctx.fillText(input.frame, pad, pad + 62 * k);
  }
  if (input.health) {
    // top right, as on the page: the label, then the score and its scale
    ctx.textAlign = "right";
    ctx.fillStyle = muted;
    ctx.font = `${16 * k}px ${theme.font}`;
    ctx.fillText("Code health", width - pad, pad + 36 * k);
    ctx.fillStyle = text;
    ctx.font = `600 ${28 * k}px ${theme.font}`;
    ctx.fillText(`${input.health} / 100`, width - pad, pad);
    ctx.textAlign = "left";
  }
  const lineHeight = 22 * k;
  const texts = [
    ...input.legend.lines.map((l) => `${l.channel}: ${l.metric} — ${l.text}`),
    ...(input.legend.note ? [input.legend.note] : []),
  ];
  const unavailable = input.legend.unavailable;
  let y = height - pad - lineHeight * (texts.length + (unavailable > 0 ? 1 : 0));
  const legend = input.legend.color;
  if (legend.kind === "sequential") y -= 44 * k;
  if (legend.kind === "categorical") y -= lineHeight * Math.min(legend.categories?.length ?? 0, 9) + 8 * k;
  ctx.font = `${15 * k}px ${theme.font}`;
  for (const line of texts) {
    ctx.fillStyle = text;
    ctx.fillText(line, pad, y);
    y += lineHeight;
  }
  if (legend.kind === "sequential" && legend.min !== undefined && legend.max !== undefined) {
    const stops = theme.ramps.sequential.map(parseHex);
    const steps = theme.effects?.colorSteps;
    if (steps && steps > 1) {
      // a theme that shows the color metric in discrete steps gets a stepped scale
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
  if (unavailable > 0) {
    y = height - pad - lineHeight;
    ctx.fillStyle = theme.colors.unavailable ?? "";
    ctx.fillRect(pad, y + 2 * k, 16 * k, 16 * k);
    ctx.fillStyle = text;
    ctx.fillText(
      `no value (${format.integer(unavailable)} file${unavailable === 1 ? "" : "s"})`,
      pad + 24 * k,
      y,
    );
  }
}
