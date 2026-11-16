import { readEmbedded } from "../../data/embedded";
import {
  defaultSource,
  type Loaded,
  loadAvailable,
  loadProjects,
  loadSource,
  type SourceKey,
  selectableSources,
} from "../../data/load";
import type { Model } from "../../data/model";
import { syntheticSnapshots } from "../../data/synthetic";
import { buildTimelineData, type FrameData, type TimelineData } from "../../data/timeline";
import { format } from "../../lib/format";
import { defaultMapping, type Mapping, type Preset, presetStatuses } from "../../presets/index";
import type { Hub } from "./hub";
import { HELP_KEY, type State, safeStorage } from "./session";

/** Gets the data into the page: the project list, the source chosen, a dropped file, a standalone file. */
export class Loader {
  constructor(private readonly hub: Hub) {}

  /** Loads the project list, then the current project; falls back to the drop zone. */
  async start(): Promise<void> {
    const { session, ui } = this.hub;
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
    ui.headerBar.fillProjectSelect(list.projects, params.get("project") ?? list.current);
    session.slug = params.get("project") ?? list.current;
    if (!session.slug) {
      ui.dropZone.say(
        "No analyzed project found. Run factory-city in a folder, or drop a snapshot.cc.json file here.",
      );
      return;
    }
    session.available = await loadAvailable(session.slug);
    const source = this.firstSource(params.get("source") as SourceKey | null);
    if (!source) {
      ui.dropZone.say(`No data found for "${session.slug}". Run factory-city analyze or timeline first.`);
      return;
    }
    await this.openSource(source);
  }

  /** The source asked for when it exists; a snapshot is the last frame of a timeline, so it is opened only alone. */
  private firstSource(wanted: SourceKey | null): SourceKey | undefined {
    const { available } = this.hub.session;
    const ok = wanted && available[wanted] && selectableSources(available).includes(wanted);
    return ok ? (wanted as SourceKey) : defaultSource(available);
  }

  async openSource(source: SourceKey): Promise<void> {
    const { session, ui } = this.hub;
    const manifest = session.available[source];
    if (!manifest || !session.slug) return;
    ui.headerBar.fillSources(source);
    try {
      ui.dropZone.say("Loading…");
      const loaded = await loadSource(session.slug, manifest, (done, total) => {
        if (total > 1) ui.dropZone.say(`Loading frame ${format.integer(done)} of ${format.integer(total)}…`);
      });
      this.open(loaded);
    } catch (err) {
      ui.dropZone.say(
        `Could not load "${session.slug}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** The preset and the mapping to start with: `?preset=` asks for one, a diff opens on Change. */
  private startingMapping(loaded: Loaded, lastModel: Model) {
    const params = new URLSearchParams(location.search);
    const isDiff = loaded.manifest?.kind === "timeline" && loaded.manifest.source.mode === "diff";
    const wanted = params.get("preset") ?? (isDiff ? "change" : undefined);
    const chosen = wanted
      ? presetStatuses(lastModel, loaded.report?.dimensions).find(
          (p) => p.preset.id === wanted && p.available,
        )
      : undefined;
    return chosen?.mapping
      ? { preset: chosen.preset, mapping: chosen.mapping }
      : defaultMapping(lastModel, loaded.report?.dimensions);
  }

  open(loaded: Loaded): void {
    const { session, ui, parts } = this.hub;
    const data = buildTimelineData(loaded.snapshots, loaded.manifest);
    ui.headerBar.renderContext(loaded, data.project);
    const last = data.frames[data.frames.length - 1];
    if (!last) {
      ui.dropZone.say("This data holds no frame.");
      return;
    }
    const { preset, mapping } = this.startingMapping(loaded, last.model);
    if (session.theme.scale && mapping.scale !== session.theme.scale) {
      session.scaleBeforeTheme = mapping.scale;
      mapping.scale = session.theme.scale;
    }
    ui.dropZone.hidden = true;
    session.state = this.newState(data, last, preset, mapping);
    session.report = loaded.report;
    session.factory = loaded.factory;
    ui.factoryPanel.hidden = true;
    document.title = `${data.project} · Factory City`;
    session.animator = undefined;
    parts.playback.buildCity(false);
    ui.viewPanel.build();
    ui.bar.setFrames(data.frames.map((f) => f.info));
    parts.frames.refresh();
    ui.selection.close();
    if (!safeStorage(() => localStorage.getItem(HELP_KEY))) ui.help.show();
  }

  /** The state of a freshly opened project; its model is the one of the frame under the playhead. */
  private newState(data: TimelineData, last: FrameData, preset: Preset | undefined, mapping: Mapping): State {
    const { session, parts } = this.hub;
    return {
      data,
      get model() {
        return (data.frames[session.animator?.frame ?? data.frames.length - 1] ?? last).model;
      },
      ref: last.model,
      layout: parts.presets.layoutFor(data, mapping),
      preset,
      mapping,
      legend: { kind: "none", metric: null },
      search: "",
      tests: "show",
      hover: null,
      pinned: null,
    };
  }
}
