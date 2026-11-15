import type { Layout, Rect } from "@factory-city/layout";
import { computeLayout } from "@factory-city/layout";
import type { Factory, Report } from "@factory-city/schema";
import { Animator } from "../anim/animator";
import { readEmbedded } from "../data/embedded";
import {
  type Available,
  type Loaded,
  latestSource,
  loadAvailable,
  loadProjects,
  loadSource,
  readDropped,
  type SourceKey,
} from "../data/load";
import { type Model, percentileRank } from "../data/model";
import { syntheticSnapshots } from "../data/synthetic";
import { buildTimelineData, layoutWeights, type TimelineData } from "../data/timeline";
import { type EncodedVideo, encodeVideo, pixelHash, planVideo, type VideoOptions } from "../export/video";
import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import { makePathFilter } from "../lib/glob";
import { defaultMapping, type Mapping, MIN_COVERAGE, type Preset, presetStatuses } from "../presets/index";
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
  metricRow,
} from "../view/card";
import { biggestChanges, CHANGE, changePlacements, type FileChange } from "../view/change";
import { parseHex } from "../view/color";
import { factoryView } from "../view/factory";
import { healthView, trendPoints } from "../view/health";
import { dataLevelLine, hiddenContentLine, type LegendModel, legendModel } from "../view/legend";
import { hiddenLensesLine } from "../view/lenses";
import { resolveMarker } from "../view/marker";
import { type ColorLegend, computePlacements, computeTints } from "../view/placements";
import { SCALE_KINDS, type ScaleKind } from "../view/scales";
import { buildDelays, buildState } from "../view/state";
import { blockLegend, blockSize, voxelize } from "../view/voxel";
import { type IconName, icon } from "./icons";
import { renderLegendBox } from "./legend-box";
import { lensGroups, renderLensButton, renderLensList } from "./lens";
import { drawOverlay } from "./overlay";
import { closePopovers, watchPopovers } from "./popovers";
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

/** The theme to start with: `?theme=` in the address, else the last one chosen, else the default. */
function initialTheme(): Theme {
  const asked = new URLSearchParams(location.search).get("theme");
  const stored = safeStorage(() => localStorage.getItem(THEME_KEY));
  return themeById(asked) ?? themeById(stored) ?? DEFAULT_THEME;
}
const MOTION_KEY = "fc.motion";

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
  private readonly details = el("aside", {
    class: "details",
    attrs: { "aria-label": "File details", hidden: "" },
  });
  private readonly helpDialog = el("div", {
    class: "help",
    attrs: { role: "dialog", "aria-label": "How to read this city", hidden: "" },
  });
  private readonly dropZone = el("div", { class: "drop" });
  private readonly panel = el("aside", { class: "panel", attrs: { "aria-label": "View settings" } });
  private readonly legendBox = el("section", {
    class: "legend",
    attrs: { "aria-label": "Legend", hidden: "" },
  });
  private readonly changesBox = el("section", { class: "changes", attrs: { hidden: "" } });
  private readonly healthPanel = el("aside", {
    class: "details health",
    attrs: { "aria-label": "Code health", hidden: "" },
  });
  private report: Report | undefined;
  private readonly factoryPanel = el("aside", {
    class: "details health",
    attrs: { "aria-label": "Factory", hidden: "" },
  });
  private factory: Factory | undefined;
  private factoryPeriod: "last30" | "all" = "last30";
  private readonly status = el("footer", { class: "status" });
  private readonly projectSelect = el("select", {
    title: "Switch project",
    attrs: { "aria-label": "Project" },
  });
  private readonly sourceSelect = el("select", {
    title: "Single snapshot, or a timeline per commit or per day",
    attrs: { "aria-label": "Snapshot or timeline", hidden: "" },
  });
  /** The preset picker: the main control of the bar. Each preset is listed with the question it answers. */
  private readonly lensButton = el("summary", {
    title: "Presets set all channels at once and answer one question (P: next preset)",
    attrs: { "aria-label": "Preset" },
  });
  private readonly lensList = el("div", { class: "menu-list lens-list" });
  private readonly lensMenu = el(
    "details",
    { class: "menu popover lens-menu" },
    this.lensButton,
    this.lensList,
  );
  private readonly appearanceList = el("div", { class: "menu-list" });
  private readonly healthButton = el("button", {
    text: "Health",
    title: "Score, risk profile and hotspots (H)",
    attrs: { type: "button", "aria-pressed": "false" },
  });
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
      this.details,
      this.healthPanel,
      this.factoryPanel,
      this.helpDialog,
      this.dropZone,
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
      ...this.rightPanels(),
    ])
      covering.observe(node);
    this.scene.onTick = (dt) => this.tick(dt);
    this.scene.readState = () => this.onScreen();
    this.reducedQuery.addEventListener("change", () => this.applyMotion());
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
    const source = wanted && this.available[wanted] ? wanted : latestSource(this.available);
    if (!source) {
      this.renderDropZone(`No data found for "${this.slug}". Run factory-city analyze or timeline first.`);
      return;
    }
    await this.openSource(source);
  }

  private async openSource(source: SourceKey): Promise<void> {
    const manifest = this.available[source];
    if (!manifest || !this.slug) return;
    this.fillSourceSelect(source);
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
    this.sourceSelect.addEventListener("change", () => {
      void this.openSource(this.sourceSelect.value as SourceKey);
    });
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
      el("strong", { class: "brand", text: "Factory City" }),
      this.projectSelect,
      this.sourceSelect,
      // what is asked of the city: the preset and its question
      this.lensMenu,
      this.presetQuestion,
      el("span", { class: "spacer" }),
      // panels
      this.healthButton,
      this.factoryButton,
      el("span", { class: "bar-rule" }),
      // view and page actions
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

  private fillSourceSelect(current: SourceKey): void {
    const labels: Record<SourceKey, string> = {
      snapshot: "Snapshot",
      commit: "Timeline per commit",
      day: "Timeline per day",
      issue: "Timeline per issue",
      revs: "Chosen revisions",
      diff: "Branch diff",
    };
    clear(this.sourceSelect);
    const keys = Object.keys(this.available) as SourceKey[];
    for (const key of keys) {
      const o = el("option", { text: labels[key], attrs: { value: key } });
      if (key === current) o.selected = true;
      this.sourceSelect.append(o);
    }
    this.sourceSelect.hidden = keys.length < 2;
  }

  // ----------------------------------------------------------------- panel

  private buildPanel(): void {
    const s = this.state;
    if (!s) return;
    clear(this.panel);
    this.panel.append(el("h2", { text: "View" }));
    this.panel.append(this.picker("area", "Area", "Metric that sets how much ground a file gets"));
    this.panel.append(this.picker("height", "Height", "Metric that sets how tall a building is"));
    this.panel.append(this.picker("color", "Color", "Metric that colors a building"));
    this.panel.append(
      this.picker("marker", "Marker", "Optional: marks the roof of the files above a threshold on a metric"),
    );
    const threshold = this.markerThreshold();
    if (threshold) this.panel.append(threshold);
    this.panel.append(
      this.picker("tint", "District tint", "Optional: tints the plinth of a district by a folder metric"),
    );

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
    this.panel.append(
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

    this.panel.append(el("h2", { text: "Filter" }));
    const search = el("input", {
      attrs: {
        type: "search",
        placeholder: "Search path or glob: src/**/*.ts",
        "aria-label": "Search by path or glob",
      },
      title: "Plain text matches anywhere in the path; * and ? make it a glob",
    });
    search.addEventListener("input", () => {
      s.search = search.value;
      this.refresh();
    });
    const tests = el("select", {
      title: "Test files: show, dim or hide",
      attrs: { "aria-label": "Test files" },
    });
    for (const mode of ["show", "dim", "hide"] as const) {
      const o = el("option", { text: `Tests: ${mode}`, attrs: { value: mode } });
      if (mode === s.tests) o.selected = true;
      tests.append(o);
    }
    tests.addEventListener("change", () => {
      s.tests = tests.value as TestsMode;
      this.refresh();
    });
    this.panel.append(search, tests);
    this.panel.append(this.changesBox);
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
    s.preset = undefined;
    if (areaChanged) this.relayoutAndRefresh();
    else this.refresh();
    this.updatePresetSelect();
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
  }

  /** One animation frame: advance the animator, follow the playhead. */
  private tick(dtMs: number): boolean {
    const a = this.animator;
    if (!a) return false;
    const moving = a.tick(dtMs);
    this.bar.update(a.position, a.playing, dtMs);
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
  }

  private renderStatus(): void {
    const s = this.state;
    if (!s) return;
    clear(this.status);
    const hiddenLine = hiddenContentLine(s.model, format.integer);
    this.status.append(
      el("span", {
        class: "level",
        text: dataLevelLine(s.model),
        title: "What the data level means: 0 files, 1 git history, 2 forge, 3 facts",
      }),
      el("span", { text: `${format.integer(s.model.files.length)} files` }),
    );
    if (hiddenLine) this.status.append(el("span", { class: "muted", text: hiddenLine }));
    const coverage = s.data.manifest?.kind === "timeline" ? s.data.manifest.coverage : undefined;
    if (coverage) {
      this.status.append(
        el("span", {
          class: "muted",
          text: `${format.integer(coverage.linked)} of ${format.integer(coverage.commits)} commits linked to ${format.integer(coverage.issues)} issues`,
          title: `By closing keyword: ${coverage.byStrategy["closing-keyword"]}, by pull request: ${coverage.byStrategy["pull-request"]}, by reference: ${coverage.byStrategy.reference}, by branch name: ${coverage.byStrategy.branch}, unlinked: ${coverage.byStrategy.unlinked}`,
        }),
      );
    }
    if (this.fpsBox) this.status.append(this.fpsBox);
    for (const w of s.model.manifest?.warnings ?? [])
      this.status.append(el("span", { class: "muted", text: w }));
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
        this.sourceSelect.hidden = true;
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
        const data = fileCard(s.model, m, s.mapping, format);
        const last = lastChangeRow(s.data, frame, pick.index, format);
        const changes = [
          ...(last ? [last] : []),
          ...frameChangeRows(s.data, frame, pick.index, s.mapping, format),
        ];
        this.card.append(this.fileCardView(data, changes));
      }
    }
    this.card.classList.add("on");
    const margin = 18;
    const w = this.card.offsetWidth;
    const h = this.card.offsetHeight;
    const left = x + margin + w > window.innerWidth ? x - margin - w : x + margin;
    const top = y + margin + h > window.innerHeight ? Math.max(8, y - margin - h) : y + margin;
    this.card.style.left = `${Math.max(8, left)}px`;
    this.card.style.top = `${top}px`;
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
      c.metrics.length ? el("hr") : undefined,
      ...c.metrics.map((r) => this.rowView(r)),
      changes.length ? el("hr") : undefined,
      ...changes.map((r) => this.rowView(r)),
      c.flags.length ? el("div", { class: "muted", text: c.flags.join(", ") }) : undefined,
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
    const file = s.model.files[this.modelIndex(union)];
    if (!file) return;
    clear(this.details);
    const close = el("button", {
      text: "Close",
      title: "Close (Escape)",
      class: "quiet",
      attrs: { type: "button" },
    });
    close.addEventListener("click", () => this.closeDetails());
    const rows = el("div", { class: "kvs" });
    for (const m of s.model.metrics.values()) {
      if (m.scope !== "file") continue;
      const row = metricRow(s.model, m.id, file.values, format);
      if (!row) continue;
      const stats = s.model.stats.get(m.id);
      const rank =
        file.values[m.id] !== undefined && stats && m.kind !== "category"
          ? percentileRank(stats, file.values[m.id] as number)
          : undefined;
      rows.append(
        el(
          "div",
          { class: "kv", title: `${m.definition} ${m.limits}` },
          el("span", { class: "k", text: m.label }),
          el("span", { class: row.value === "n/a" ? "v na" : "v", text: row.value }),
          rank !== undefined
            ? el("span", { class: "muted", text: `higher than ${format.percent(rank)} of files` })
            : undefined,
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
      const index = f.info.index;
      jump.addEventListener("click", () => this.animator?.goTo(index));
      history.append(
        el("div", { class: "kv" }, jump, el("span", { class: "muted", text: format.date(f.info.date) })),
      );
    }
    this.details.append(
      el("div", { class: "details-head" }, el("h2", { text: file.name }), close),
      el("div", { class: "muted", text: file.path }),
      rows,
      el("h3", { text: "Risk flags" }),
      el("p", { class: "muted", text: "None computed at this data level." }),
      el("h3", { text: "History" }),
      s.data.frames.length < 2
        ? el("p", {
            class: "muted",
            text: "Build a timeline (factory-city timeline) to see the frames that touched this file.",
          })
        : touching.length === 0
          ? el("p", { class: "muted", text: "No frame of this timeline changed this file." })
          : history,
    );
    this.details.hidden = false;
  }

  private closeDetails(): void {
    this.details.hidden = true;
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
    this.helpDialog.hidden = false;
  }

  private hideHelp(): void {
    this.helpDialog.hidden = true;
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
      case "?":
        this.toggleHelp();
        break;
      case "Escape":
        // a menu or a help popover closes first; the panels stay
        if (closePopovers(document)) break;
        this.healthPanel.hidden = true;
        this.factoryPanel.hidden = true;
        this.closeDetails();
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
    const close = el("button", {
      text: "Close",
      title: "Close (Escape)",
      class: "quiet",
      attrs: { type: "button" },
    });
    close.addEventListener("click", () => {
      panel.hidden = true;
    });
    panel.append(el("div", { class: "details-head" }, el("h2", { text: "Factory" }), close));
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
    const close = el("button", {
      text: "Close",
      title: "Close (Escape)",
      class: "quiet",
      attrs: { type: "button" },
    });
    close.addEventListener("click", () => {
      panel.hidden = true;
    });
    panel.append(el("div", { class: "details-head" }, el("h2", { text: "Code health" }), close));
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

  private rightPanels(): HTMLElement[] {
    return [this.details, this.healthPanel, this.factoryPanel];
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
    const right = this.rightPanels()
      .map(shown)
      .filter((r) => r !== undefined);
    this.healthButton.setAttribute("aria-pressed", String(!this.healthPanel.hidden));
    this.factoryButton.setAttribute("aria-pressed", String(!this.factoryPanel.hidden));
    const insets = {
      top: header ? header.bottom - stage.top : 0,
      left: left ? left.right - stage.left : 0,
      right: right.length ? stage.right - Math.min(...right.map((r) => r.left)) : 0,
      bottom: bottom ? stage.bottom - bottom.top : 0,
    };
    // what sits on the stage (the legend) places itself in the free area through these
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
    const canvas = this.scene.renderToCanvas(width, height);
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
        });
    }
    return canvas;
  }
}
