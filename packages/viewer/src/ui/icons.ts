const SVG = "http://www.w3.org/2000/svg";

/** Line icons drawn on a 16 px grid, in the color of the text around them. No asset, no font. */
const PATHS = {
  /** A plan seen from above. */
  top: ["M3 3h10v10H3z", "M3 8h10", "M8 3v10"],
  /** Back to the start. */
  reset: ["M3.2 8a4.8 4.8 0 1 0 1.5-3.5", "M3 2.8v2.9h2.9"],
  /** Light and dark halves: the look of the page. */
  appearance: [
    "M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z",
    "M8 2.5v11",
    "M8 5.2h4.6",
    "M8 8h5.5",
    "M8 10.8h4.6",
  ],
  /** Into a tray. */
  export: ["M8 2.5v7.5", "M5 7.2l3 3 3-3", "M3 13h10"],
  chevron: ["M4.5 6.5l3.5 3.5 3.5-3.5"],
  close: ["M4 4l8 8", "M12 4l-8 8"],
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "icon-svg");
  svg.setAttribute("aria-hidden", "true");
  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
