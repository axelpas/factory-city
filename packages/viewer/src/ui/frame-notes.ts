import type { Layout } from "@factory-city/layout";
import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import { describeCity } from "../view/describe";
import { legendModel } from "../view/legend";
import { statusChip, statusDetails } from "../view/status";
import { blockLegend, blockSize } from "../view/voxel";
import { renderLegendBox } from "./legend-box";
import { renderStatusChip } from "./status-chip";
import type {
  Animator,
  CityScene,
  ColorLegend,
  FileChange,
  LegendModel,
  Mapping,
  Model,
  Preset,
  Theme,
  TimelineData,
} from "./types";

/** What the notes say about the city. */
export interface NotesState {
  data: TimelineData;
  model: Model;
  layout: Layout;
  preset: Preset | undefined;
  mapping: Mapping;
  legend: ColorLegend;
}

export interface FrameNotesHost {
  scene(): CityScene;
  stage(): HTMLElement;
  state(): NotesState | undefined;
  animator(): Animator | undefined;
  theme(): Theme;
  /** Index of a union file in the model of the current frame, or -1. */
  modelIndex(union: number): number;
  /** The building was chosen in the list of changes. */
  openDetails(union: number): void;
}

/**
 * What the page says about the frame in words: the legend pinned at the bottom left, the status chip, the text
 * a screen reader gets for the picture, and the list of the biggest changes.
 */
export class FrameNotes {
  readonly legendBox = el("section", { class: "legend", attrs: { "aria-label": "Legend", hidden: "" } });
  readonly changesBox = el("section", { class: "changes", attrs: { hidden: "" } });
  readonly status = el("footer", { class: "status" });
  /** What a screen reader is told about the picture; the canvas points at it. */
  readonly description = el("p", { class: "sr-only", attrs: { id: "city-description" } });
  /** Shown with `?fps` in the address: images per second, for performance checks. */
  readonly fpsBox = new URLSearchParams(location.search).has("fps")
    ? el("span", { class: "fps" })
    : undefined;

  constructor(private readonly host: FrameNotesHost) {}

  /** Compare view: the largest changes of the frame; a click flies to the building. */
  renderChanges(changes: FileChange[]): void {
    const s = this.host.state();
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
        if (rect) this.host.scene().focus(rect.x + rect.w / 2, rect.y + rect.h / 2);
        if (this.host.modelIndex(c.union) >= 0) this.host.openDetails(c.union);
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

  /** For a theme made of blocks: what one block is worth. */
  blockNote(): string | undefined {
    const s = this.host.state();
    const block = s ? blockSize(this.host.theme(), s.layout.width) : undefined;
    if (!s || block === undefined) return undefined;
    return blockLegend(
      s.model.metrics.get(s.mapping.height)?.label ?? s.mapping.height,
      s.model.stats.get(s.mapping.height),
      s.mapping.scale,
      s.mapping.clampP99,
      this.host.theme().heightScale * s.layout.width,
      block,
      (n) => format.number(n, 1),
    );
  }

  legend(): LegendModel | undefined {
    const s = this.host.state();
    if (!s) return undefined;
    return legendModel(s.model, s.mapping, s.legend, this.host.theme().mode, format.number, this.blockNote());
  }

  renderLegend(): void {
    const s = this.host.state();
    const legend = this.legend();
    this.legendBox.hidden = !s || !legend;
    if (s && legend) renderLegendBox(this.legendBox, legend, s.model, this.host.theme());
    // the legend is pinned at the bottom left: the timeline and the chip start to its right
    this.host
      .stage()
      .parentElement?.style.setProperty(
        "--legend-room",
        this.legendBox.hidden ? "0px" : "calc(var(--legend-w) + var(--gutter))",
      );
  }

  /** The text a screen reader gets for the picture: the question asked, the counts and the frame. */
  private describe(): void {
    const s = this.host.state();
    if (!s) return;
    const frames = s.data.frames;
    const index = this.host.animator()?.frame ?? 0;
    const frame = frames.length > 1 ? frames[index]?.info : undefined;
    this.description.textContent = describeCity(
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
    this.host
      .scene()
      .canvas.setAttribute("aria-label", `City of ${s.model.project}: every building is a file`);
  }

  renderStatus(): void {
    const s = this.host.state();
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
}
