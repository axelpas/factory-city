import { el } from "../../lib/dom";
import { FrameNotes } from "../frame-notes";
import { Selection } from "../selection";
import { ViewPanel } from "../view-panel";
import type { Hub, Widgets } from "./hub";
import { MEDIUM_QUERY, PANEL_KEY, safeStorage } from "./session";

type Panels = Pick<
  Widgets,
  "stage" | "panel" | "notes" | "viewPanel" | "selection" | "healthPanel" | "factoryPanel"
>;

/** The stage, the view panel on the left, the notes about the frame, and the panes of the inspector. */
export function buildPanels(hub: Hub): Panels {
  const { session, parts } = hub;
  const stage = el("div", { class: "stage" });
  const panel = el("aside", { class: "panel", attrs: { "aria-label": "View settings" } });
  const notes = new FrameNotes({
    scene: () => hub.ui.scene,
    stage: () => stage,
    state: () => session.state,
    animator: () => session.animator,
    theme: () => session.theme,
    modelIndex: (union) => parts.frames.modelIndex(union),
    openDetails: (union) => hub.ui.selection.open(union),
  });
  const viewPanel = new ViewPanel(
    panel,
    {
      state: () => session.state,
      report: () => session.report,
      lastPreset: () => session.lastPreset,
      changesBox: notes.changesBox,
      setMapping: (patch) => parts.presets.setMapping(patch),
      choosePreset: (id) => parts.presets.choosePreset(id),
      refresh: () => parts.frames.refresh(),
      onOpenChange: (open) => safeStorage(() => localStorage.setItem(PANEL_KEY, open ? "open" : "rail")),
    },
    safeStorage(() => localStorage.getItem(PANEL_KEY)) === "open" && !window.matchMedia(MEDIUM_QUERY).matches,
  );
  const selection = new Selection({
    scene: () => hub.ui.scene,
    state: () => session.state,
    animator: () => session.animator,
    report: () => session.report,
    modelIndex: (union) => parts.frames.modelIndex(union),
    frameDistrict: (path) => parts.docks.frameDistrict(path),
  });
  const healthPanel = el("section", { class: "health", attrs: { "aria-label": "Code health", hidden: "" } });
  const factoryPanel = el("section", { class: "factory", attrs: { "aria-label": "Factory", hidden: "" } });
  return { stage, panel, notes, viewPanel, selection, healthPanel, factoryPanel };
}
