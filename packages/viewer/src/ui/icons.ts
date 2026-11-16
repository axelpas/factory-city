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
  /** Settings to adjust. */
  sliders: ["M2.5 5h11", "M2.5 11h11", "M6 3.3v3.4", "M10 9.3v3.4"],
  /** Fold a side panel away. */
  fold: ["M9.5 4.5L6 8l3.5 3.5", "M12.5 3v10"],
  /** Channels of the legend: the ground a building takes, its height, its color, the ring on its roof, its district. */
  area: ["M2.5 9.5h11v3h-11z"],
  height: ["M6 13.5v-11h4v11z"],
  color: ["M8 2.5c2.5 3 4 4.8 4 6.7a4 4 0 0 1-8 0c0-1.9 1.5-3.7 4-6.7z"],
  marker: ["M3 3h10v10H3z", "M5.8 5.8h4.4v4.4H5.8z"],
  tint: ["M2 11l6-2.5 6 2.5-6 2.5z", "M2 7.5l6-2.5 6 2.5"],
  close: ["M4 4l8 8", "M12 4l-8 8"],
  /** Transport: back one frame, play, pause, forward one frame. */
  prev: ["M11.5 3.5L6 8l5.5 4.5z", "M4 3v10"],
  next: ["M4.5 3.5L10 8l-5.5 4.5z", "M12 3v10"],
  play: ["M5 3l8 5-8 5z"],
  pause: ["M5 3v10", "M11 3v10"],
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
