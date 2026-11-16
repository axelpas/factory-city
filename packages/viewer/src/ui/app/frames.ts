import { format } from "../../lib/format";
import { biggestChanges, CHANGE, changePlacements } from "../../view/change";
import { parseHex } from "../../view/color";
import { frameState } from "../../view/frame-state";
import { healthView } from "../../view/health";
import { computePlacements, computeTints } from "../../view/placements";
import type { Hub } from "./hub";

/** What is drawn for each frame, and what the page says about the frame under the playhead. */
export class Frames {
  constructor(private readonly hub: Hub) {}

  /** On-screen values of every file for one frame, with the current mapping and filters. Cached per frame. */
  stateOf(frameIndex: number): Float32Array {
    const { session } = this.hub;
    const cached = session.stateCache.get(frameIndex);
    if (cached) return cached;
    const s = session.state;
    if (!s) return new Float32Array(0);
    const state = frameState(s, session.theme, frameIndex);
    session.stateCache.set(frameIndex, state);
    return state;
  }

  /** The buildings as drawn right now; recomputed only when the picture changed. */
  onScreen(): Float32Array {
    const session = this.hub.session;
    const a = session.animator;
    if (!a) return new Float32Array(0);
    if (!session.screen || session.screen.u !== a.progress || session.screen.version !== session.version) {
      session.screen = { u: a.progress, version: session.version, state: a.onScreen() };
    }
    return session.screen.state;
  }

  /** Index of a union file in the model of the current frame, or -1. */
  modelIndex(union: number): number {
    const { state, animator } = this.hub.session;
    const frame = state?.data.frames[animator?.frame ?? 0];
    return frame ? (frame.modelIndex[union] as number) : -1;
  }

  /** The files of the frame shown, for the file finder. */
  finderFiles(): Array<{ path: string; union: number }> {
    const s = this.hub.session.state;
    if (!s) return [];
    const out: Array<{ path: string; union: number }> = [];
    for (let union = 0; union < s.data.paths.length; union++)
      if (this.modelIndex(union) >= 0) out.push({ path: s.data.paths[union] ?? "", union });
    return out;
  }

  /** The mapping, a filter or the theme changed: move from the current picture to the new one. */
  refresh(): void {
    const { session, ui } = this.hub;
    const a = session.animator;
    if (!session.state || !a) return;
    session.stateCache.clear();
    a.retarget((f) => this.stateOf(f), session.theme.ramps.sequential.map(parseHex));
    this.updateFrameViews(true);
    ui.headerBar.updatePresetSelect();
  }

  /** Everything that depends on the frame under the playhead: legend, tints, label, totals, status. */
  updateFrameViews(force = false): void {
    const { session, ui, parts } = this.hub;
    const s = session.state;
    const a = session.animator;
    if (!s || !a) return;
    if (!force && a.frame === session.shownFrame) return;
    session.shownFrame = a.frame;
    const theme = session.theme;
    const compared =
      s.mapping.color === CHANGE ? changePlacements(s.data, a.frame, s.layout, s.mapping, theme) : undefined;
    s.legend = compared?.legend ?? computePlacements(s.model, s.layout, s.mapping, theme).legend;
    ui.notes.renderChanges(compared ? biggestChanges(compared.changes) : []);
    ui.scene.setPlinthTints(computeTints(s.model, s.mapping, theme));
    ui.bar.showFrame(a.frame, a.reducedMotion ?? false);
    ui.notes.renderLegend();
    ui.notes.renderStatus();
    if (!ui.healthPanel.hidden) parts.docks.renderHealth();
    this.renderScore();
  }

  /** The score box for the frame shown. */
  renderScore(): void {
    const { session, ui } = this.hub;
    const s = session.state;
    if (!s) return;
    const frame = session.animator?.frame ?? 0;
    ui.scoreBox.render(healthView(s.data, frame, session.report, format), frame);
  }
}
