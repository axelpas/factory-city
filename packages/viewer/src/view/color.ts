export type Rgb = [number, number, number];

/** Parses `#rgb` or `#rrggbb` into 0..1 channels. Throws on anything else: tokens must be valid. */
export function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid color token: ${hex}`);
  let h = m[1] as string;
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [
    Number.parseInt(h.slice(0, 2), 16) / 255,
    Number.parseInt(h.slice(2, 4), 16) / 255,
    Number.parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export function toCss([r, g, b]: Rgb): string {
  const c = (x: number) => Math.round(Math.min(Math.max(x, 0), 1) * 255);
  return `rgb(${c(r)} ${c(g)} ${c(b)})`;
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Color of a ramp at t (0..1), interpolated between its stops. */
export function rampColor(stops: readonly Rgb[], t: number): Rgb {
  if (stops.length === 0) throw new Error("A ramp needs at least one stop");
  const clamped = Math.min(Math.max(t, 0), 1);
  const pos = clamped * (stops.length - 1);
  const i = Math.min(Math.floor(pos), stops.length - 2);
  if (i < 0) return stops[0] as Rgb;
  return mix(stops[i] as Rgb, stops[i + 1] as Rgb, pos - i);
}

/** A ramp shown in a few flat steps, for themes that draw the color metric in discrete steps. */
export function cssSteps(stops: readonly Rgb[], steps: number): string {
  const parts: string[] = [];
  for (let i = 0; i < steps; i++) {
    const color = toCss(rampColor(stops, steps === 1 ? 0 : i / (steps - 1)));
    parts.push(`${color} ${(i / steps) * 100}%`, `${color} ${((i + 1) / steps) * 100}%`);
  }
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

export function cssGradient(stops: readonly Rgb[]): string {
  return `linear-gradient(to right, ${stops.map(toCss).join(", ")})`;
}
