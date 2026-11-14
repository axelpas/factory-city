import type { Layout, Rect } from "@factory-city/layout";
import { computeLayout } from "@factory-city/layout";
import { Animator } from "../anim/animator";
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
import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import { makePathFilter } from "../lib/glob";
import { defaultMapping, type Mapping, MIN_COVERAGE, type Preset, presetStatuses } from "../presets/index";
import { CityScene, type Pick } from "../scene/CityScene";
import { applyTheme, DEFAULT_THEME, type Theme } from "../themes/index";
import {
  type CardRow,
  type FileCard,
  type FolderCard,
  fileCard,
  folderCard,
  frameChangeRows,
  lotCard,
  metricRow,
} from "../view/card";
import { cssGradient, parseHex, toCss } from "../view/color";
import { dataLevelLine, hiddenContentLine, legendLines } from "../view/legend";
import { type ColorLegend, computePlacements, computeTints } from "../view/placements";
import { SCALE_KINDS, type ScaleKind } from "../view/scales";
import { buildDelays, buildState } from "../view/state";
import { drawOverlay } from "./overlay";
import { TimelineBar } from "./timeline-bar";

function dirOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

type TestsMode = "show" | "dim" | "hide";

type Role = "area" | "height" | "color" | "twist" | "tint";

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
  private readonly theme: Theme = DEFAULT_THEME;
  private readonly stage: HTMLElement;
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
  private readonly legendBox = el("section", { class: "legend" });
  private readonly status = el("footer", { class: "status" });
  private readonly projectSelect = el("select", {
    title: "Switch project",
    attrs: { "aria-label": "Project" },
  });
  private readonly sourceSelect = el("select", {
    title: "Single snapshot, or a timeline per commit or per day",
    attrs: { "aria-label": "Snapshot or timeline", hidden: "" },
  });
  private readonly presetSelect = el("select", {
    title: "Presets set all channels at once and answer one question",
    attrs: { "aria-label": "Preset" },
  });
  private readonly presetQuestion = el("span", { class: "question" });
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
    root.append(
      this.stage,
      this.buildHeader(),
      this.panel,
      this.bar.element,
      this.status,
      this.card,
      this.details,
      this.helpDialog,
      this.dropZone,
    );
    this.scene = new CityScene(this.stage, this.theme);
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
    const { preset, mapping } = defaultMapping(last.model);
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
    const button = (label: string, title: string, onClick: () => void) => {
      const b = el("button", { text: label, title, attrs: { type: "button" } });
      b.addEventListener("click", onClick);
      return b;
    };
    this.presetSelect.addEventListener("change", () => this.choosePreset(this.presetSelect.value));
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
      { class: "menu" },
      el("summary", { text: "Export", title: "Export the current view as a PNG (E)" }),
    );
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
    exportMenu.append(list);
    return el(
      "header",
      { class: "bar" },
      el("strong", { class: "brand", text: "Factory City" }),
      this.projectSelect,
      this.sourceSelect,
      this.presetSelect,
      this.presetQuestion,
      el("span", { class: "spacer" }),
      button("Top view", "Look straight down (V)", () => this.scene.topView()),
      button("Reset", "Back to the default view (R)", () => this.scene.resetCamera()),
      exportMenu,
      button("?", "How to read this city, and keyboard shortcuts (?)", () => this.toggleHelp()),
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

  private fillSourceSelect(current: SourceKey): void {
    const labels: Record<SourceKey, string> = {
      snapshot: "Snapshot",
      commit: "Timeline per commit",
      day: "Timeline per day",
      issue: "Timeline per issue",
      revs: "Chosen revisions",
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
    this.panel.append(this.picker("area", "Ground area", "Metric that sets how much ground a file gets"));
    this.panel.append(this.picker("height", "Height", "Metric that sets how tall a building is"));
    this.panel.append(this.picker("color", "Color", "Metric that colors a building"));
    this.panel.append(
      this.picker("twist", "Twist", "Optional: turns a building by a metric (more twist = less cohesive)"),
    );
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
    const motion = el("select", {
      title: "Auto follows your system's reduced-motion setting",
      attrs: { "aria-label": "Motion" },
    });
    for (const [value, label] of [
      ["auto", "Motion: auto"],
      ["full", "Motion: full"],
      ["reduced", "Motion: reduced"],
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
    this.panel.append(search, tests, motion, this.legendBox);
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
    if (role === "twist" || role === "tint")
      select.append(el("option", { text: "none", attrs: { value: "" } }));
    const current = s.mapping[role];
    for (const id of this.usable(role)) {
      const m = s.model.metrics.get(id);
      const o = el("option", { text: m?.label ?? id, attrs: { value: id } });
      if (id === current) o.selected = true;
      select.append(o);
    }
    select.addEventListener("change", () => {
      const optional = role === "color" || role === "twist" || role === "tint";
      this.setMapping({ [role]: optional ? select.value || null : select.value });
    });
    const help = el(
      "details",
      { class: "metric-help" },
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
    const status = presetStatuses(s.ref).find((p) => p.preset.id === id);
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
    clear(this.presetSelect);
    if (!s.preset)
      this.presetSelect.append(el("option", { text: "Custom", attrs: { value: "", selected: "" } }));
    for (const status of presetStatuses(s.ref)) {
      const o = el("option", {
        text: `${status.preset.group} · ${status.preset.label}${status.available ? "" : " (unavailable)"}`,
        title: status.available ? status.preset.question : (status.reason ?? ""),
        attrs: { value: status.preset.id },
      });
      o.disabled = !status.available;
      if (s.preset?.id === status.preset.id) o.selected = true;
      this.presetSelect.append(o);
    }
    this.presetQuestion.textContent = s.preset?.question ?? "Custom mapping";
  }

  // --------------------------------------------------------------- refresh

  /** On-screen values of every file for one frame, with the current mapping and filters. Cached per frame. */
  private stateOf(frameIndex: number): Float32Array {
    const cached = this.stateCache.get(frameIndex);
    if (cached) return cached;
    const s = this.state;
    const frame = s?.data.frames[frameIndex];
    if (!s || !frame) return new Float32Array(0);
    const { placements } = computePlacements(frame.model, s.layout, s.mapping, this.theme);
    const match = makePathFilter(s.search);
    const dimmed = new Set<number>();
    const hidden = new Set<number>();
    const aligned = s.data.paths.map((path, u) => {
      const m = frame.modelIndex[u] as number;
      if (m < 0) return undefined;
      const file = frame.model.files[m];
      if (match && !match(path)) dimmed.add(u);
      if (file?.isTest && s.tests === "dim") dimmed.add(u);
      if (file?.isTest && s.tests === "hide") hidden.add(u);
      return placements[m];
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
    s.legend = computePlacements(s.model, s.layout, s.mapping, this.theme).legend;
    this.scene.setPlinthTints(computeTints(s.model, s.mapping, this.theme));
    this.bar.showFrame(a.frame, this.animator?.reducedMotion ?? false);
    this.renderLegend();
    this.renderStatus();
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

  private renderLegend(): void {
    const s = this.state;
    if (!s) return;
    clear(this.legendBox);
    this.legendBox.append(el("h2", { text: "Legend" }));
    for (const line of legendLines(s.model, s.mapping)) {
      this.legendBox.append(
        el(
          "p",
          { class: "legend-line" },
          el("b", { text: `${line.channel}: ` }),
          `${line.metric} — ${line.text}`,
        ),
      );
    }
    const l = s.legend;
    if (l.kind === "sequential" && l.min !== undefined && l.max !== undefined) {
      const stops = this.theme.ramps.sequential.map(parseHex);
      this.legendBox.append(
        el("div", {
          class: "ramp",
          style: { background: cssGradient(stops) },
          attrs: { role: "img", "aria-label": "Color scale from low to high" },
        }),
        el(
          "div",
          { class: "ramp-labels" },
          el("span", { text: format.number(l.min) }),
          el("span", { text: `${l.clamped ? "≥ " : ""}${format.number(l.max)}` }),
        ),
      );
    } else if (l.kind === "categorical" && l.categories) {
      const list = el("ul", { class: "swatches" });
      for (const c of l.categories) {
        const roof = el("i", { class: "roof", style: { width: `${25 + 55 * c.roofMark}%` } });
        list.append(
          el(
            "li",
            {},
            el("span", { class: "swatch", style: { background: toCss(c.color) } }, roof),
            ` ${c.label} (${format.integer(c.count)})`,
          ),
        );
      }
      this.legendBox.append(list);
    }
    if (s.model.metrics.has("is_test"))
      this.legendBox.append(
        el("p", { class: "muted", text: "Exact values are in the card and the details panel." }),
      );
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
        const changes = frameChangeRows(s.data, frame, pick.index, s.mapping, format);
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
    const close = el("button", { text: "Close", title: "Close (Escape)", attrs: { type: "button" } });
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
    const close = el("button", { text: "Got it", attrs: { type: "button" } });
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
      ["E", "export a PNG"],
      ["?", "this help"],
      ["Esc", "close panels"],
    ];
    this.helpDialog.append(
      el("h2", { text: "How to read this city" }),
      el("p", {
        text: "Each building is a file, each plinth a folder. Ground area, height and color show metrics you can change.",
      }),
      el("p", {
        text: "Point at a building for its card, click it for all its metrics. Drag to orbit, scroll to zoom, right-drag to pan.",
      }),
      el("p", { text: "n/a means a value could not be computed for that file: it is never shown as zero." }),
      sample,
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
      case "p":
      case "P":
        this.nextPreset();
        break;
      case "e":
      case "E":
        this.exportPng(2, true);
        break;
      case "?":
        this.toggleHelp();
        break;
      case "Escape":
        this.closeDetails();
        if (!this.helpDialog.hidden) this.hideHelp();
        break;
      default:
    }
  }

  private nextPreset(): void {
    const s = this.state;
    if (!s) return;
    const available = presetStatuses(s.ref).filter((p) => p.available);
    if (available.length === 0) return;
    const at = available.findIndex((p) => p.preset.id === s.preset?.id);
    const next = available[(at + 1) % available.length];
    if (next) this.choosePreset(next.preset.id);
  }

  // ---------------------------------------------------------------- export

  /** PNG of the current view at 1x, 2x or 4K, with or without the overlay. */
  private exportPng(size: number | "4k", withOverlay: boolean): void {
    const s = this.state;
    if (!s) return;
    const base = this.stage.getBoundingClientRect();
    const width = size === "4k" ? 3840 : Math.round(base.width * size);
    const height = size === "4k" ? 2160 : Math.round(base.height * size);
    const canvas = this.scene.renderToCanvas(width, height);
    if (withOverlay) {
      const ctx = canvas.getContext("2d");
      if (ctx)
        drawOverlay(ctx, width, height, {
          theme: this.theme,
          project: s.model.project,
          preset: s.preset?.label ?? "Custom",
          lines: legendLines(s.model, s.mapping),
          legend: s.legend,
        });
    }
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = el("a", { attrs: { href: url, download: `${s.model.project}-city.png` } });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, "image/png");
  }
}
