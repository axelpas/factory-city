import { HeaderBar } from "./header-bar";
import type { Hub } from "./hub";
import { buildBar } from "./widgets-bar";
import { buildPanels } from "./widgets-panels";
import { buildSceneWidgets } from "./widgets-scene";
import { buildTools } from "./widgets-tools";

/** Builds every widget of the page, in the order they need each other, and puts the page together. */
export function buildWidgets(hub: Hub, root: HTMLElement): void {
  const { ui } = hub;
  Object.assign(ui, buildTools(hub), buildPanels(hub));
  Object.assign(ui, buildBar(hub));
  ui.headerBar = new HeaderBar(hub);
  ui.header = ui.headerBar.build();
  root.append(
    ui.stage,
    ui.header,
    ui.panel,
    ui.bar.element,
    ui.notes.legendBox,
    ui.notes.status,
    ui.card.element,
    ui.inspector.element,
    ui.help.element,
    ui.dropZone.element,
    ui.notes.description,
  );
  Object.assign(ui, buildSceneWidgets(hub));
}
