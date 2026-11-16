import type { Layout } from "@factory-city/layout";
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
import type { EncodedVideo, VideoOptions } from "../export/video";
import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import { defaultMapping, type Mapping, type Preset, presetStatuses } from "../presets/index";
import { CityScene, type Pick } from "../scene/CityScene";
import { applyTheme, DEFAULT_THEME, THEMES, type Theme, themeById } from "../themes/index";
import { biggestChanges, CHANGE, changePlacements } from "../view/change";
import { parseHex } from "../view/color";
import { projectContext } from "../view/context";
import { factoryView } from "../view/factory";
import { frameState } from "../view/frame-state";
import { type Insets, NO_INSETS } from "../view/framing";
import { healthView, scoreAt } from "../view/health";
import { hiddenLensesLine } from "../view/lenses";
import { type ColorLegend, computePlacements, computeTints } from "../view/placements";
import type { ScaleKind } from "../view/scales";
import { buildDelays } from "../view/state";
import { AppearanceMenu, type MotionSetting } from "./appearance-menu";
import { DistrictLabelLayer } from "./district-labels";
import { ExportMenu } from "./export-menu";
import { Exporter, type ExporterHost } from "./exporter";
import { renderFactoryPanel } from "./factory-panel";
import { FileFinder } from "./file-finder";
import { Film } from "./film";
import { FrameNotes } from "./frame-notes";
import { measureFreeArea } from "./free-area";
import { renderHealthPanel } from "./health-panel";
import { DropZone, HelpDialog } from "./help-dialog";
import { HoverCard } from "./hover-card";
import { type IconName, icon } from "./icons";
import { Inspector, type InspectorTab } from "./inspector";
import { handleKey, type KeyActions } from "./keyboard";
import { lensGroups, renderLensButton, renderLensList } from "./lens";
import { PointerController } from "./pointer";
import { closePopovers, watchPopovers } from "./popovers";
import { ScoreBox } from "./score-box";
import { Selection } from "./selection";
import { TimelineBar } from "./timeline-bar";
import { type TestsMode, ViewPanel } from "./view-panel";

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
  private readonly scene: CityScene;
  /** The card that follows the pointer, and what the pointer does on the city. */
  private card!: HoverCard;
  private pointerController!: PointerController;
  private readonly help = new HelpDialog({
    hiddenLenses: () => hiddenLensesLine(this.bar.lenses) || undefined,
    onSeen: () => safeStorage(() => localStorage.setItem(HELP_KEY, "1")),
  });
  private readonly dropZone = new DropZone();
  private readonly panel = el("aside", { class: "panel", attrs: { "aria-label": "View settings" } });
  /** What the bar, the panels and the timeline cover, as last measured. */
  private insets: Insets = NO_INSETS;
  /** Under this width the panels overlay the stage instead of taking room from the city. */
  private readonly medium = window.matchMedia(MEDIUM_QUERY);
  /** The preset in force before a channel was changed by hand: the way back. */
  private lastPreset: string | undefined;
  /** What the page says about the frame in words: legend, status, description, biggest changes. */
  private readonly notes = new FrameNotes({
    scene: () => this.scene,
    stage: () => this.stage,
    state: () => this.state,
    animator: () => this.animator,
    theme: () => this.theme,
    modelIndex: (union) => this.modelIndex(union),
    openDetails: (union) => this.selection.open(union),
  });
  /** The view panel: the channels, the marker, the scale and the filter. */
  private readonly viewPanel = new ViewPanel(
    this.panel,
    {
      state: () => this.state,
      report: () => this.report,
      lastPreset: () => this.lastPreset,
      changesBox: this.notes.changesBox,
      setMapping: (patch) => this.setMapping(patch),
      choosePreset: (id) => this.choosePreset(id),
      refresh: () => this.refresh(),
      onOpenChange: (open) => safeStorage(() => localStorage.setItem(PANEL_KEY, open ? "open" : "rail")),
    },
    safeStorage(() => localStorage.getItem(PANEL_KEY)) === "open" && !window.matchMedia(MEDIUM_QUERY).matches,
  );
  /** The building the details are about. */
  private readonly selection = new Selection({
    scene: () => this.scene,
    state: () => this.state,
    animator: () => this.animator,
    report: () => this.report,
    modelIndex: (union) => this.modelIndex(union),
    frameDistrict: (path) => this.frameDistrict(path),
  });
  private readonly healthPanel = el("section", {
    class: "health",
    attrs: { "aria-label": "Code health", hidden: "" },
  });
  private report: Report | undefined;
  private readonly factoryPanel = el("section", {
    class: "factory",
    attrs: { "aria-label": "Factory", hidden: "" },
  });
  /** The code health in brief: what the folded inspector shows. */
  private readonly scoreBox = new ScoreBox();
  /** The one panel on the right, always there: the health, the file and the factory are its tabs. */
  private readonly inspector = new Inspector({
    panes: { health: this.healthPanel, file: this.selection.element, factory: this.factoryPanel },
    summary: this.scoreBox.element,
    onTab: (tab) => this.openTab(tab),
    onChange: (tab) => {
      // folding the inspector ends the selection
      if (tab === undefined) this.selection.clearOutline();
    },
    width: Number(safeStorage(() => localStorage.getItem(INSPECTOR_KEY))) || undefined,
    onResize: (width) => safeStorage(() => localStorage.setItem(INSPECTOR_KEY, String(Math.round(width)))),
  });
  private factory: Factory | undefined;
  private factoryPeriod: "last30" | "all" = "last30";
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
  /** The Export menu, which also keeps the options of the film. */
  private readonly exportMenu = new ExportMenu({
    onPicture: (size, overlay) => this.exporter.exportPng(size, overlay),
    onVideo: () => void this.film.exportVideo(),
    frameCount: () => this.state?.data.frames.length ?? 1,
  });
  /** The Appearance menu, which also keeps the theme-independent settings. */
  private readonly appearance = new AppearanceMenu(
    {
      theme: () => this.theme,
      setTheme: (theme) => this.setTheme(theme),
      onMotion: () => this.applyMotion(),
      setDistrictNames: (on) => this.districtLabels.setEnabled(on),
      setGlow: (on) => this.scene.setGlow(on),
      remember: (key, value) =>
        safeStorage(() => localStorage.setItem(key === "motion" ? MOTION_KEY : LABELS_KEY, value)),
    },
    {
      motion: (safeStorage(() => localStorage.getItem(MOTION_KEY)) as MotionSetting | null) ?? "auto",
      districtNames: safeStorage(() => localStorage.getItem(LABELS_KEY)) !== "off",
    },
  );
  private readonly presetQuestion = el("span", { class: "question" });
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
  private readonly reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly finder = new FileFinder({
    files: () => this.finderFiles(),
    onChoose: (entry) => this.selection.open(entry.union),
  });
  private districtLabels!: DistrictLabelLayer;
  /** Pictures and films of the city. */
  private exporter!: Exporter;
  private film!: Film;

  constructor(root: HTMLElement) {
    applyTheme(this.theme, document.documentElement);
    this.stage = el("div", { class: "stage" });
    this.card = new HoverCard({
      state: () => this.state,
      frame: () => this.animator?.frame ?? 0,
      report: () => this.report,
      modelIndex: (union) => this.modelIndex(union),
      stage: this.stage,
      insets: () => this.insets,
    });
    this.bar = new TimelineBar({
      onPlayPause: () => this.togglePlay(),
      onStep: (delta) => this.step(delta),
      onSeek: (position) => {
        this.animator?.pause();
        this.animator?.setPosition(position);
        this.card.hide();
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
      this.notes.legendBox,
      this.notes.status,
      this.card.element,
      this.inspector.element,
      this.help.element,
      this.dropZone.element,
      this.notes.description,
    );
    this.scene = new CityScene(this.stage, this.theme);
    // the city is framed in what the bar, the panels and the timeline leave free
    const covering = new ResizeObserver(() => this.updateFreeArea());
    for (const node of [
      this.stage,
      this.header,
      this.panel,
      this.bar.element,
      this.notes.status,
      this.notes.legendBox,
      this.inspector.element,
    ])
      covering.observe(node);
    // the picture is described to those who cannot see it
    this.scene.canvas.setAttribute("role", "img");
    this.scene.canvas.setAttribute("aria-label", "City: every building is a file, every district a folder");
    this.scene.canvas.setAttribute("aria-describedby", "city-description");
    this.districtLabels = new DistrictLabelLayer(this.scene, () => this.coveredBoxes());
    this.districtLabels.setEnabled(this.appearance.districtNames);
    this.stage.append(this.districtLabels.element);
    this.pointerController = new PointerController({
      scene: this.scene,
      card: this.card,
      state: () => this.state,
      animator: () => this.animator,
      openDetails: (union) => this.selection.open(union),
      closeDetails: () => this.selection.close(),
      frameDistrict: (path) => this.frameDistrict(path),
    });
    const exporterHost: ExporterHost = {
      state: () => this.state,
      animator: () => this.animator,
      scene: this.scene,
      stage: this.stage,
      theme: () => this.theme,
      report: () => this.report,
      legend: () => this.notes.legend(),
      districtLabels: this.districtLabels,
      exportMenu: this.exportMenu,
      stateOf: (frame) => this.stateOf(frame),
      updateFrameViews: (force) => this.updateFrameViews(force),
    };
    this.exporter = new Exporter(exporterHost);
    this.film = new Film(exporterHost, this.exporter);
    this.scene.onTick = (dt) => this.tick(dt);
    this.scene.readState = () => this.onScreen();
    this.reducedQuery.addEventListener("change", () => this.applyMotion());
    this.medium.addEventListener("change", () => {
      // a window made narrower folds the panel (the choice remembered is left alone)
      if (this.medium.matches) this.viewPanel.fold();
      this.updateFreeArea();
    });
    if (this.notes.fpsBox) {
      // performance check from the console: milliseconds per image during a move
      (
        window as unknown as { factoryCityBenchmark?: (images?: number, options?: object) => number }
      ).factoryCityBenchmark = (images, options) => this.scene.benchmark(images, options);
    }
    this.wireEvents();
    this.dropZone.say("Loading…");
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
      this.dropZone.say(
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
      this.dropZone.say(`No data found for "${this.slug}". Run factory-city analyze or timeline first.`);
      return;
    }
    await this.openSource(source);
  }

  private async openSource(source: SourceKey): Promise<void> {
    const manifest = this.available[source];
    if (!manifest || !this.slug) return;
    this.fillSources(source);
    try {
      this.dropZone.say("Loading…");
      const loaded = await loadSource(this.slug, manifest, (done, total) => {
        if (total > 1)
          this.dropZone.say(`Loading frame ${format.integer(done)} of ${format.integer(total)}…`);
      });
      this.open(loaded);
    } catch (err) {
      this.dropZone.say(`Could not load "${this.slug}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  open(loaded: Loaded): void {
    const data = buildTimelineData(loaded.snapshots, loaded.manifest);
    this.renderContext(loaded, data.project);
    const last = data.frames[data.frames.length - 1];
    if (!last) {
      this.dropZone.say("This data holds no frame.");
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
    this.viewPanel.build();
    this.bar.setFrames(data.frames.map((f) => f.info));
    this.refresh();
    this.selection.close();
    if (!safeStorage(() => localStorage.getItem(HELP_KEY))) this.help.show();
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
    this.projectSelect.addEventListener("change", () => {
      const url = new URL(location.href);
      url.searchParams.set("project", this.projectSelect.value);
      location.href = url.toString();
    });
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
      el("span", { class: "bar-rule" }),
      // view and page actions
      this.finder.element,
      iconButton("top", "Top view", "Top view: look straight down (V)", () => this.scene.topView()),
      iconButton("reset", "Reset the view", "Reset the view (R)", () => this.scene.resetCamera()),
      this.appearance.element,
      this.exportMenu.element,
      button(
        "?",
        "How to read this city, and keyboard shortcuts (?)",
        () => this.help.toggle(),
        "icon quiet",
      ),
    );
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

  private choosePreset(id: string): void {
    const s = this.state;
    if (!s) return;
    const status = presetStatuses(s.ref, this.report?.dimensions).find((p) => p.preset.id === id);
    if (!status?.available || !status.mapping) return;
    s.preset = status.preset;
    s.mapping = status.mapping;
    this.relayoutAndRefresh();
    this.viewPanel.build();
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
    this.viewPanel.renderState();
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
    if (!s) return new Float32Array(0);
    const state = frameState(s, this.theme, frameIndex);
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
    this.notes.renderChanges(compared ? biggestChanges(compared.changes) : []);
    this.scene.setPlinthTints(computeTints(s.model, s.mapping, this.theme));
    this.bar.showFrame(a.frame, this.animator?.reducedMotion ?? false);
    this.notes.renderLegend();
    this.notes.renderStatus();
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
    if (this.notes.fpsBox)
      this.notes.fpsBox.textContent = `${format.integer(Math.round(this.scene.fps))} images per second`;
    return moving;
  }

  private togglePlay(): void {
    const a = this.animator;
    if (!a) return;
    if (a.playing) a.pause();
    else {
      this.card.hide();
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
    const reduced =
      this.appearance.motion === "reduced" ||
      (this.appearance.motion === "auto" && this.reducedQuery.matches);
    if (this.animator) this.animator.reducedMotion = reduced;
  }

  /** Reduced motion: the picture changes at once and the canvas fades in briefly. */
  private crossFade(): void {
    const canvas = this.scene.canvas;
    canvas.classList.remove("fade");
    void canvas.offsetWidth;
    canvas.classList.add("fade");
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

  // ------------------------------------------------------------ hover card

  private wireEvents(): void {
    this.pointerController.attach();
    window.addEventListener("keydown", (e) => handleKey(e, this.keyActions));
    watchPopovers(document);
    window.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.dropZone.say("Drop snapshot.cc.json and analysis.json");
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
        this.dropZone.say(err instanceof Error ? err.message : String(err));
      }
    });
  }

  /** Index of a union file in the model of the current frame, or -1. */
  private modelIndex(union: number): number {
    const s = this.state;
    const frame = s?.data.frames[this.animator?.frame ?? 0];
    return frame ? (frame.modelIndex[union] as number) : -1;
  }

  // --------------------------------------------------------------- details

  /** Integration hook: selects the first file of the frame, as a click on it does. */
  selectFirstFile(): boolean {
    return this.selection.selectFirst();
  }

  /** Integration hook: the index of the selected file, or null. */
  selected(): number | null {
    return this.selection.selected;
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
      if (!this.selection.element.hasChildNodes())
        this.selection.element.append(
          el("p", { class: "muted", text: "Click a building to see all the metrics of its file." }),
        );
      this.selection.element.hidden = false;
    }
  }

  // ------------------------------------------------------------ help, drop

  // -------------------------------------------------------------- keyboard

  private readonly keyActions: KeyActions = {
    togglePlay: () => this.togglePlay(),
    step: (delta) => this.step(delta),
    resetCamera: () => this.scene.resetCamera(),
    topView: () => this.scene.topView(),
    nextTheme: () => this.setTheme(THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length] ?? DEFAULT_THEME),
    nextPreset: () => this.nextPreset(),
    exportPicture: () => this.exporter.exportPng(2, true),
    toggleHealth: () => this.toggleHealth(),
    toggleFactory: () => this.toggleFactory(),
    openFinder: () => this.finder.open(),
    toggleHelp: () => this.help.toggle(),
    escape: () => this.escape(),
  };

  /** Escape: a menu or a help popover closes first; then the panels and the details. */
  private escape(): void {
    if (closePopovers(document)) return;
    this.healthPanel.hidden = true;
    this.factoryPanel.hidden = true;
    this.selection.close();
    // an open view panel overlays the stage in a medium window: it folds the same way
    if (this.medium.matches) this.viewPanel.fold();
    if (!this.help.hidden) this.help.hide();
  }

  /** Switches theme at runtime: same data, same mapping, another look. Buildings move from the current view. */
  setTheme(theme: Theme): void {
    const s = this.state;
    const cameraChanged = theme.camera.type !== this.theme.camera.type;
    this.theme = theme;
    safeStorage(() => localStorage.setItem(THEME_KEY, theme.id));
    applyTheme(theme, document.documentElement);
    this.scene.applyTheme(theme);
    this.scene.setGlow(this.appearance.glow);
    this.appearance.showTheme(theme);
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
    this.viewPanel.build();
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
      this.selection.close();
      this.renderFactory();
    }
  }

  private renderFactory(): void {
    const view = factoryView(this.factory, this.factoryPeriod, format);
    renderFactoryPanel(this.factoryPanel, view, {
      onPeriod: (period) => {
        this.factoryPeriod = period;
        this.renderFactory();
      },
      onGoToFrame: (frame) => this.animator?.goTo(frame),
    });
  }

  // ---------------------------------------------------------------- health

  private toggleHealth(): void {
    this.healthPanel.hidden = !this.healthPanel.hidden;
    if (!this.healthPanel.hidden) {
      this.factoryPanel.hidden = true;
      this.selection.close();
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
    this.scene.setHover(
      { kind: "file", index: union },
      this.pointerController.folderOf({ kind: "file", index: union }),
    );
  }

  private renderHealth(): void {
    const s = this.state;
    if (!s) return;
    const view = healthView(s.data, this.animator?.frame ?? 0, this.report, format);
    renderHealthPanel(this.healthPanel, view, (path) => this.goToFile(path));
  }

  /** What sits on the stage and hides the city, relative to the stage: district names keep clear of it. */
  private coveredBoxes(): Array<{ x: number; y: number; w: number; h: number }> {
    const stage = this.stage.getBoundingClientRect();
    return [this.notes.legendBox, this.inspector.element, this.notes.status]
      .filter((n) => !n.hidden)
      .map((n) => n.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .map((r) => ({ x: r.left - stage.left, y: r.top - stage.top, w: r.width, h: r.height }));
  }

  /** Measures what covers the stage on each side and tells the scene. */
  private updateFreeArea(): void {
    const { insets, bottomStack } = measureFreeArea(
      {
        stage: this.stage,
        header: this.header,
        panel: this.panel,
        timeline: this.bar.element,
        status: this.notes.status,
        legend: this.notes.legendBox,
        // folded, the inspector is a small summary laid over the stage: it takes no room from the city
        right: this.inspector.isFolded ? [] : [this.inspector.element],
      },
      this.medium.matches,
    );
    // what sits on the stage (the legend) places itself in the free area through these
    this.insets = insets;
    const page = this.stage.parentElement;
    page?.style.setProperty("--bottom-stack", `${Math.round(bottomStack)}px`);
    for (const [side, value] of Object.entries(insets))
      page?.style.setProperty(`--free-${side}`, `${Math.round(value)}px`);
    this.scene.setFreeArea(insets);
  }

  /** Lets every running move finish at once, so that a picture shows the settled city. */
  settle(): void {
    this.exporter.settle();
  }

  /** The current view as a PNG data URL at an exact size, for headless rendering. */
  capture(width: number, height: number, withOverlay = true, frame?: number): string | undefined {
    return this.exporter.capture(width, height, withOverlay, frame);
  }

  /** Renders the timelapse offline, image by image, on a virtual clock. */
  video(
    options: VideoOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<EncodedVideo | undefined> {
    return this.film.video(options, onProgress);
  }

  /** Fingerprints of the images at some playhead positions, to compare two renders image for image. */
  imageHashes(positions: number[], width: number, height: number): string[] {
    return this.film.imageHashes(positions, width, height);
  }
}
