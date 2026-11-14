import type { Layout } from "@factory-city/layout";
import { computeLayout } from "@factory-city/layout";
import { type Loaded, loadProject, loadProjects, readDropped } from "../data/load";
import { buildModel, type Model, percentileRank } from "../data/model";
import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import { makePathFilter } from "../lib/glob";
import { defaultMapping, type Mapping, MIN_COVERAGE, type Preset, presetStatuses } from "../presets/index";
import { CityScene, type Pick } from "../scene/CityScene";
import { applyTheme, DEFAULT_THEME, type Theme } from "../themes/index";
import { type CardRow, type FileCard, type FolderCard, fileCard, folderCard, metricRow } from "../view/card";
import { cssGradient, parseHex, toCss } from "../view/color";
import { dataLevelLine, hiddenContentLine, legendLines } from "../view/legend";
import { type ColorLegend, computePlacements, computeTints } from "../view/placements";
import { SCALE_KINDS, type ScaleKind } from "../view/scales";
import { drawOverlay } from "./overlay";

type TestsMode = "show" | "dim" | "hide";
type Role = "area" | "height" | "color" | "twist" | "tint";

interface State {
  model: Model;
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

function safeStorage<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** The whole viewer: panels, pickers, legend, hover card, details and export, around one CityScene. */
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
  private readonly presetSelect = el("select", {
    title: "Presets set all channels at once and answer one question",
    attrs: { "aria-label": "Preset" },
  });
  private readonly presetQuestion = el("span", { class: "question" });
  private state: State | undefined;
  private rafPending = false;
  private pointer = { x: 0, y: 0, down: false, moved: false, startX: 0, startY: 0 };

  constructor(root: HTMLElement) {
    applyTheme(this.theme, document.documentElement);
    this.stage = el("div", { class: "stage" });
    root.append(
      this.stage,
      this.buildHeader(),
      this.panel,
      this.status,
      this.card,
      this.details,
      this.helpDialog,
      this.dropZone,
    );
    this.scene = new CityScene(this.stage, this.theme);
    this.wireEvents();
    this.renderDropZone("Loading…");
  }

  /** Loads the project list, then the current project; falls back to the drop zone. */
  async start(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const list = await loadProjects();
    this.fillProjectSelect(list.projects, params.get("project") ?? list.current);
    const slug = params.get("project") ?? list.current;
    if (!slug) {
      this.renderDropZone(
        "No analyzed project found. Run factory-city in a folder, or drop a snapshot.cc.json file here.",
      );
      return;
    }
    try {
      this.open(await loadProject(slug));
    } catch (err) {
      this.renderDropZone(`Could not load "${slug}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  open(loaded: Loaded): void {
    const model = buildModel(loaded.cc, loaded.manifest);
    const { preset, mapping } = defaultMapping(model);
    this.dropZone.hidden = true;
    this.state = {
      model,
      layout: this.layoutFor(model, mapping),
      preset,
      mapping,
      legend: { kind: "none", metric: null },
      search: "",
      tests: "show",
      hover: null,
      pinned: null,
    };
    document.title = `${model.project} · Factory City`;
    this.scene.setCity(this.state.layout, model.files.length);
    this.buildPanel();
    this.refresh();
    this.closeDetails();
    if (!safeStorage(() => localStorage.getItem(HELP_KEY))) this.showHelp();
  }

  // ---------------------------------------------------------------- header

  private buildHeader(): HTMLElement {
    const button = (label: string, title: string, onClick: () => void) => {
      const b = el("button", { text: label, title, attrs: { type: "button" } });
      b.addEventListener("click", onClick);
      return b;
    };
    this.presetSelect.addEventListener("change", () => this.choosePreset(this.presetSelect.value));
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
    this.panel.append(search, tests, this.legendBox);
  }

  private usable(role: Role): string[] {
    const s = this.state;
    if (!s) return [];
    return [...s.model.metrics.values()]
      .filter((m) => m.id !== "is_test")
      .filter((m) => (role === "tint" ? m.scope === "folder" : m.scope === "file"))
      .filter((m) => role === "color" || m.kind !== "category")
      .filter((m) => (s.model.coverage.get(m.id) ?? 0) >= MIN_COVERAGE)
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
    const status = presetStatuses(s.model).find((p) => p.preset.id === id);
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

  private layoutFor(model: Model, mapping: Mapping): Layout {
    return computeLayout(model.files.map((f) => ({ path: f.path, weight: f.values[mapping.area] ?? 1 })));
  }

  private relayoutAndRefresh(): void {
    const s = this.state;
    if (!s) return;
    s.layout = this.layoutFor(s.model, s.mapping);
    this.scene.setCity(s.layout, s.model.files.length);
    this.refresh();
  }

  private updatePresetSelect(): void {
    const s = this.state;
    if (!s) return;
    clear(this.presetSelect);
    if (!s.preset)
      this.presetSelect.append(el("option", { text: "Custom", attrs: { value: "", selected: "" } }));
    for (const status of presetStatuses(s.model)) {
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

  /** Recomputes placements, legend, filters and status, then redraws. */
  private refresh(): void {
    const s = this.state;
    if (!s) return;
    const { placements, legend } = computePlacements(s.model, s.layout, s.mapping, this.theme);
    s.legend = legend;
    const match = makePathFilter(s.search);
    const dimmed = new Set<number>();
    const hidden = new Set<number>();
    s.model.files.forEach((f, i) => {
      if (match && !match(f.path)) dimmed.add(i);
      if (f.isTest && s.tests === "dim") dimmed.add(i);
      if (f.isTest && s.tests === "hide") hidden.add(i);
    });
    this.scene.setPlacements(placements, { dimmed, hidden });
    this.scene.setPlinthTints(computeTints(s.model, s.mapping, this.theme));
    this.renderLegend();
    this.renderStatus();
    this.updatePresetSelect();
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

  private updateHover(x: number, y: number): void {
    const s = this.state;
    if (!s) return;
    const pick = this.scene.pick(x, y);
    s.hover = pick;
    if (!pick) {
      this.scene.setHover(null);
      this.hideCard();
      return;
    }
    const rect =
      pick.kind === "folder"
        ? s.layout.folders.get(pick.path)
        : s.layout.folders.get(s.model.files[pick.index]?.dir ?? "");
    this.scene.setHover(pick, rect);
    this.showCard(pick, x, y);
  }

  private onClick(e: PointerEvent): void {
    const s = this.state;
    if (!s) return;
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
      const rect =
        pick?.kind === "folder"
          ? s.layout.folders.get(pick.path)
          : pick
            ? s.layout.folders.get(s.model.files[pick.index]?.dir ?? "")
            : undefined;
      this.scene.setHover(pick, rect);
      if (pick) this.showCard(pick, e.clientX, e.clientY);
      else this.hideCard();
      return;
    }
    if (pick?.kind === "file") this.openDetails(pick.index);
    else this.closeDetails();
  }

  private showCard(pick: NonNullable<Pick>, x: number, y: number): void {
    const s = this.state;
    if (!s) return;
    const data =
      pick.kind === "file"
        ? fileCard(s.model, pick.index, s.mapping, format)
        : folderCard(s.model, pick.path, format);
    clear(this.card);
    this.card.append(data.kind === "file" ? this.fileCardView(data) : this.folderCardView(data));
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

  private fileCardView(c: FileCard): HTMLElement {
    return el(
      "div",
      {},
      el("div", { class: "card-title", text: c.title }),
      el("div", { class: "muted", text: c.folder }),
      el("div", { class: "muted", text: `${c.language}${c.isTest ? " · test" : ""}` }),
      ...c.channels.map((r) => this.rowView(r)),
      c.metrics.length ? el("hr") : undefined,
      ...c.metrics.map((r) => this.rowView(r)),
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

  private openDetails(index: number): void {
    const s = this.state;
    if (!s) return;
    const file = s.model.files[index];
    if (!file) return;
    clear(this.details);
    const close = el("button", { text: "Close", title: "Close (Escape)", attrs: { type: "button" } });
    close.addEventListener("click", () => this.closeDetails());
    const rows = el("div", { class: "kvs" });
    for (const m of s.model.metrics.values()) {
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
    this.details.append(
      el("div", { class: "details-head" }, el("h2", { text: file.name }), close),
      el("div", { class: "muted", text: file.path }),
      rows,
      el("h3", { text: "Risk flags" }),
      el("p", { class: "muted", text: "None computed at this data level." }),
      el("h3", { text: "History" }),
      el("p", {
        class: "muted",
        text: "The file's history across frames and the issues that touched it appear with a timeline (data level 1).",
      }),
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
    const available = presetStatuses(s.model).filter((p) => p.available);
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
