import { readDropped } from "../../data/load";
import { DEFAULT_THEME, THEMES } from "../../themes/index";
import { handleKey, type KeyActions } from "../keyboard";
import { watchPopovers } from "../popovers";
import type { Hub } from "./hub";

/** What each key does on the page. */
function keyActions(hub: Hub): KeyActions {
  const { session, ui, parts } = hub;
  return {
    togglePlay: () => parts.playback.togglePlay(),
    step: (delta) => parts.playback.step(delta),
    resetCamera: () => ui.scene.resetCamera(),
    topView: () => ui.scene.topView(),
    nextTheme: () =>
      parts.presets.setTheme(THEMES[(THEMES.indexOf(session.theme) + 1) % THEMES.length] ?? DEFAULT_THEME),
    nextPreset: () => parts.presets.nextPreset(),
    exportPicture: () => ui.exporter.exportPng(2, true),
    toggleHealth: () => parts.docks.toggleHealth(),
    toggleFactory: () => parts.docks.toggleFactory(),
    openFinder: () => ui.finder.open(),
    toggleHelp: () => ui.help.toggle(),
    escape: () => parts.docks.escape(),
  };
}

/** A file dropped on the page opens as the data to show. */
function listenToDrops(hub: Hub): void {
  const { session, ui, parts } = hub;
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    ui.dropZone.say("Drop snapshot.cc.json and analysis.json");
  });
  window.addEventListener("dragleave", (e) => {
    if (e.target === document.documentElement || !(e.relatedTarget instanceof Node))
      ui.dropZone.hidden = session.state !== undefined;
  });
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length === 0) return;
    try {
      parts.loader.open(await readDropped(files));
    } catch (err) {
      ui.dropZone.say(err instanceof Error ? err.message : String(err));
    }
  });
}

/** Connects the page to the world: sizes, animation clock, media queries, keyboard, pointer, dropped files. */
export function wirePage(hub: Hub): void {
  const { ui, parts } = hub;
  // the city is framed in what the bar, the panels and the timeline leave free
  const covering = new ResizeObserver(() => parts.docks.updateFreeArea());
  for (const node of [
    ui.stage,
    ui.header,
    ui.panel,
    ui.bar.element,
    ui.notes.status,
    ui.notes.legendBox,
    ui.inspector.element,
  ])
    covering.observe(node);
  ui.scene.onTick = (dt) => parts.playback.tick(dt);
  ui.scene.readState = () => parts.frames.onScreen();
  ui.reducedMotion.addEventListener("change", () => parts.playback.applyMotion());
  ui.medium.addEventListener("change", () => {
    // a window made narrower folds the panel (the choice remembered is left alone)
    if (ui.medium.matches) ui.viewPanel.fold();
    parts.docks.updateFreeArea();
  });
  if (ui.notes.fpsBox) {
    // performance check from the console: milliseconds per image during a move
    (
      window as unknown as { factoryCityBenchmark?: (images?: number, options?: object) => number }
    ).factoryCityBenchmark = (images, options) => ui.scene.benchmark(images, options);
  }
  ui.pointer.attach();
  const actions = keyActions(hub);
  window.addEventListener("keydown", (e) => handleKey(e, actions));
  watchPopovers(document);
  listenToDrops(hub);
  ui.dropZone.say("Loading…");
}
