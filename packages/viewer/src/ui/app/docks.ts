import { el } from "../../lib/dom";
import { format } from "../../lib/format";
import { factoryView } from "../../view/factory";
import { healthView } from "../../view/health";
import { renderFactoryPanel } from "../factory-panel";
import { measureFreeArea } from "../free-area";
import { renderHealthPanel } from "../health-panel";
import type { InspectorTab } from "../inspector";
import { closePopovers } from "../popovers";
import type { Hub } from "./hub";

type Box = { x: number; y: number; w: number; h: number };

/** The panels of the inspector (health, factory), what covers the stage, and what Escape closes. */
export class Docks {
  constructor(private readonly hub: Hub) {}

  toggleFactory(): void {
    const { ui } = this.hub;
    ui.factoryPanel.hidden = !ui.factoryPanel.hidden;
    if (ui.factoryPanel.hidden) return;
    ui.healthPanel.hidden = true;
    ui.selection.close();
    this.renderFactory();
  }

  private renderFactory(): void {
    const { session, ui } = this.hub;
    const view = factoryView(session.factory, session.factoryPeriod, format);
    renderFactoryPanel(ui.factoryPanel, view, {
      onPeriod: (period) => {
        session.factoryPeriod = period;
        this.renderFactory();
      },
      onGoToFrame: (frame) => session.animator?.goTo(frame),
    });
  }

  toggleHealth(): void {
    const { ui } = this.hub;
    ui.healthPanel.hidden = !ui.healthPanel.hidden;
    if (ui.healthPanel.hidden) return;
    ui.factoryPanel.hidden = true;
    ui.selection.close();
    this.renderHealth();
  }

  renderHealth(): void {
    const { session, ui } = this.hub;
    const s = session.state;
    if (!s) return;
    const view = healthView(s.data, session.animator?.frame ?? 0, session.report, format);
    renderHealthPanel(ui.healthPanel, view, (path) => this.goToFile(path));
  }

  /** Flies to a file and outlines it when it exists in the frame shown. */
  private goToFile(path: string): void {
    const { session, ui } = this.hub;
    const s = session.state;
    const union = s?.data.pathIndex.get(path);
    const rect = s?.layout.files.get(path);
    if (!s || union === undefined || !rect) return;
    ui.scene.focus(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ui.scene.setHover({ kind: "file", index: union }, ui.pointer.folderOf({ kind: "file", index: union }));
  }

  /** A tab asked for from the inspector's header. */
  openTab(tab: InspectorTab): void {
    const { ui } = this.hub;
    if (tab === "health") {
      if (ui.healthPanel.hidden) this.toggleHealth();
    } else if (tab === "factory") {
      if (ui.factoryPanel.hidden) this.toggleFactory();
    } else {
      const file = ui.selection.element;
      if (!file.hasChildNodes())
        file.append(
          el("p", { class: "muted", text: "Click a building to see all the metrics of its file." }),
        );
      file.hidden = false;
    }
  }

  /** Brings a district to the middle of the free stage. */
  frameDistrict(path: string): void {
    const { session, ui } = this.hub;
    const rect = session.state?.layout.folders.get(path);
    if (rect) ui.scene.frameDistrict(rect, session.animator?.reducedMotion ? 0 : 600);
  }

  /** Escape: a menu or a help popover closes first; then the panels and the details. */
  escape(): void {
    const { ui } = this.hub;
    if (closePopovers(document)) return;
    ui.healthPanel.hidden = true;
    ui.factoryPanel.hidden = true;
    ui.selection.close();
    // an open view panel overlays the stage in a medium window: it folds the same way
    if (ui.medium.matches) ui.viewPanel.fold();
    if (!ui.help.hidden) ui.help.hide();
  }

  /** What sits on the stage and hides the city, relative to the stage: district names keep clear of it. */
  coveredBoxes(): Box[] {
    const { ui } = this.hub;
    const stage = ui.stage.getBoundingClientRect();
    return [ui.notes.legendBox, ui.inspector.element, ui.notes.status]
      .filter((n) => !n.hidden)
      .map((n) => n.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .map((r) => ({ x: r.left - stage.left, y: r.top - stage.top, w: r.width, h: r.height }));
  }

  /** Measures what covers the stage on each side and tells the scene. */
  updateFreeArea(): void {
    const { session, ui } = this.hub;
    const { insets, bottomStack } = measureFreeArea(
      {
        stage: ui.stage,
        header: ui.header,
        panel: ui.panel,
        timeline: ui.bar.element,
        status: ui.notes.status,
        legend: ui.notes.legendBox,
        // folded, the inspector is a small summary laid over the stage: it takes no room from the city
        right: ui.inspector.isFolded ? [] : [ui.inspector.element],
      },
      ui.medium.matches,
    );
    // what sits on the stage (the legend) places itself in the free area through these
    session.insets = insets;
    const page = ui.stage.parentElement;
    page?.style.setProperty("--bottom-stack", `${Math.round(bottomStack)}px`);
    for (const [side, value] of Object.entries(insets))
      page?.style.setProperty(`--free-${side}`, `${Math.round(value)}px`);
    ui.scene.setFreeArea(insets);
  }
}
