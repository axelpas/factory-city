import type { CityScene } from "../../scene/CityScene";
import type { AppearanceMenu } from "../appearance-menu";
import type { DistrictLabelLayer } from "../district-labels";
import type { ExportMenu } from "../export-menu";
import type { Exporter } from "../exporter";
import type { FileFinder } from "../file-finder";
import type { Film } from "../film";
import type { FrameNotes } from "../frame-notes";
import type { DropZone, HelpDialog } from "../help-dialog";
import type { HoverCard } from "../hover-card";
import type { Inspector } from "../inspector";
import type { PointerController } from "../pointer";
import type { ScoreBox } from "../score-box";
import type { Selection } from "../selection";
import type { TimelineBar } from "../timeline-bar";
import type { ViewPanel } from "../view-panel";
import type { Docks } from "./docks";
import type { Frames } from "./frames";
import type { HeaderBar } from "./header-bar";
import type { Loader } from "./loader";
import type { Playback } from "./playback";
import type { Presets } from "./presets";
import type { Session } from "./session";

/** Everything that is on the page: the stage and the city, the bar, the panels, the menus. */
export interface Widgets {
  stage: HTMLElement;
  scene: CityScene;
  districtLabels: DistrictLabelLayer;
  /** The header across the top. */
  header: HTMLElement;
  headerBar: HeaderBar;
  /** The view panel on the left. */
  panel: HTMLElement;
  viewPanel: ViewPanel;
  bar: TimelineBar;
  notes: FrameNotes;
  card: HoverCard;
  pointer: PointerController;
  selection: Selection;
  inspector: Inspector;
  scoreBox: ScoreBox;
  healthPanel: HTMLElement;
  factoryPanel: HTMLElement;
  help: HelpDialog;
  dropZone: DropZone;
  finder: FileFinder;
  appearance: AppearanceMenu;
  exportMenu: ExportMenu;
  exporter: Exporter;
  film: Film;
  /** Under this width the panels overlay the stage instead of taking room from the city. */
  medium: MediaQueryList;
  /** Whether the system asks for less motion. */
  reducedMotion: MediaQueryList;
}

/** What the page does: each part has a job, and asks the others through here. */
export interface Parts {
  frames: Frames;
  playback: Playback;
  presets: Presets;
  docks: Docks;
  loader: Loader;
}

/** The page: its data, its widgets, and the parts that make them work together. */
export interface Hub {
  session: Session;
  ui: Widgets;
  parts: Parts;
}
