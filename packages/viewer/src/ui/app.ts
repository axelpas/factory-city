import type { Layout, Rect } from "@factory-city/layout";
import { computeLayout } from "@factory-city/layout";
import type { Factory, Report } from "@factory-city/schema";
import { Animator } from "../anim/animator";
import { readEmbedded } from "../data/embedded";
import {
  type Available,
  defaultSource,
  type Loaded,
  loadAvailable,
  loadProjects,
  loadSource,
  readDropped,
  SOURCE_LABELS,
  type SourceKey,
  selectableSources,
} from "../data/load";
import type { Model } from "../data/model";
import { syntheticSnapshots } from "../data/synthetic";
import { buildTimelineData, layoutWeights, type TimelineData } from "../data/timeline";
import { type EncodedVideo, encodeVideo, pixelHash, planVideo, type VideoOptions } from "../export/video";
import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import { makePathFilter } from "../lib/glob";
import {
  defaultMapping,
  type Mapping,
  MIN_COVERAGE,
  PRESETS,
  type Preset,
  presetStatuses,
} from "../presets/index";
import { type CameraState, CityScene, type Pick } from "../scene/CityScene";
import { applyTheme, DEFAULT_THEME, THEMES, type Theme, themeById } from "../themes/index";
import {
  type CardRow,
  type FileCard,
  type FolderCard,
  fileCard,
  folderCard,
  frameChangeRows,
  lastChangeRow,
  lotCard,
} from "../view/card";
import { placeCard } from "../view/card-place";
import { biggestChanges, CHANGE, changePlacements, type FileChange } from "../view/change";
import { parseHex } from "../view/color";
import { projectContext } from "../view/context";
import { describeCity } from "../view/describe";
import { type DetailRow, fileDetails } from "../view/details";
import { factoryView } from "../view/factory";
import { freeRect, type Insets, NO_INSETS } from "../view/framing";
import { healthView, scoreAt, trendPoints } from "../view/health";
import { type LegendModel, legendModel } from "../view/legend";
import { hiddenLensesLine } from "../view/lenses";
import { resolveMarker } from "../view/marker";
import { type ColorLegend, computePlacements, computeTints } from "../view/placements";
import { SCALE_KINDS, type ScaleKind } from "../view/scales";
import { buildDelays, buildState } from "../view/state";
import { statusChip, statusDetails } from "../view/status";
import { blockLegend, blockSize, voxelize } from "../view/voxel";
import { DistrictLabelLayer } from "./district-labels";
import { FileFinder } from "./file-finder";
import { type IconName, icon } from "./icons";
import { Inspector, type InspectorTab } from "./inspector";
import { renderLegendBox } from "./legend-box";
import { lensGroups, renderLensButton, renderLensList } from "./lens";
import { drawOverlay } from "./overlay";
import { closePopovers, watchPopovers } from "./popovers";
import { ScoreBox } from "./score-box";
import { renderStatusChip } from "./status-chip";
import { TimelineBar } from "./timeline-bar";

function dirOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

type TestsMode = "show" | "dim" | "hide";

type Role = "area" | "height" | "color" | "marker" | "tint";

interface State {
  data: TimelineData;
  /** Model of the frame under the playhead. */
  readonly model: Model;
  /** Model of the last frame: what presets and pickers are offered from. */
  ref: Model;
  layout: Layout;
  preset: Preset | undefined;
  mapping: Mapping;
  legend: ColorLegend;
  search: string;
  tests: TestsMode;
  hover: Pick;
  pinned: Pick;
}

type MotionSetting = "auto" | "full" | "reduced";

const HELP_KEY = "fc.help.seen";
const THEME_KEY = "fc.theme";
const PANEL_KEY = "fc.panel";
/** Medium windows: the view panel is a rail and the inspector overlays the stage. */
const MEDIUM_QUERY = "(max-width: 1100px)";
const INSPECTOR_KEY = "fc.inspector";

/** The theme to start with: `?theme=` in the address, else the last one chosen, else the default. */
function initialTheme(): Theme {
  const asked = new URLSearchParams(location.search).get("theme");
  const stored = safeStorage(() => localStorage.getItem(THEME_KEY));
  return themeById(asked) ?? themeById(stored) ?? DEFAULT_THEME;
}
const MOTION_KEY = "fc.motion";
const LABELS_KEY = "fc.districtNames";

function safeStorage<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** The whole viewer: panels, pickers, legend, hover card, details, timeline and export, around one CityScene. */
export class App {
  private theme: Theme = initialTheme();
  private readonly stage: HTMLElement;
  private readonly header: HTMLElement;
  /** The camera view of a running export sequence (a video): pictures use it as it is. */
  private exportCamera: CameraState | undefined;
  private readonly scene: CityScene;
  private readonly card = el("div", { class: "card", attrs: { role: "tooltip" } });
  private readonly details = el("section", { attrs: { "aria-label": "File details", hidden: "" } });
  private readonly helpDialog = el("div", {
    class: "help",
    attrs: { role: "dialog", "aria-label": "How to read this city", hidden: "", tabindex: "-1" },
  });
  private readonly dropZone = el("div", { class: "drop" });
  private readonly panel = el("aside", { class: "panel", attrs: { "aria-label": "View settings" } });
  /** What the bar, the panels and the timeline cover, as last measured. */
  private insets: Insets = NO_INSETS;
  private readonly panelState = el("p", { class: "panel-state", attrs: { hidden: "" } });
  /** Folded to a rail unless the user opened it: a preset is enough for most sessions. */
  private panelOpen =
    safeStorage(() => localStorage.getItem(PANEL_KEY)) === "open" && !window.matchMedia(MEDIUM_QUERY).matches;
  /** Under this width the panels overlay the stage instead of taking room from the city. */
  private readonly medium = window.matchMedia(MEDIUM_QUERY);
  private moreOpen = false;
  /** The preset in force before a channel was changed by hand: the way back. */
  private lastPreset: string | undefined;
  private readonly legendBox = el("section", {
    class: "legend",
    attrs: { "aria-label": "Legend", hidden: "" },
  });
  private readonly changesBox = el("section", { class: "changes", attrs: { hidden: "" } });
  private readonly healthPanel = el("section", {
    class: "health",
    attrs: { "aria-label": "Code health", hidden: "" },
  });
  private report: Report | undefined;
  private readonly factoryPanel = el("section", {
    class: "factory",
    attrs: { "aria-label": "Factory", hidden: "" },
  });
  /** The one panel on the right: the file, the health and the factory are its tabs. */
  private readonly inspector = new Inspector({
    panes: { file: this.details, health: this.healthPanel, factory: this.factoryPanel },
    onTab: (tab) => this.openTab(tab),
    onChange: (tab) => {
      // closing the inspector ends the selection
      if (tab === undefined) this.clearSelection();
      this.healthButton.setAttribute("aria-pressed", String(tab === "health"));
      this.factoryButton.setAttribute("aria-pressed", String(tab === "factory"));
    },
    width: Number(safeStorage(() => localStorage.getItem(INSPECTOR_KEY))) || undefined,
    onResize: (width) => safeStorage(() => localStorage.setItem(INSPECTOR_KEY, String(Math.round(width)))),
  });
  private factory: Factory | undefined;
  private factoryPeriod: "last30" | "all" = "last30";
  private readonly status = el("footer", { class: "status" });
  /** What was analyzed: the project, its branch or revision, the subfolder when only one was taken. */
  private readonly context = el("span", {
    class: "context",
    attrs: { "aria-label": "Analyzed project and branch" },
  });
  private readonly projectSelect = el("select", {
    title: "Switch project",
    attrs: { "aria-label": "Project" },
  });
  /** The preset picker: the main control of the bar. Each preset is listed with the question it answers. */
  private readonly lensButton = el("summary", {
    title: "Presets set all channels at once and answer one question (P: next preset)",
    attrs: { "aria-label": "Indicator" },
  });
  private readonly lensList = el("div", { class: "menu-list lens-list" });
  private readonly lensMenu = el(
    "details",
    { class: "menu popover lens-menu" },
    this.lensButton,
    this.lensList,
  );
  private readonly appearanceList = el("div", { class: "menu-list" });
  /** Opens the full report; it sits in the score box. */
  private readonly healthButton = el("button", {
    text: "Open the full report",
    title: "Score, risk profile and hotspots (H)",
    attrs: { type: "button", "aria-pressed": "false" },
  });
  private readonly scoreBox = new ScoreBox(this.healthButton);
  private readonly factoryButton = el("button", {
    text: "Factory",
    title: "Factory KPIs and the issues to look at (F)",
    attrs: { type: "button", "aria-pressed": "false" },
  });
  private readonly presetQuestion = el("span", { class: "question" });
  private readonly themeSelect = el("select", {
    title: "Theme: the look changes, the data and the legend stay the same (T)",
    attrs: { "aria-label": "Theme" },
  });
  private glow = true;
  private exporting = false;
  private videoFps = 30;
  private videoOrbit = false;
  private scaleBeforeTheme: ScaleKind | undefined;
  private readonly bar: TimelineBar;
  private state: State | undefined;
  private animator: Animator | undefined;
  private stateCache = new Map<number, Float32Array>();
  private screen: { u: number; version: number; state: Float32Array } | undefined;
  private version = 0;
  private shownFrame = -1;
  private slug: string | undefined;
  private available: Available = {};
  private motion: MotionSetting =
    (safeStorage(() => localStorage.getItem(MOTION_KEY)) as MotionSetting | null) ?? "auto";
  private readonly reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  /** Shown with `?fps` in the address: images per second, for performance checks. */
  private readonly fpsBox = new URLSearchParams(location.search).has("fps")
    ? el("span", { class: "fps" })
    : undefined;
  /** What a screen reader is told about the picture; the canvas points at it. */
  private readonly cityDescription = el("p", { class: "sr-only", attrs: { id: "city-description" } });
  private readonly finder = new FileFinder({
    files: () => this.finderFiles(),
    onChoose: (entry) => this.openDetails(entry.union),
  });
  /** What had the focus when the help opened. */
  private helpOpener: HTMLElement | null = null;
  private districtLabels!: DistrictLabelLayer;
  private labelsOn = safeStorage(() => localStorage.getItem(LABELS_KEY)) !== "off";
  /** The building the details show, outlined in the city until another one is selected. */
  private selectedUnion: number | null = null;
  private rafPending = false;
  private pointer = { x: 0, y: 0, down: false, moved: false, startX: 0, startY: 0 };

  constructor(root: HTMLElement) {
    applyTheme(this.theme, document.documentElement);
    this.stage = el("div", { class: "stage" });
    this.bar = new TimelineBar({
      onPlayPause: () => this.togglePlay(),
      onStep: (delta) => this.step(delta),
      onSeek: (position) => {
        this.animator?.pause();
        this.animator?.setPosition(position);
        this.hideCard();
      },
      onJump: (frame) => this.animator?.goTo(frame),
      onSpeed: (speed) => {
        if (this.animator) this.animator.speed = speed;
      },
      onLoop: (loop) => {
        if (this.animator) this.animator.loop = loop;
      },
      onOrbit: (orbit) => this.scene.setOrbit(orbit),
      onSource: (key) => {
        void this.openSource(key as SourceKey);
      },
    });
    this.header = this.buildHeader();
    root.append(
      this.stage,
      this.header,
      this.panel,
      this.bar.element,
      this.legendBox,
      this.status,
      this.card,
      this.inspector.element,
      this.helpDialog,
      this.dropZone,
      this.cityDescription,
    );
    this.scene = new CityScene(this.stage, this.theme);
    // the city is framed in what the bar, the panels and the timeline leave free
    const covering = new ResizeObserver(() => this.updateFreeArea());
    for (const node of [
      this.stage,
      this.header,
      this.panel,
      this.bar.element,
      this.status,
      this.legendBox,
      ...this.rightPanels(),
    ])
      covering.observe(node);
    // the picture is described to those who cannot see it
    this.scene.canvas.setAttribute("role", "img");
    this.scene.canvas.setAttribute("aria-label", "City: every building is a file, every district a folder");
    this.scene.canvas.setAttribute("aria-describedby", "city-description");
    this.districtLabels = new DistrictLabelLayer(this.scene, () => this.coveredBoxes());
    this.districtLabels.setEnabled(this.labelsOn);
    this.stage.append(this.districtLabels.element);
    this.scene.onTick = (dt) => this.tick(dt);
    this.scene.readState = () => this.onScreen();
    this.reducedQuery.addEventListener("change", () => this.applyMotion());
    this.medium.addEventListener("change", () => {
      // a window made narrower folds the panel (the choice remembered is left alone)
      if (this.medium.matches && this.panelOpen) {
        this.panelOpen = false;
        this.buildPanel();
      }
      this.updateFreeArea();
    });
    if (this.fpsBox) {
      // performance check from the console: milliseconds per image during a move
      (
        window as unknown as { factoryCityBenchmark?: (images?: number, options?: object) => number }
      ).factoryCityBenchmark = (images, options) => this.scene.benchmark(images, options);
    }
    this.wireEvents();
    this.renderDropZone("Loading…");
  }

  /** Loads the project list, then the current project; falls back to the drop zone. */
  async start(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const synthetic = Number(params.get("synthetic"));
    if (synthetic > 0) {
      const frames = Math.max(1, Number(params.get("frames")) || 1);
      this.open({ snapshots: syntheticSnapshots(Math.min(synthetic, 50000), Math.min(frames, 60)) });
      return;
    }
    // a standalone file carries its own data: nothing to fetch, it opens offline
    const embedded = await readEmbedded();
    if (embedded) {
      this.open(embedded);
      return;
    }
    const list = await loadProjects();
    this.fillProjectSelect(list.projects, params.get("project") ?? list.current);
    this.slug = params.get("project") ?? list.current;
    if (!this.slug) {
      this.renderDropZone(
        "No analyzed project found. Run factory-city in a folder, or drop a snapshot.cc.json file here.",
      );
      return;
    }
    this.available = await loadAvailable(this.slug);
    const wanted = params.get("source") as SourceKey | null;
    // a snapshot is the last frame of a timeline: it is opened only when there is no timeline
    const source =
      wanted && this.available[wanted] && selectableSources(this.available).includes(wanted)
        ? wanted
        : defaultSource(this.available);
    if (!source) {
      this.renderDropZone(`No data found for "${this.slug}". Run factory-city analyze or timeline first.`);
      return;
    }
    await this.openSource(source);
  }

  private async openSource(source: SourceKey): Promise<void> {
    const manifest = this.available[source];
    if (!manifest || !this.slug) return;
    this.fillSources(source);
    try {
      this.renderDropZone("Loading…");
      const loaded = await loadSource(this.slug, manifest, (done, total) => {
        if (total > 1)
          this.renderDropZone(`Loading frame ${format.integer(done)} of ${format.integer(total)}…`);
      });
      this.open(loaded);
    } catch (err) {
      this.renderDropZone(
        `Could not load "${this.slug}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  open(loaded: Loaded): void {
    const data = buildTimelineData(loaded.snapshots, loaded.manifest);
    this.renderContext(loaded, data.project);
    const last = data.frames[data.frames.length - 1];
    if (!last) {
      this.renderDropZone("This data holds no frame.");
      return;
    }
    const params = new URLSearchParams(location.search);
    const isDiff = loaded.manifest?.kind === "timeline" && loaded.manifest.source.mode === "diff";
    // a diff opens on the Change preset; `?preset=` chooses another one
    const wanted = params.get("preset") ?? (isDiff ? "change" : undefined);
    const chosen = wanted
      ? presetStatuses(last.model, loaded.report?.dimensions).find(
          (p) => p.preset.id === wanted && p.available,
        )
      : undefined;
    const { preset, mapping } = chosen?.mapping
      ? { preset: chosen.preset, mapping: chosen.mapping }
      : defaultMapping(last.model, loaded.report?.dimensions);
    if (this.theme.scale && mapping.scale !== this.theme.scale) {
      this.scaleBeforeTheme = mapping.scale;
      mapping.scale = this.theme.scale;
    }
    this.dropZone.hidden = true;
    const app = this;
    this.state = {
      data,
      get model() {
        return (data.frames[app.animator?.frame ?? data.frames.length - 1] ?? last).model;
      },
      ref: last.model,
      layout: this.layoutFor(data, mapping),
      preset,
      mapping,
      legend: { kind: "none", metric: null },
      search: "",
      tests: "show",
      hover: null,
      pinned: null,
    };
    this.report = loaded.report;
    this.factory = loaded.factory;
    this.factoryPanel.hidden = true;
    document.title = `${data.project} · Factory City`;
    this.animator = undefined;
    this.buildCity(false);
    this.buildPanel();
    this.bar.setFrames(data.frames.map((f) => f.info));
    this.refresh();
    this.closeDetails();
    if (!safeStorage(() => localStorage.getItem(HELP_KEY))) this.showHelp();
  }

  /** Builds the scene for the current layout and a new animator; keeps what is on screen when there is something. */
  private buildCity(keepCamera: boolean): void {
    const s = this.state;
    if (!s) return;
    const before = this.animator;
    const snapshot = before?.onScreen();
    const delays = buildDelays(s.data.paths, s.layout);
    this.scene.setCity(s.layout, s.data.paths, delays, keepCamera);
    this.districtLabels.setLayout(s.layout);
    const ramp = this.theme.ramps.sequential.map(parseHex);
    const animator = new Animator(s.data.paths.length, delays, ramp, {
      states: (start, target) => {
        this.scene.setStates(start, target);
        this.version++;
      },
      progress: (u) => this.scene.setProgress(u),
      cut: () => this.crossFade(),
    });
    animator.speed = before?.speed ?? 1;
    animator.loop = before?.loop ?? false;
    this.animator = animator;
    this.applyMotion();
    this.stateCache.clear();
    const position = before ? before.frame : s.data.frames.length - 1;
    animator.reset(s.data.frames.length, (f) => this.stateOf(f), position);
    if (snapshot) animator.adopt(snapshot);
  }

  // ---------------------------------------------------------------- header

  private buildHeader(): HTMLElement {
    const button = (label: string, title: string, onClick: () => void, level?: string) => {
      const b = el("button", { text: label, title, class: level, attrs: { type: "button" } });
      b.addEventListener("click", onClick);
      return b;
    };
    const iconButton = (name: IconName, label: string, title: string, onClick: () => void) => {
      const b = el("button", { title, class: "icon quiet", attrs: { type: "button", "aria-label": label } });
      b.append(icon(name));
      b.addEventListener("click", onClick);
      return b;
    };
    this.healthButton.addEventListener("click", () => this.toggleHealth());
    this.factoryButton.addEventListener("click", () => this.toggleFactory());
    for (const t of THEMES) {
      const o = el("option", { text: t.label, attrs: { value: t.id } });
      if (t.id === this.theme.id) o.selected = true;
      this.themeSelect.append(o);
    }
    this.themeSelect.addEventListener("change", () =>
      this.setTheme(themeById(this.themeSelect.value) ?? DEFAULT_THEME),
    );
    this.projectSelect.addEventListener("change", () => {
      const url = new URL(location.href);
      url.searchParams.set("project", this.projectSelect.value);
      location.href = url.toString();
    });
    const exportMenu = el(
      "details",
      { class: "menu popover export-menu" },
      el(
        "summary",
        {
          class: "icon quiet",
          title: "Export a picture, or the timelapse as a video (E: PNG)",
          attrs: { "aria-label": "Export" },
        },
        icon("export"),
      ),
    );
    const appearance = el(
      "details",
      { class: "menu popover" },
      el(
        "summary",
        {
          class: "icon quiet",
          title: "Appearance: theme (T: next theme) and motion",
          attrs: { "aria-label": "Appearance" },
        },
        icon("appearance"),
      ),
      this.appearanceList,
    );
    this.renderAppearance();
    const overlay = el("input", { attrs: { type: "checkbox", checked: "" } });
    const options: Array<[string, number | "4k"]> = [
      ["PNG 1x", 1],
      ["PNG 2x", 2],
      ["PNG 4K", "4k"],
    ];
    const list = el("div", { class: "menu-list" });
    for (const [label, size] of options) {
      list.append(
        button(label, `Download the view as ${label}`, () => {
          exportMenu.open = false;
          this.exportPng(size, overlay.checked);
        }),
      );
    }
    list.append(el("label", { class: "check" }, overlay, " with title and legend"));
    const fps = el("select", {
      title: "Images per second of the video",
      attrs: { "aria-label": "Video images per second" },
    });
    for (const n of [30, 60])
      fps.append(el("option", { text: `Video at ${n} images per second`, attrs: { value: String(n) } }));
    fps.addEventListener("change", () => {
      this.videoFps = Number(fps.value);
    });
    const orbit = el("input", { attrs: { type: "checkbox" } });
    orbit.addEventListener("change", () => {
      this.videoOrbit = orbit.checked;
    });
    list.append(
      button(
        "Video of the timelapse",
        "Render the timelapse image by image and download it (MP4, or WebM)",
        () => {
          exportMenu.open = false;
          void this.exportVideo();
        },
      ),
      fps,
      el("label", { class: "check" }, orbit, " slow orbit in the video"),
    );
    exportMenu.append(list);
    return el(
      "header",
      { class: "bar" },
      // what is shown: the project and its branch
      this.projectSelect,
      this.context,
      el("span", { class: "bar-rule" }),
      // what is asked of the city: the indicator (a preset) and the question it answers
      el("span", { class: "bar-label", text: "Indicator", attrs: { "aria-hidden": "true" } }),
      this.lensMenu,
      this.presetQuestion,
      el("span", { class: "spacer" }),
      // panels
      this.scoreBox.element,
      this.factoryButton,
      el("span", { class: "bar-rule" }),
      // view and page actions
      this.finder.element,
      iconButton("top", "Top view", "Top view: look straight down (V)", () => this.scene.topView()),
      iconButton("reset", "Reset the view", "Reset the view (R)", () => this.scene.resetCamera()),
      appearance,
      exportMenu,
      button("?", "How to read this city, and keyboard shortcuts (?)", () => this.toggleHelp(), "icon quiet"),
    );
  }

  /** The appearance menu: theme, motion, and the effects of the theme in force. None of it carries data. */
  private renderAppearance(): void {
    const motion = el("select", {
      title: "Auto follows your system's reduced-motion setting",
      attrs: { "aria-label": "Motion" },
    });
    for (const [value, label] of [
      ["auto", "auto"],
      ["full", "full"],
      ["reduced", "reduced"],
    ] as const) {
      const o = el("option", { text: label, attrs: { value } });
      if (value === this.motion) o.selected = true;
      motion.append(o);
    }
    motion.addEventListener("change", () => {
      this.motion = motion.value as MotionSetting;
      safeStorage(() => localStorage.setItem(MOTION_KEY, this.motion));
      this.applyMotion();
    });
    this.appearanceList.replaceChildren(
      el("label", { class: "field" }, el("span", { text: "Theme" }), this.themeSelect),
      el("label", { class: "field" }, el("span", { text: "Motion" }), motion),
    );
    const names = el("input", { attrs: { type: "checkbox" } });
    names.checked = this.labelsOn;
    names.addEventListener("change", () => {
      this.labelsOn = names.checked;
      safeStorage(() => localStorage.setItem(LABELS_KEY, this.labelsOn ? "on" : "off"));
      this.districtLabels.setEnabled(this.labelsOn);
    });
    this.appearanceList.append(
      el(
        "label",
        { class: "check", title: "Write the name of the districts on the ground" },
        names,
        " district names",
      ),
    );
    if (this.theme.effects?.glow) {
      const glow = el("input", { attrs: { type: "checkbox" } });
      glow.checked = this.glow;
      glow.addEventListener("change", () => {
        this.glow = glow.checked;
        this.scene.setGlow(this.glow);
      });
      this.appearanceList.append(
        el(
          "label",
          { class: "check", title: "A soft glow around the edges; it carries no data" },
          glow,
          " edge glow",
        ),
      );
    }
  }

  private fillProjectSelect(
    projects: Array<{ slug: string; name: string }>,
    current: string | undefined,
  ): void {
    clear(this.projectSelect);
    for (const p of projects) {
      const o = el("option", { text: p.name, attrs: { value: p.slug } });
      if (p.slug === current) o.selected = true;
      this.projectSelect.append(o);
    }
    this.projectSelect.hidden = projects.length < 2;
  }

  /** The project and its branch, at the top of the page. The name is left to the project switcher when it shows. */
  private renderContext(loaded: Loaded, project: string): void {
    const c = projectContext(loaded.manifest, project);
    const where = c.path ? `${c.name} / ${c.path}` : c.name;
    this.context.replaceChildren(
      ...(this.projectSelect.hidden ? [el("b", { class: "context-name", text: where })] : []),
      el("span", { class: "context-ref" }, icon("branch"), el("span", { text: c.ref })),
    );
    this.context.title = `${where}, ${c.ref}`;
  }

  /** The ways of cutting the history sit in the playback options of the timeline bar. */
  private fillSources(current: SourceKey): void {
    this.bar.setSources(
      selectableSources(this.available).map((value) => ({ value, label: SOURCE_LABELS[value] })),
      current,
    );
  }

  // ----------------------------------------------------------------- panel

  /** Opens the view panel or folds it to a rail; the choice is remembered. */
  private setPanelOpen(open: boolean): void {
    this.panelOpen = open;
    safeStorage(() => localStorage.setItem(PANEL_KEY, open ? "open" : "rail"));
    this.buildPanel();
  }

  /**
   * The view panel. Folded, it is a rail with one button: a preset is enough for most sessions. Open, it
   * shows the three main channels, then the rest (marker, tint, scale) in a section closed by default, then
   * the filter.
   */
  private buildPanel(): void {
    const s = this.state;
    if (!s) return;
    clear(this.panel);
    this.panel.classList.toggle("rail", !this.panelOpen);
    if (!this.panelOpen) {
      const open = el(
        "button",
        {
          class: "icon quiet",
          title: "Channels and filter: choose the metrics yourself, search files",
          attrs: { type: "button", "aria-label": "Open the view panel", "aria-expanded": "false" },
        },
        icon("sliders"),
      );
      open.addEventListener("click", () => this.setPanelOpen(true));
      this.panel.append(open);
      if (!s.preset)
        this.panel.append(el("i", { class: "rail-dot", title: "The mapping was changed by hand" }));
      return;
    }
    const fold = el(
      "button",
      {
        class: "icon quiet",
        title: "Fold the panel",
        attrs: { type: "button", "aria-label": "Fold the view panel", "aria-expanded": "true" },
      },
      icon("fold"),
    );
    fold.addEventListener("click", () => this.setPanelOpen(false));
    this.panel.append(el("div", { class: "panel-head" }, el("h2", { text: "View" }), fold), this.panelState);
    this.renderPanelState();
    this.panel.append(this.picker("area", "Area", "Metric that sets how much ground a file gets"));
    this.panel.append(this.picker("height", "Height", "Metric that sets how tall a building is"));
    this.panel.append(this.picker("color", "Color", "Metric that colors a building"));

    const scale = el("select", {
      title: "How values become heights",
      attrs: { "aria-label": "Height scale" },
    });
    for (const kind of SCALE_KINDS) {
      const o = el("option", { text: kind, attrs: { value: kind } });
      if (kind === s.mapping.scale) o.selected = true;
      scale.append(o);
    }
    scale.addEventListener("change", () => this.setMapping({ scale: scale.value as ScaleKind }));
    const clamp = el("input", { attrs: { type: "checkbox" } });
    clamp.checked = s.mapping.clampP99;
    clamp.addEventListener("change", () => this.setMapping({ clampP99: clamp.checked }));
    const more = el(
      "details",
      { class: "more" },
      el("summary", { text: "More: marker, district tint, scale" }),
      this.picker("marker", "Marker", "Optional: marks the roof of the files above a threshold on a metric"),
      this.markerThreshold(),
      this.picker("tint", "District tint", "Optional: tints the plinth of a district by a folder metric"),
      el(
        "div",
        { class: "row" },
        el("label", { text: "Scale", title: "Linear, square root or logarithmic" }),
        scale,
      ),
      el(
        "label",
        {
          class: "check",
          title:
            "Values above the 99th percentile all get the maximum, so one outlier does not flatten the city",
        },
        clamp,
        " clamp outliers (99th percentile)",
      ),
    );
    // open when it holds something in use, or when the user opened it
    more.open = this.moreOpen || s.mapping.marker !== null || s.mapping.tint !== null;
    more.addEventListener("toggle", () => {
      this.moreOpen = more.open;
    });
    this.panel.append(more);

    this.panel.append(el("h2", { text: "Filter" }));
    const search = el("input", {
      attrs: {
        type: "search",
        placeholder: "Search path or glob: src/**/*.ts",
        "aria-label": "Search by path or glob",
      },
      title: "Plain text matches anywhere in the path; * and ? make it a glob",
    });
    search.value = s.search;
    search.addEventListener("input", () => {
      s.search = search.value;
      this.refresh();
    });
    const tests = el("div", {
      class: "segmented",
      title: "Test files: show, dim or hide",
      attrs: { role: "group", "aria-label": "Test files" },
    });
    for (const mode of ["show", "dim", "hide"] as const) {
      const b = el("button", {
        text: mode,
        attrs: { type: "button", "aria-pressed": String(mode === s.tests) },
      });
      b.addEventListener("click", () => {
        s.tests = mode;
        for (const other of tests.children) other.setAttribute("aria-pressed", String(other === b));
        this.refresh();
      });
      tests.append(b);
    }
    this.panel.append(search, el("div", { class: "row" }, el("label", { text: "Tests" }), tests));
    this.panel.append(this.changesBox);
  }

  /** Says when the channels no longer match a preset, and offers the way back. */
  private renderPanelState(): void {
    const s = this.state;
    clear(this.panelState);
    this.panelState.hidden = !s || s.preset !== undefined;
    if (!s || s.preset) return;
    const last = PRESETS.find((p) => p.id === this.lastPreset);
    this.panelState.append(el("span", { class: "badge", text: "modified" }));
    if (last) {
      const back = el("button", {
        class: "link",
        text: `Back to ${last.label}`,
        title: `Drop your changes and show the ${last.label} preset again`,
        attrs: { type: "button" },
      });
      back.addEventListener("click", () => this.choosePreset(last.id));
      this.panelState.append(back);
    }
  }

  private usable(role: Role): string[] {
    const s = this.state;
    if (!s) return [];
    return [...s.ref.metrics.values()]
      .filter((m) => m.id !== "is_test")
      .filter((m) => (role === "tint" ? m.scope === "folder" : m.scope === "file"))
      .filter((m) => role === "color" || m.kind !== "category")
      .filter((m) => (s.ref.coverage.get(m.id) ?? 0) >= MIN_COVERAGE)
      .map((m) => m.id);
  }

  private picker(role: Role, label: string, title: string): HTMLElement {
    const s = this.state as State;
    const select = el("select", { title, attrs: { "aria-label": label } });
    if (role === "color") select.append(el("option", { text: "none (white)", attrs: { value: "" } }));
    if (role === "marker" || role === "tint")
      select.append(el("option", { text: "none", attrs: { value: "" } }));
    const current = role === "marker" ? (s.mapping.marker?.metric ?? null) : s.mapping[role];
    for (const id of this.usable(role)) {
      const m = s.model.metrics.get(id);
      const o = el("option", { text: m?.label ?? id, attrs: { value: id } });
      if (id === current) o.selected = true;
      select.append(o);
    }
    select.addEventListener("change", () => {
      if (role === "marker") {
        const marker = select.value ? resolveMarker(s.ref, select.value, this.report?.dimensions) : undefined;
        this.setMapping({ marker: marker ?? null });
        this.buildPanel();
        return;
      }
      const optional = role === "color" || role === "tint";
      this.setMapping({ [role]: optional ? select.value || null : select.value });
    });
    const help = el(
      "details",
      { class: "metric-help popover" },
      el("summary", { text: "?", title: `What does this ${label.toLowerCase()} metric mean?` }),
      this.metricHelp(current),
    );
    select.addEventListener("change", () => {
      const next = role === "color" ? select.value : select.value;
      help.replaceChildren(
        el("summary", { text: "?", title: `What does this ${label.toLowerCase()} metric mean?` }),
        this.metricHelp(next || null),
      );
    });
    return el(
      "div",
      { class: "picker" },
      el("div", { class: "row" }, el("label", { text: label }), select, help),
    );
  }

  /** The threshold of the marker: the automatic one is shown, and can be replaced by a value typed in. */
  private markerThreshold(): HTMLElement | undefined {
    const s = this.state;
    const marker = s?.mapping.marker;
    if (!s || !marker) return undefined;
    const automatic = resolveMarker(s.ref, marker.metric, this.report?.dimensions);
    const input = el("input", {
      title: "Files above this value are marked. Leave empty for the automatic threshold.",
      attrs: {
        type: "number",
        step: "any",
        "aria-label": "Marker threshold",
        placeholder: automatic ? format.number(automatic.threshold) : "",
      },
    });
    if (marker.source === "chosen") input.value = String(marker.threshold);
    input.addEventListener("change", () => {
      const chosen = input.value.trim() === "" ? undefined : Number(input.value);
      const next = resolveMarker(s.ref, marker.metric, this.report?.dimensions, chosen);
      this.setMapping({ marker: next ?? null });
    });
    return el("div", { class: "row" }, el("label", { text: "above" }), input);
  }

  /** Definition, computation, why it matters, direction and limits: all from the registry. */
  private metricHelp(id: string | null): HTMLElement {
    const m = id ? this.state?.model.metrics.get(id) : undefined;
    if (!m) return el("div", { class: "help-body", text: "Buildings stay white." });
    const direction = {
      "higher-is-worse": "A higher value is worse.",
      "higher-is-better": "A higher value is better.",
      neutral: "Neither high nor low is good or bad.",
    }[m.direction];
    return el(
      "div",
      { class: "help-body" },
      el("p", { text: m.definition }),
      el("p", {}, el("b", { text: "How: " }), m.computation),
      el("p", {}, el("b", { text: "Why: " }), m.why),
      el("p", { text: direction }),
      el("p", {}, el("b", { text: "Limits: " }), m.limits),
      el("p", {
        class: "muted",
        text: `Data level ${m.level}${m.experimental ? " · experimental" : ""}${m.retrospective ? " · retrospective" : ""}`,
      }),
    );
  }

  private choosePreset(id: string): void {
    const s = this.state;
    if (!s) return;
    const status = presetStatuses(s.ref, this.report?.dimensions).find((p) => p.preset.id === id);
    if (!status?.available || !status.mapping) return;
    s.preset = status.preset;
    s.mapping = status.mapping;
    this.relayoutAndRefresh();
    this.buildPanel();
  }

  private setMapping(patch: Partial<Mapping>): void {
    const s = this.state;
    if (!s) return;
    const areaChanged = patch.area !== undefined && patch.area !== s.mapping.area;
    s.mapping = { ...s.mapping, ...patch };
    if (s.preset) this.lastPreset = s.preset.id;
    s.preset = undefined;
    if (areaChanged) this.relayoutAndRefresh();
    else this.refresh();
    this.updatePresetSelect();
    this.renderPanelState();
  }

  private layoutFor(data: TimelineData, mapping: Mapping): Layout {
    return computeLayout(layoutWeights(data, mapping.area));
  }

  private relayoutAndRefresh(): void {
    const s = this.state;
    if (!s) return;
    s.layout = this.layoutFor(s.data, s.mapping);
    this.buildCity(true);
    this.refresh();
  }

  private updatePresetSelect(): void {
    const s = this.state;
    if (!s) return;
    const statuses = presetStatuses(s.ref, this.report?.dimensions);
    renderLensButton(this.lensButton, s.preset?.label ?? "Custom");
    renderLensList(
      this.lensList,
      lensGroups(statuses, s.ref.manifest?.dataLevel ?? 0),
      s.preset?.id,
      (id) => {
        this.lensMenu.open = false;
        this.choosePreset(id);
      },
    );
    this.presetQuestion.textContent =
      s.preset?.question ?? "Your own mapping: channels were changed by hand.";
  }

  // --------------------------------------------------------------- refresh

  /** On-screen values of every file for one frame, with the current mapping and filters. Cached per frame. */
  private stateOf(frameIndex: number): Float32Array {
    const cached = this.stateCache.get(frameIndex);
    if (cached) return cached;
    const s = this.state;
    const frame = s?.data.frames[frameIndex];
    if (!s || !frame) return new Float32Array(0);
    const byChange = s.mapping.color === CHANGE;
    // the Change preset also draws the files the frame removed, so its placements cover the whole timeline
    const union = byChange
      ? changePlacements(s.data, frameIndex, s.layout, s.mapping, this.theme).placements
      : undefined;
    const own = union ? [] : computePlacements(frame.model, s.layout, s.mapping, this.theme).placements;
    const previous = frameIndex > 0 ? s.data.frames[frameIndex - 1] : undefined;
    const match = makePathFilter(s.search);
    const block = blockSize(this.theme, s.layout.width);
    const dimmed = new Set<number>();
    const hidden = new Set<number>();
    const aligned = s.data.paths.map((path, u) => {
      const m = frame.modelIndex[u] as number;
      const placement = union ? union[u] : m < 0 ? undefined : own[m];
      if (!placement) return undefined;
      const file = m >= 0 ? frame.model.files[m] : previous?.model.files[previous.modelIndex[u] as number];
      if (match && !match(path)) dimmed.add(u);
      if (file?.isTest && s.tests === "dim") dimmed.add(u);
      if (file?.isTest && s.tests === "hide") hidden.add(u);
      // a theme made of blocks draws whole cubes: heights and footprints snap, exact values stay in the card
      const rect = block === undefined ? undefined : s.layout.files.get(path);
      return rect && block !== undefined ? voxelize(placement, rect, block, this.theme) : placement;
    });
    const touched = new Set<number>();
    if (frame.info && frameIndex > 0) {
      for (const path of [...frame.info.added, ...frame.info.modified]) {
        const u = s.data.pathIndex.get(path);
        if (u !== undefined) touched.add(u);
      }
    }
    const state = buildState(s.data.paths, s.layout, aligned, {
      dimmed,
      hidden,
      touched,
      dimColor: parseHex(this.theme.colors.dim ?? ""),
    });
    this.stateCache.set(frameIndex, state);
    return state;
  }

  /** The buildings as drawn right now; recomputed only when the picture changed. */
  private onScreen(): Float32Array {
    const a = this.animator;
    if (!a) return new Float32Array(0);
    if (!this.screen || this.screen.u !== a.progress || this.screen.version !== this.version) {
      this.screen = { u: a.progress, version: this.version, state: a.onScreen() };
    }
    return this.screen.state;
  }

  /** The mapping, a filter or the theme changed: move from the current picture to the new one. */
  private refresh(): void {
    const s = this.state;
    const a = this.animator;
    if (!s || !a) return;
    this.stateCache.clear();
    a.retarget((f) => this.stateOf(f), this.theme.ramps.sequential.map(parseHex));
    this.updateFrameViews(true);
    this.updatePresetSelect();
  }

  /** Everything that depends on the frame under the playhead: legend, tints, label, totals, status. */
  private updateFrameViews(force = false): void {
    const s = this.state;
    const a = this.animator;
    if (!s || !a) return;
    if (!force && a.frame === this.shownFrame) return;
    this.shownFrame = a.frame;
    const compared =
      s.mapping.color === CHANGE
        ? changePlacements(s.data, a.frame, s.layout, s.mapping, this.theme)
        : undefined;
    s.legend = compared?.legend ?? computePlacements(s.model, s.layout, s.mapping, this.theme).legend;
    this.renderChanges(compared ? biggestChanges(compared.changes) : []);
    this.scene.setPlinthTints(computeTints(s.model, s.mapping, this.theme));
    this.bar.showFrame(a.frame, this.animator?.reducedMotion ?? false);
    this.renderLegend();
    this.renderStatus();
    if (!this.healthPanel.hidden) this.renderHealth();
    this.renderScore();
  }

  /** The score box for the frame shown. */
  private renderScore(): void {
    const s = this.state;
    if (!s) return;
    const frame = this.animator?.frame ?? 0;
    this.scoreBox.render(healthView(s.data, frame, this.report, format), frame);
  }

  /** One animation frame: advance the animator, follow the playhead. */
  private tick(dtMs: number): boolean {
    const a = this.animator;
    if (!a) return false;
    const moving = a.tick(dtMs);
    this.bar.update(a.playhead, a.playing, dtMs);
    const s = this.state;
    if (s) this.scoreBox.setScore(scoreAt(s.data, this.report, a.playhead));
    this.updateFrameViews();
    if (this.fpsBox)
      this.fpsBox.textContent = `${format.integer(Math.round(this.scene.fps))} images per second`;
    return moving;
  }

  private togglePlay(): void {
    const a = this.animator;
    if (!a) return;
    if (a.playing) a.pause();
    else {
      this.hideCard();
      this.scene.setHover(null);
      a.play();
    }
    this.scene.requestRender();
  }

  private step(delta: number): void {
    const a = this.animator;
    if (!a) return;
    a.pause();
    a.goTo(a.frame + delta);
  }

  private applyMotion(): void {
    const reduced = this.motion === "reduced" || (this.motion === "auto" && this.reducedQuery.matches);
    if (this.animator) this.animator.reducedMotion = reduced;
  }

  /** Reduced motion: the picture changes at once and the canvas fades in briefly. */
  private crossFade(): void {
    const canvas = this.scene.canvas;
    canvas.classList.remove("fade");
    void canvas.offsetWidth;
    canvas.classList.add("fade");
  }

  /** Compare view: the largest changes of the frame; a click flies to the building. */
  private renderChanges(changes: FileChange[]): void {
    const s = this.state;
    clear(this.changesBox);
    this.changesBox.hidden = changes.length === 0;
    if (!s || changes.length === 0) return;
    const metric = s.model.metrics.get(s.mapping.area)?.label.toLowerCase() ?? s.mapping.area;
    this.changesBox.append(el("h2", { text: "Biggest changes" }));
    for (const c of changes) {
      const path = s.data.paths[c.union] ?? "";
      const go = el("button", {
        class: "link",
        text: path,
        title: `Go to ${path}`,
        attrs: { type: "button" },
      });
      go.addEventListener("click", () => {
        const rect = s.layout.files.get(path);
        if (rect) this.scene.focus(rect.x + rect.w / 2, rect.y + rect.h / 2);
        if (this.modelIndex(c.union) >= 0) this.openDetails(c.union);
      });
      const sign = c.delta > 0 ? "+" : "−";
      this.changesBox.append(
        el(
          "div",
          { class: "kv" },
          go,
          el("span", {
            class: "muted",
            text: `${c.status}, ${sign}${format.integer(Math.abs(c.delta))} ${metric}`,
          }),
        ),
      );
    }
  }

  private legend(): LegendModel | undefined {
    const s = this.state;
    if (!s) return undefined;
    return legendModel(s.model, s.mapping, s.legend, this.theme.mode, format.number, this.blockNote());
  }

  private renderLegend(): void {
    const s = this.state;
    const legend = this.legend();
    this.legendBox.hidden = !s || !legend;
    if (s && legend) renderLegendBox(this.legendBox, legend, s.model, this.theme);
    // the legend is pinned at the bottom left: the timeline and the chip start to its right
    this.stage.parentElement?.style.setProperty(
      "--legend-room",
      this.legendBox.hidden ? "0px" : "calc(var(--legend-w) + var(--gutter))",
    );
  }

  /** The text a screen reader gets for the picture: the question asked, the counts and the frame. */
  private describe(): void {
    const s = this.state;
    if (!s) return;
    const frames = s.data.frames;
    const index = this.animator?.frame ?? 0;
    const frame = frames.length > 1 ? frames[index]?.info : undefined;
    this.cityDescription.textContent = describeCity(
      {
        project: s.model.project,
        preset: s.preset?.label ?? "Custom view",
        ...(s.preset?.question ? { question: s.preset.question } : {}),
        files: s.model.files.length,
        districts: [...s.layout.folders.keys()].filter((p) => p !== "" && !p.includes("/")).length,
        ...(frame ? { frame: { index, count: frames.length, label: frame.label } } : {}),
      },
      format.integer,
    );
    this.scene.canvas.setAttribute("aria-label", `City of ${s.model.project}: every building is a file`);
  }

  /** The files of the frame shown, for the file finder. */
  private finderFiles(): Array<{ path: string; union: number }> {
    const s = this.state;
    if (!s) return [];
    const out: Array<{ path: string; union: number }> = [];
    for (let union = 0; union < s.data.paths.length; union++)
      if (this.modelIndex(union) >= 0) out.push({ path: s.data.paths[union] ?? "", union });
    return out;
  }

  private renderStatus(): void {
    const s = this.state;
    if (!s) return;
    const manifest = s.data.manifest;
    const coverage = manifest?.kind === "timeline" ? manifest.coverage : undefined;
    const by = coverage?.byStrategy;
    this.describe();
    renderStatusChip(
      this.status,
      statusChip(s.model, format.integer),
      statusDetails(
        s.model,
        format.integer,
        coverage && by
          ? {
              linked: coverage.linked,
              commits: coverage.commits,
              issues: coverage.issues,
              detail: `By closing keyword: ${by["closing-keyword"]}, by pull request: ${by["pull-request"]}, by reference: ${by.reference}, by branch name: ${by.branch}, unlinked: ${by.unlinked}`,
            }
          : undefined,
      ),
      ...(this.fpsBox ? [this.fpsBox] : []),
    );
  }

  // ------------------------------------------------------------ hover card

  private wireEvents(): void {
    const canvas = this.scene.canvas;
    canvas.addEventListener("pointermove", (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      if (e.buttons !== 0) {
        this.pointer.moved ||=
          Math.hypot(e.clientX - this.pointer.startX, e.clientY - this.pointer.startY) > 5;
        this.hideCard();
        return;
      }
      if (e.pointerType === "touch") return;
      this.scheduleHover();
    });
    canvas.addEventListener("pointerleave", () => this.hideCard());
    canvas.addEventListener("pointerdown", (e) => {
      this.pointer = {
        x: e.clientX,
        y: e.clientY,
        down: true,
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
      };
    });
    canvas.addEventListener("pointerup", (e) => {
      const wasClick = this.pointer.down && !this.pointer.moved;
      this.pointer.down = false;
      if (!wasClick) return;
      this.onClick(e);
    });
    // a double click on a district (or on a building: its district) frames it; Reset comes back
    canvas.addEventListener("dblclick", (e) => {
      const s = this.state;
      const pick = this.scene.pick(e.clientX, e.clientY);
      if (!s || !pick) return;
      this.frameDistrict(pick.kind === "folder" ? pick.path : dirOf(s.data.paths[pick.index] ?? ""));
    });
    window.addEventListener("keydown", (e) => this.onKey(e));
    watchPopovers(document);
    window.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.dropZone.hidden = false;
      this.renderDropZone("Drop snapshot.cc.json and analysis.json");
    });
    window.addEventListener("dragleave", (e) => {
      if (e.target === document.documentElement || !(e.relatedTarget instanceof Node))
        this.dropZone.hidden = this.state !== undefined;
    });
    window.addEventListener("drop", async (e) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      try {
        this.open(await readDropped(files));
      } catch (err) {
        this.renderDropZone(err instanceof Error ? err.message : String(err));
      }
    });
  }

  private scheduleHover(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.updateHover(this.pointer.x, this.pointer.y);
    });
  }

  private folderOf(pick: NonNullable<Pick>): { path: string; rect: Rect } | undefined {
    const s = this.state;
    if (!s) return undefined;
    const path = pick.kind === "folder" ? pick.path : dirOf(s.data.paths[pick.index] ?? "");
    const rect = s.layout.folders.get(path);
    return rect ? { path, rect } : undefined;
  }

  /** The card is shown in map mode and whenever the timelapse is paused; during playback it is off. */
  private updateHover(x: number, y: number): void {
    const s = this.state;
    if (!s || this.animator?.playing) return;
    const pick = this.scene.pick(x, y);
    s.hover = pick;
    // a building can be clicked: the cursor says so
    this.scene.canvas.style.cursor = pick?.kind === "file" ? "pointer" : "";
    if (!pick) {
      this.scene.setHover(null);
      this.hideCard();
      return;
    }
    this.scene.setHover(pick, this.folderOf(pick));
    this.showCard(pick, x, y);
  }

  private onClick(e: PointerEvent): void {
    const s = this.state;
    if (!s) return;
    if (this.animator?.playing) {
      // during playback a click pauses and shows the card of what is under the pointer
      this.animator.pause();
      this.updateHover(e.clientX, e.clientY);
      return;
    }
    const pick = this.scene.pick(e.clientX, e.clientY);
    if (e.pointerType === "touch") {
      // first tap shows the card, a second tap on the same building opens the details
      const same = pick?.kind === "file" && s.pinned?.kind === "file" && pick.index === s.pinned.index;
      s.pinned = pick;
      if (same && pick?.kind === "file") {
        this.openDetails(pick.index);
        return;
      }
      s.hover = pick;
      this.scene.setHover(pick, pick ? this.folderOf(pick) : undefined);
      if (pick) this.showCard(pick, e.clientX, e.clientY);
      else this.hideCard();
      return;
    }
    if (pick?.kind === "file") this.openDetails(pick.index);
    else this.closeDetails();
  }

  /** Index of a union file in the model of the current frame, or -1. */
  private modelIndex(union: number): number {
    const s = this.state;
    const frame = s?.data.frames[this.animator?.frame ?? 0];
    return frame ? (frame.modelIndex[union] as number) : -1;
  }

  private showCard(pick: NonNullable<Pick>, x: number, y: number): void {
    const s = this.state;
    const frame = this.animator?.frame ?? 0;
    if (!s) return;
    clear(this.card);
    if (pick.kind === "folder") {
      this.card.append(this.folderCardView(folderCard(s.model, pick.path, format)));
    } else {
      const m = this.modelIndex(pick.index);
      if (pick.kind === "lot" || m < 0) {
        const lot = lotCard(s.data, frame, pick.index);
        this.card.append(
          el(
            "div",
            {},
            el("div", { class: "card-title", text: `Empty lot: ${lot.title}` }),
            el("div", { class: "muted", text: lot.folder }),
            el("p", { class: "lot-text", text: lot.text }),
          ),
        );
      } else {
        const data = fileCard(s.model, m, s.mapping, format, this.report?.dimensions);
        const last = lastChangeRow(s.data, frame, pick.index, format);
        this.card.append(this.fileCardView(data, last ? [last] : []));
      }
    }
    this.card.classList.add("on");
    // beside the pointer, inside what the bar, the panels and the timeline leave free
    const stage = this.stage.getBoundingClientRect();
    const free = freeRect({ w: stage.width, h: stage.height }, this.insets);
    const place = placeCard(
      { x: x - stage.left, y: y - stage.top },
      { w: this.card.offsetWidth, h: this.card.offsetHeight },
      free,
    );
    this.card.style.left = `${stage.left + place.left}px`;
    this.card.style.top = `${stage.top + place.top}px`;
  }

  private hideCard(): void {
    this.card.classList.remove("on");
  }

  private rowView(r: CardRow): HTMLElement {
    const marker =
      r.marker !== undefined
        ? el(
            "span",
            { class: "scale", title: `Higher than ${format.percent(r.marker)} of files` },
            el("i", { style: { left: `${Math.round(r.marker * 100)}%` } }),
          )
        : undefined;
    return el(
      "div",
      { class: "kv", title: r.note },
      el("span", { class: "k", text: r.label }),
      el("span", { class: r.value === "n/a" ? "v na" : "v", text: r.value }),
      marker,
      r.note && r.value === "n/a" ? el("span", { class: "note", text: r.note }) : undefined,
    );
  }

  private fileCardView(c: FileCard, changes: CardRow[] = []): HTMLElement {
    return el(
      "div",
      {},
      el("div", { class: "card-title", text: c.title }),
      el("div", { class: "muted", text: c.folder }),
      el("div", { class: "muted", text: `${c.language}${c.isTest ? " · test" : ""}` }),
      ...c.channels.map((r) => this.rowView(r)),
      c.facts.length || changes.length ? el("hr") : undefined,
      ...c.facts.map((r) => this.rowView({ ...r, marker: undefined })),
      ...changes.map((r) => this.rowView(r)),
      el("div", { class: "hint", text: c.hint }),
    );
  }

  private folderCardView(c: FolderCard): HTMLElement {
    return el(
      "div",
      {},
      el("div", { class: "card-title", text: c.title }),
      el("div", { class: "muted", text: c.path }),
      ...c.rows.map((r) => this.rowView(r)),
      c.worst.length ? el("div", { class: "muted", text: "Most complex files" }) : undefined,
      ...c.worst.map((w) =>
        el(
          "div",
          { class: "kv" },
          el("span", { class: "k", text: w.path }),
          el("span", { class: "v", text: w.value }),
        ),
      ),
    );
  }

  // --------------------------------------------------------------- details

  private openDetails(union: number): void {
    const s = this.state;
    if (!s) return;
    const index = this.modelIndex(union);
    const file = s.model.files[index];
    if (!file) return;
    const frame = this.animator?.frame ?? 0;
    const d = fileDetails(s.model, index, s.mapping, format, this.report?.dimensions);
    clear(this.details);
    this.selectedUnion = union;
    this.scene.setSelection(union);

    const copy = el("button", {
      class: "quiet copy",
      text: "Copy path",
      title: "Copy the path of the file",
      attrs: { type: "button" },
    });
    copy.addEventListener("click", () => {
      void navigator.clipboard?.writeText(d.path).then(() => {
        copy.textContent = "Copied";
        setTimeout(() => {
          copy.textContent = "Copy path";
        }, 1500);
      });
    });
    const detailRow = (r: DetailRow) =>
      el(
        "div",
        { class: "kv", title: r.title, attrs: { "data-metric": r.id } },
        el("span", { class: "k", text: r.label }),
        el("span", { class: "v", text: r.value }),
        r.rank !== undefined
          ? el(
              "span",
              { class: "rank", title: `Higher than ${format.percent(r.rank)} of the files` },
              el("i", { style: { width: `${Math.round(r.rank * 100)}%` } }),
            )
          : undefined,
      );
    this.details.append(
      el("h2", { class: "pane-title", text: d.title }),
      el("div", { class: "pane-path" }, this.breadcrumb(d.path), copy),
      el("div", { class: "muted", text: `${d.language}${d.isTest ? " · test file" : ""}` }),
      ...(d.risks.length ? [el("p", { class: "risks", text: d.risks.join(" · ") })] : []),
      el("h3", { text: "Shown in the city" }),
      ...d.channels.map((r) => this.rowView(r)),
    );
    const changes = frameChangeRows(s.data, frame, union, s.mapping, format);
    if (changes.length) {
      this.details.append(el("h3", { text: "This frame" }), ...changes.map((r) => this.rowView(r)));
    }
    for (const group of d.groups) {
      if (group.allZero) {
        // a list of zeros says one thing: say it once, and keep the list one click away
        this.details.append(
          el(
            "details",
            { class: "zero-group", attrs: { "data-group": group.name } },
            el(
              "summary",
              {},
              el("b", { class: "zero-name", text: group.name }),
              el("span", { class: "muted", text: group.zeroText }),
            ),
            ...group.rows.map(detailRow),
          ),
        );
      } else {
        this.details.append(
          el("h3", { text: group.name, attrs: { "data-group": group.name } }),
          ...group.rows.map(detailRow),
        );
      }
    }
    if (d.unavailable.length) {
      this.details.append(
        el("h3", { text: "Not available for this file" }),
        ...d.unavailable.map((u) =>
          el(
            "div",
            { class: "kv" },
            el("span", { class: "k", text: u.label }),
            el("span", { class: "v na", text: "n/a" }),
            el("span", { class: "note", text: u.note }),
          ),
        ),
      );
    }

    const history = el("div", { class: "kvs" });
    const touching = s.data.frames.filter(
      (f) => f.info && (f.info.added.includes(file.path) || f.info.modified.includes(file.path)),
    );
    for (const f of touching.slice(-30).reverse()) {
      if (!f.info) continue;
      const jump = el("button", {
        class: "link",
        text: f.info.label,
        title: "Go to this frame",
        attrs: { type: "button" },
      });
      const target = f.info.index;
      jump.addEventListener("click", () => this.animator?.goTo(target));
      history.append(
        el("div", { class: "kv" }, jump, el("span", { class: "muted", text: format.date(f.info.date) })),
      );
    }
    if (s.data.frames.length >= 2) {
      this.details.append(
        el("h3", { text: "Frames that changed it" }),
        touching.length === 0
          ? el("p", { class: "muted", text: "No frame of this timeline changed this file." })
          : history,
      );
    }
    this.details.hidden = false;
  }

  /** Integration hook: selects the first file of the frame, as a click on it does. */
  selectFirstFile(): boolean {
    const s = this.state;
    if (!s) return false;
    for (let union = 0; union < s.data.paths.length; union++) {
      if (this.modelIndex(union) < 0) continue;
      this.openDetails(union);
      return true;
    }
    return false;
  }

  /** Integration hook: the index of the selected file, or null. */
  selected(): number | null {
    return this.selectedUnion;
  }

  private closeDetails(): void {
    this.details.hidden = true;
    this.clearSelection();
  }

  private clearSelection(): void {
    if (this.selectedUnion === null) return;
    this.selectedUnion = null;
    this.scene.setSelection(null);
  }

  /** The path of a file as a trail of folders: a click on one frames that district in the city. */
  private breadcrumb(path: string): HTMLElement {
    const parts = path.split("/");
    const trail = el("nav", { class: "breadcrumb", attrs: { "aria-label": "Path" } });
    parts.forEach((part, i) => {
      if (i > 0) trail.append(el("span", { class: "muted sep", text: "/" }));
      if (i === parts.length - 1) {
        trail.append(el("span", { class: "muted", text: part }));
        return;
      }
      const folder = parts.slice(0, i + 1).join("/");
      const button = el("button", {
        class: "link",
        text: part,
        title: `Frame ${folder} in the city`,
        attrs: { type: "button" },
      });
      button.addEventListener("click", () => this.frameDistrict(folder));
      trail.append(button);
    });
    return trail;
  }

  /** Brings a district to the middle of the free stage. */
  private frameDistrict(path: string): void {
    const rect = this.state?.layout.folders.get(path);
    if (rect) this.scene.frameDistrict(rect, this.animator?.reducedMotion ? 0 : 600);
  }

  /** A tab asked for from the inspector's header. */
  private openTab(tab: InspectorTab): void {
    if (tab === "health") {
      if (this.healthPanel.hidden) this.toggleHealth();
    } else if (tab === "factory") {
      if (this.factoryPanel.hidden) this.toggleFactory();
    } else {
      if (!this.details.hasChildNodes())
        this.details.append(
          el("p", { class: "muted", text: "Click a building to see all the metrics of its file." }),
        );
      this.details.hidden = false;
    }
  }

  // ------------------------------------------------------------ help, drop

  private showHelp(): void {
    clear(this.helpDialog);
    const close = el("button", { text: "Got it", class: "primary", attrs: { type: "button" } });
    close.addEventListener("click", () => this.hideHelp());
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
    const shortcuts: Array<[string, string]> = [
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
    this.helpDialog.append(
      el("h2", { text: "How to read this city" }),
      el("p", {
        text: "Each building is a file, each plinth a folder. Area, height and color show metrics you can change.",
      }),
      el("p", {
        text: "Point at a building for its card, click it for all its metrics. Drag to orbit, scroll to zoom, right-drag to pan.",
      }),
      el("p", { text: "n/a means a value could not be computed for that file: it is never shown as zero." }),
      sample,
      ...(hiddenLensesLine(this.bar.lenses)
        ? [el("p", { class: "muted", text: hiddenLensesLine(this.bar.lenses) })]
        : []),
      el("h3", { text: "Keyboard" }),
      el(
        "dl",
        { class: "keys" },
        ...shortcuts.flatMap(([k, d]) => [el("dt", { text: k }), el("dd", { text: d })]),
      ),
      close,
    );
    const active = document.activeElement;
    this.helpOpener = active instanceof HTMLElement && active !== document.body ? active : null;
    this.helpDialog.hidden = false;
    this.helpDialog.focus({ preventScroll: true });
  }

  private hideHelp(): void {
    this.helpDialog.hidden = true;
    if (this.helpOpener?.isConnected) this.helpOpener.focus({ preventScroll: true });
    this.helpOpener = null;
    safeStorage(() => localStorage.setItem(HELP_KEY, "1"));
  }

  private toggleHelp(): void {
    if (this.helpDialog.hidden) this.showHelp();
    else this.hideHelp();
  }

  private renderDropZone(message: string): void {
    this.dropZone.hidden = false;
    clear(this.dropZone);
    this.dropZone.append(
      el("div", { class: "drop-box" }, el("h2", { text: "Factory City" }), el("p", { text: message })),
    );
  }

  // -------------------------------------------------------------- keyboard

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) && e.key !== "Escape") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case " ":
        e.preventDefault();
        this.togglePlay();
        break;
      case "ArrowLeft":
        this.step(-1);
        break;
      case "ArrowRight":
        this.step(1);
        break;
      case "r":
      case "R":
        this.scene.resetCamera();
        break;
      case "v":
      case "V":
        this.scene.topView();
        break;
      case "t":
      case "T":
        this.setTheme(THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length] ?? DEFAULT_THEME);
        break;
      case "p":
      case "P":
        this.nextPreset();
        break;
      case "e":
      case "E":
        this.exportPng(2, true);
        break;
      case "h":
      case "H":
        this.toggleHealth();
        break;
      case "f":
      case "F":
        this.toggleFactory();
        break;
      case "/":
        e.preventDefault();
        this.finder.open();
        break;
      case "?":
        this.toggleHelp();
        break;
      case "Escape":
        // a menu or a help popover closes first; the panels stay
        if (closePopovers(document)) break;
        this.healthPanel.hidden = true;
        this.factoryPanel.hidden = true;
        this.closeDetails();
        // an open view panel overlays the stage in a medium window: it folds the same way
        if (this.medium.matches && this.panelOpen) {
          this.panelOpen = false;
          this.buildPanel();
        }
        if (!this.helpDialog.hidden) this.hideHelp();
        break;
      default:
    }
  }

  /** Switches theme at runtime: same data, same mapping, another look. Buildings move from the current view. */
  setTheme(theme: Theme): void {
    const s = this.state;
    const cameraChanged = theme.camera.type !== this.theme.camera.type;
    this.theme = theme;
    safeStorage(() => localStorage.setItem(THEME_KEY, theme.id));
    applyTheme(theme, document.documentElement);
    this.scene.applyTheme(theme);
    this.scene.setGlow(this.glow);
    this.themeSelect.value = theme.id;
    this.renderAppearance();
    if (!s) return;
    // a theme may prefer a scale (Blocks counts whole blocks); leaving it gives the previous scale back
    if (this.scaleBeforeTheme && !theme.scale) {
      s.mapping = { ...s.mapping, scale: this.scaleBeforeTheme };
      this.scaleBeforeTheme = undefined;
    }
    if (theme.scale && s.mapping.scale !== theme.scale) {
      this.scaleBeforeTheme ??= s.mapping.scale;
      s.mapping = { ...s.mapping, scale: theme.scale };
    }
    this.buildCity(!cameraChanged);
    this.buildPanel();
    this.refresh();
  }

  private nextPreset(): void {
    const s = this.state;
    if (!s) return;
    const available = presetStatuses(s.ref, this.report?.dimensions).filter((p) => p.available);
    if (available.length === 0) return;
    const at = available.findIndex((p) => p.preset.id === s.preset?.id);
    const next = available[(at + 1) % available.length];
    if (next) this.choosePreset(next.preset.id);
  }

  // ---------------------------------------------------------------- export

  // --------------------------------------------------------------- factory

  private toggleFactory(): void {
    this.factoryPanel.hidden = !this.factoryPanel.hidden;
    if (!this.factoryPanel.hidden) {
      this.healthPanel.hidden = true;
      this.closeDetails();
      this.renderFactory();
    }
  }

  private renderFactory(): void {
    const view = factoryView(this.factory, this.factoryPeriod, format);
    const panel = this.factoryPanel;
    clear(panel);
    if (!view.available) {
      panel.append(el("p", { class: "muted", text: view.reason ?? "" }));
      return;
    }
    panel.append(el("p", { class: "muted", text: view.notice }));
    const period = el("select", { title: "Period of the KPIs", attrs: { "aria-label": "Period" } });
    for (const p of view.periods) {
      const o = el("option", {
        text: `${p.label} (${format.integer(p.issues)} issues)`,
        attrs: { value: p.id },
      });
      if (p.id === view.period) o.selected = true;
      period.append(o);
    }
    period.addEventListener("change", () => {
      this.factoryPeriod = period.value as "last30" | "all";
      this.renderFactory();
    });
    panel.append(period);
    const hasPrevious = view.kpis.some((k) => k.previous !== undefined);
    for (const k of view.kpis) {
      panel.append(
        el(
          "div",
          { class: "kpi", title: k.definition },
          el(
            "span",
            { class: "k" },
            k.label,
            k.experimental ? el("i", { class: "badge", text: "experimental" }) : undefined,
          ),
          el("span", { class: k.value === "n/a" ? "v na" : "v", text: k.value }),
          el(
            "span",
            { class: "note" },
            k.reason ? `${k.reason} · ` : "",
            k.sample,
            hasPrevious && k.previous !== undefined ? ` · previous period: ${k.previous}` : "",
          ),
        ),
      );
    }
    if (view.hidden) panel.append(el("p", { class: "muted", text: view.hidden }));
    for (const g of view.groups) {
      if (g.rows.length === 0) {
        const sizes = g.columns.map((c) => `${c.value}: ${format.integer(c.issues)}`).join(", ");
        panel.append(
          el("p", {
            class: "muted",
            text: `By ${g.name}: no group has 10 issues yet (${sizes}), too few to compare.`,
          }),
        );
        continue;
      }
      const table = el("table", { class: "groups" });
      table.append(
        el(
          "tr",
          {},
          el("th", { text: `By ${g.name}` }),
          ...g.columns.map((c) => el("th", { text: `${c.value} (${format.integer(c.issues)})` })),
        ),
      );
      for (const row of g.rows)
        table.append(
          el("tr", {}, el("td", { text: row.label }), ...row.cells.map((c) => el("td", { text: c }))),
        );
      panel.append(table);
      if (g.warn)
        panel.append(
          el("p", {
            class: "muted",
            text: "Groups under 10 issues are too small to compare: their values are not shown.",
          }),
        );
    }
    for (const list of view.lists) {
      panel.append(el("h3", { text: list.title }));
      for (const line of list.lines) {
        const go = el("button", {
          class: "link",
          text: line.label,
          title: "Go to this frame",
          attrs: { type: "button" },
        });
        go.addEventListener("click", () => this.animator?.goTo(line.frame));
        panel.append(
          el("div", { class: "kv" }, go, el("span", { class: "v", text: format.number(line.value, 2) })),
        );
      }
    }
  }

  // ---------------------------------------------------------------- health

  private toggleHealth(): void {
    this.healthPanel.hidden = !this.healthPanel.hidden;
    if (!this.healthPanel.hidden) {
      this.factoryPanel.hidden = true;
      this.closeDetails();
      this.renderHealth();
    }
  }

  /** Flies to a file and opens its details when it exists in the frame shown. */
  private goToFile(path: string): void {
    const s = this.state;
    const union = s?.data.pathIndex.get(path);
    const rect = s?.layout.files.get(path);
    if (!s || union === undefined || !rect) return;
    this.scene.focus(rect.x + rect.w / 2, rect.y + rect.h / 2);
    this.scene.setHover({ kind: "file", index: union }, this.folderOf({ kind: "file", index: union }));
  }

  private renderHealth(): void {
    const s = this.state;
    if (!s) return;
    const view = healthView(s.data, this.animator?.frame ?? 0, this.report, format);
    const panel = this.healthPanel;
    clear(panel);
    if (!view.available) {
      panel.append(el("p", { class: "muted", text: view.reason ?? "" }));
      return;
    }
    panel.append(
      el(
        "div",
        { class: "score" },
        el("b", { text: format.number(view.score, 1) }),
        el("span", { class: "muted", text: " out of 100" }),
      ),
    );
    if (view.trend.length > 1) {
      const points = trendPoints(view.trend, 300, 36);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 -2 300 40");
      svg.setAttribute("class", "trend");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Score of each frame");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      line.setAttribute("points", points);
      const mark = document.createElementNS("http://www.w3.org/2000/svg", "line");
      const x = String((view.frame / (view.trend.length - 1)) * 300);
      mark.setAttribute("x1", x);
      mark.setAttribute("x2", x);
      mark.setAttribute("y1", "-2");
      mark.setAttribute("y2", "38");
      mark.setAttribute("class", "now");
      svg.append(line, mark);
      panel.append(svg);
    }
    panel.append(el("p", { class: "muted", text: view.notice }));
    if (view.movement) {
      const m = view.movement;
      panel.append(
        el("h3", { text: "This frame" }),
        el("p", {
          text: `Score ${m.qualityDelta}. Hotspots created: ${format.integer(m.created.length)}, resolved: ${format.integer(m.resolved.length)}.`,
        }),
      );
    }
    panel.append(
      el("h3", { text: "Risk profile" }),
      el("p", { class: "muted", text: "Share of code, by real lines, at each risk level." }),
    );
    const levels = [
      ["low", "risk-low", "low"],
      ["moderate", "risk-moderate", "moderate"],
      ["high", "risk-high", "high"],
      ["veryHigh", "risk-very-high", "very high"],
    ] as const;
    for (const row of view.profile) {
      const bar = el("div", {
        class: "risk-bar",
        attrs: { role: "img", "aria-label": `${row.label}: ${row.text}` },
      });
      for (const [key, cls, name] of levels) {
        const share = row.share[key];
        if (share <= 0) continue;
        bar.append(
          el("i", {
            class: cls,
            title: `${name}: ${format.percent(share)}`,
            style: { width: `${share * 100}%` },
          }),
        );
      }
      panel.append(
        el(
          "details",
          { class: "risk" },
          el(
            "summary",
            {},
            el("span", { class: "risk-name", text: row.label }),
            bar,
            el("span", { class: "muted risk-text", text: row.text }),
          ),
          el("p", { class: "muted", text: row.thresholds }),
        ),
      );
    }
    panel.append(
      el(
        "p",
        { class: "risk-key muted" },
        ...levels.flatMap(([, cls, name]) => [el("i", { class: cls }), ` ${name}  `]),
      ),
    );
    if (view.unavailable.length) {
      panel.append(
        el("p", {
          class: "muted",
          text: `Not rated here: ${view.unavailable.join(", ")} (needs more data, or no code to rate).`,
        }),
      );
    }
    panel.append(el("h3", { text: "Hotspots" }));
    if (view.hotspotsFromLatest) {
      panel.append(
        el("p", {
          class: "muted",
          text: "Hotspots of this frame. Suggested actions are computed for the latest frame only.",
        }),
      );
    }
    const link = (path: string) => {
      const b = el("button", {
        class: "link",
        text: path,
        title: `Go to ${path}`,
        attrs: { type: "button" },
      });
      b.addEventListener("click", () => this.goToFile(path));
      return b;
    };
    if (view.hotspots.length === 0) {
      if (view.hotspotPaths.length === 0) panel.append(el("p", { class: "muted", text: "No hotspot." }));
      for (const path of view.hotspotPaths) panel.append(el("div", { class: "hotspot" }, link(path)));
    }
    for (const h of view.hotspots.slice(0, 5)) {
      panel.append(
        el(
          "div",
          { class: "hotspot" },
          el(
            "div",
            {},
            el("b", { text: `${h.rank}. ` }),
            link(h.path),
            el("span", { class: "muted", text: ` size ${h.size}` }),
          ),
          el("div", {
            class: "muted",
            text: h.exceeded.length
              ? h.exceeded
                  .map(
                    (e) =>
                      `${e.dimension} ${e.level === "veryHigh" ? "very high" : e.level} (${format.number(e.value)})`,
                  )
                  .join(", ")
              : "ranks by complexity and activity",
          }),
          el("ul", {}, ...h.actions.map((a) => el("li", { text: a.text }))),
        ),
      );
    }
    if (view.hiddenLinks.length) {
      panel.append(el("h3", { text: "Hidden links (experimental)" }));
      for (const l of view.hiddenLinks)
        panel.append(el("p", { class: "muted", text: `${l.files.join(" and ")}: ${l.detail}` }));
    }
  }

  /** What sits on the stage and hides the city, relative to the stage: district names keep clear of it. */
  private coveredBoxes(): Array<{ x: number; y: number; w: number; h: number }> {
    const stage = this.stage.getBoundingClientRect();
    return [this.legendBox, this.status]
      .filter((n) => !n.hidden)
      .map((n) => n.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .map((r) => ({ x: r.left - stage.left, y: r.top - stage.top, w: r.width, h: r.height }));
  }

  private rightPanels(): HTMLElement[] {
    return [this.inspector.element];
  }

  /** Measures what covers the stage on each side and tells the scene. */
  private updateFreeArea(): void {
    const stage = this.stage.getBoundingClientRect();
    const shown = (node: HTMLElement) => {
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : undefined;
    };
    const header = shown(this.header);
    const left = shown(this.panel);
    const bottom = shown(this.bar.element) ?? shown(this.status);
    const status = shown(this.status);
    const right = this.rightPanels()
      .map(shown)
      .filter((r) => r !== undefined);
    // in a medium window the panels overlay the stage: the city keeps the whole width
    const overlay = this.medium.matches;
    const insets = {
      top: header ? header.bottom - stage.top : 0,
      left: left && !overlay ? left.right - stage.left : 0,
      right: right.length && !overlay ? stage.right - Math.min(...right.map((r) => r.left)) : 0,
      bottom: bottom ? stage.bottom - bottom.top : 0,
    };
    // what sits on the stage (the legend) places itself in the free area through these
    this.insets = insets;
    // the tallest thing pinned at the bottom: a panel stops above it
    const legend = shown(this.legendBox);
    const stack = Math.max(
      legend ? stage.bottom - legend.top : 0,
      bottom ? stage.bottom - bottom.top : 0,
      status ? stage.bottom - status.top : 0,
    );
    this.stage.parentElement?.style.setProperty("--bottom-stack", `${Math.round(stack)}px`);
    for (const [side, value] of Object.entries(insets))
      this.stage.parentElement?.style.setProperty(`--free-${side}`, `${Math.round(value)}px`);
    this.scene.setFreeArea(insets);
  }

  /** Lets every running move finish at once, so that a picture shows the settled city. */
  settle(): void {
    const a = this.animator;
    if (!a) return;
    a.pause();
    for (let i = 0; i < 20 && a.tick(100000); i++);
    this.updateFrameViews(true);
  }

  /** The current view as a PNG data URL at an exact size, for headless rendering. */
  capture(width: number, height: number, withOverlay = true): string | undefined {
    this.settle();
    return this.picture(width, height, withOverlay)?.toDataURL("image/png");
  }

  private exportPng(size: number | "4k", withOverlay: boolean): void {
    const s = this.state;
    if (!s) return;
    const base = this.stage.getBoundingClientRect();
    const width = size === "4k" ? 3840 : Math.round(base.width * size);
    const height = size === "4k" ? 2160 : Math.round(base.height * size);
    const canvas = this.picture(width, height, withOverlay);
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = el("a", { attrs: { href: url, download: `${s.model.project}-city.png` } });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, "image/png");
  }

  /** For a theme made of blocks: what one block is worth. */
  private blockNote(): string | undefined {
    const s = this.state;
    const block = s ? blockSize(this.theme, s.layout.width) : undefined;
    if (!s || block === undefined) return undefined;
    return blockLegend(
      s.model.metrics.get(s.mapping.height)?.label ?? s.mapping.height,
      s.model.stats.get(s.mapping.height),
      s.mapping.scale,
      s.mapping.clampP99,
      this.theme.heightScale * s.layout.width,
      block,
      (n) => format.number(n, 1),
    );
  }

  /** Label of the frame under the playhead, for exported pictures; undefined for a single snapshot. */
  /** The score at the playhead, for the overlay of an exported picture or film. */
  private exportScore(): { health?: string } {
    const s = this.state;
    const score = s ? scoreAt(s.data, this.report, this.animator?.playhead ?? 0) : undefined;
    return score === undefined ? {} : { health: format.number(score, 1) };
  }

  private frameText(): string | undefined {
    const s = this.state;
    const info = s?.data.frames[this.animator?.frame ?? 0]?.info;
    if (!s || !info || s.data.frames.length < 2) return undefined;
    return `${info.label} · ${format.date(info.date)}`;
  }

  /** Paints the image of the film at a playhead position on a canvas. A pure function of its arguments. */
  private paintAt(
    target: CanvasRenderingContext2D,
    position: number,
    width: number,
    height: number,
    overlay: boolean,
  ): void {
    const a = this.animator;
    if (!a) return;
    a.setPosition(position);
    this.updateFrameViews();
    const picture = this.picture(width, height, overlay);
    if (picture) target.drawImage(picture, 0, 0);
  }

  /**
   * Renders the timelapse offline, image by image, on a virtual clock: never a screen recording. The film
   * carries the same interpolated animation as the live view.
   */
  async video(
    options: VideoOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<EncodedVideo | undefined> {
    const s = this.state;
    const a = this.animator;
    if (!s || !a) return undefined;
    this.settle();
    const before = { position: a.position, camera: this.scene.cameraState(), reduced: a.reducedMotion };
    // one view for the whole film, framed for its size
    const view = this.scene.exportView(options.width, options.height);
    this.exportCamera = view;
    // a film is made of in-between images: movement is never replaced by cuts here
    a.reducedMotion = false;
    const canvas = document.createElement("canvas");
    canvas.width = options.width;
    canvas.height = options.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    const plan = planVideo(s.data.frames.length, options);
    try {
      a.reset(s.data.frames.length, (f) => this.stateOf(f), 0);
      return await encodeVideo(
        canvas,
        plan,
        (i) => {
          this.scene.setCameraState(view, plan.angleAt(i));
          this.paintAt(ctx, plan.positionAt(i), options.width, options.height, options.overlay);
        },
        onProgress,
      );
    } finally {
      a.reducedMotion = before.reduced;
      this.exportCamera = undefined;
      this.scene.setCameraState(before.camera);
      a.reset(s.data.frames.length, (f) => this.stateOf(f), before.position);
      this.updateFrameViews(true);
    }
  }

  /** Fingerprints of the images at some playhead positions: lets a test compare two renders image for image. */
  imageHashes(positions: number[], width: number, height: number): string[] {
    const s = this.state;
    const a = this.animator;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!s || !a || !ctx) return [];
    this.settle();
    const reduced = a.reducedMotion;
    a.reducedMotion = false;
    a.reset(s.data.frames.length, (f) => this.stateOf(f), 0);
    const out = positions.map((p) => {
      this.paintAt(ctx, p, width, height, false);
      return pixelHash(ctx.getImageData(0, 0, width, height).data);
    });
    a.reducedMotion = reduced;
    return out;
  }

  /** Asks for the video options, renders the film and offers it for download. */
  private async exportVideo(): Promise<void> {
    const s = this.state;
    if (!s || this.exporting) return;
    this.exporting = true;
    const note = el("div", { class: "export-note", text: "Rendering the video…" });
    this.stage.append(note);
    try {
      const result = await this.video(
        {
          width: 1920,
          height: 1080,
          fps: this.videoFps,
          secondsPerFrame: this.animator?.secondsPerFrame ?? 1.4,
          overlay: true,
          orbit: this.videoOrbit,
        },
        (done, total) => {
          note.textContent = `Rendering the video: image ${format.integer(done)} of ${format.integer(total)}`;
        },
      );
      if (!result) return;
      const url = URL.createObjectURL(new Blob([result.bytes.slice().buffer], { type: result.mime }));
      const link = el("a", {
        attrs: {
          href: url,
          download: `${s.model.project}-timelapse.${result.mime === "video/mp4" ? "mp4" : "webm"}`,
        },
      });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      note.textContent = `The video could not be rendered: ${err instanceof Error ? err.message : String(err)}`;
      await new Promise((wait) => setTimeout(wait, 4000));
    } finally {
      note.remove();
      this.exporting = false;
    }
  }

  private picture(width: number, height: number, withOverlay: boolean): HTMLCanvasElement | undefined {
    const s = this.state;
    if (!s) return undefined;
    // a single picture is framed for its own size; a film sets its view once for all its images
    const saved = this.exportCamera ? undefined : this.scene.cameraState();
    if (saved) this.scene.setCameraState(this.scene.exportView(width, height));
    // the names are placed with the camera of the picture, at the same relative size as on screen
    const k = width / Math.max(this.stage.clientWidth, 1);
    const canvas = this.scene.renderToCanvas(width, height, (ctx) =>
      this.districtLabels.draw(ctx, width, height, this.theme, k),
    );
    if (saved) this.scene.setCameraState(saved);
    if (withOverlay) {
      const ctx = canvas.getContext("2d");
      const legend = this.legend();
      if (ctx && legend)
        drawOverlay(ctx, width, height, {
          theme: this.theme,
          project: s.model.project,
          preset: s.preset?.label ?? "Custom",
          legend,
          frame: this.frameText(),
          ...this.exportScore(),
        });
    }
    return canvas;
  }
}
