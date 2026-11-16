import { CityScene } from "../../scene/CityScene";
import { DistrictLabelLayer } from "../district-labels";
import { Exporter, type ExporterHost } from "../exporter";
import { Film } from "../film";
import { PointerController } from "../pointer";
import type { Hub, Widgets } from "./hub";

type SceneWidgets = Pick<Widgets, "scene" | "districtLabels" | "pointer" | "exporter" | "film">;

/** The 3D city and what works on it: the district names, the pointer, the pictures and the films. */
export function buildSceneWidgets(hub: Hub): SceneWidgets {
  const { session, parts, ui } = hub;
  const scene = new CityScene(ui.stage, session.theme);
  // the picture is described to those who cannot see it
  scene.canvas.setAttribute("role", "img");
  scene.canvas.setAttribute("aria-label", "City: every building is a file, every district a folder");
  scene.canvas.setAttribute("aria-describedby", "city-description");
  const districtLabels = new DistrictLabelLayer(scene, () => parts.docks.coveredBoxes());
  districtLabels.setEnabled(ui.appearance.districtNames);
  ui.stage.append(districtLabels.element);
  const pointer = new PointerController({
    scene,
    card: ui.card,
    state: () => session.state,
    animator: () => session.animator,
    openDetails: (union) => ui.selection.open(union),
    closeDetails: () => ui.selection.close(),
    frameDistrict: (path) => parts.docks.frameDistrict(path),
  });
  const host: ExporterHost = {
    state: () => session.state,
    animator: () => session.animator,
    scene,
    stage: ui.stage,
    theme: () => session.theme,
    report: () => session.report,
    legend: () => ui.notes.legend(),
    districtLabels,
    exportMenu: ui.exportMenu,
    stateOf: (frame) => parts.frames.stateOf(frame),
    updateFrameViews: (force) => parts.frames.updateFrameViews(force),
  };
  const exporter = new Exporter(host);
  return { scene, districtLabels, pointer, exporter, film: new Film(host, exporter) };
}
