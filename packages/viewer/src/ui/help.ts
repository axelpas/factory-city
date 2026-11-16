import { clear, el } from "../lib/dom";

/** The keys the page answers to, for the help. */
const SHORTCUTS: Array<[string, string]> = [
  ["Space", "play or pause the timelapse"],
  ["← →", "previous or next frame"],
  ["R", "reset the camera"],
  ["V", "top view"],
  ["P", "next preset"],
  ["T", "next theme"],
  ["H", "code health: score, risk profile, hotspots"],
  ["F", "factory: KPIs and the issues to look at"],
  ["E", "export a PNG"],
  ["/", "find a file by name and open its details"],
  ["?", "this help"],
  ["Esc", "close panels"],
];

/** Writes "How to read this city" into its dialog: three lines, a miniature legend, the shortcuts. */
export function fillHelp(dialog: HTMLElement, hiddenLenses: string | undefined, onClose: () => void): void {
  clear(dialog);
  const close = el("button", { text: "Got it", class: "primary", attrs: { type: "button" } });
  close.addEventListener("click", onClose);
  const sample = el(
    "div",
    { class: "mini" },
    el(
      "div",
      { class: "mini-item" },
      el("i", { class: "mini-ground" }),
      el("span", { text: "bigger ground = more code" }),
    ),
    el(
      "div",
      { class: "mini-item" },
      el("i", { class: "mini-tall" }),
      el("span", { text: "taller = more complex" }),
    ),
    el(
      "div",
      { class: "mini-item" },
      el("i", { class: "mini-dark" }),
      el("span", { text: "darker = higher color metric" }),
    ),
  );
  dialog.append(
    el("h2", { text: "How to read this city" }),
    el("p", {
      text: "Each building is a file, each plinth a folder. Area, height and color show metrics you can change.",
    }),
    el("p", {
      text: "Point at a building for its card, click it for all its metrics. Drag to orbit, scroll to zoom, right-drag to pan.",
    }),
    el("p", { text: "n/a means a value could not be computed for that file: it is never shown as zero." }),
    sample,
    ...(hiddenLenses ? [el("p", { class: "muted", text: hiddenLenses })] : []),
    el("h3", { text: "Keyboard" }),
    el(
      "dl",
      { class: "keys" },
      ...SHORTCUTS.flatMap(([k, d]) => [el("dt", { text: k }), el("dd", { text: d })]),
    ),
    close,
  );
}
