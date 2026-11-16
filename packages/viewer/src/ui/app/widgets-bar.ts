import type { SourceKey } from "../../data/load";
import { HoverCard } from "../hover-card";
import { Inspector } from "../inspector";
import { ScoreBox } from "../score-box";
import { TimelineBar } from "../timeline-bar";
import type { Hub, Widgets } from "./hub";
import { INSPECTOR_KEY, safeStorage } from "./session";

type Bar = Pick<Widgets, "scoreBox" | "inspector" | "bar" | "card">;

/** The timeline bar, the card that follows the pointer, and the inspector on the right with its score box. */
export function buildBar(hub: Hub): Bar {
  const { session, parts } = hub;
  const scoreBox = new ScoreBox();
  const inspector = new Inspector({
    panes: { health: hub.ui.healthPanel, file: hub.ui.selection.element, factory: hub.ui.factoryPanel },
    summary: scoreBox.element,
    onTab: (tab) => parts.docks.openTab(tab),
    onChange: (tab) => {
      // folding the inspector ends the selection
      if (tab === undefined) hub.ui.selection.clearOutline();
    },
    width: Number(safeStorage(() => localStorage.getItem(INSPECTOR_KEY))) || undefined,
    onResize: (width) => safeStorage(() => localStorage.setItem(INSPECTOR_KEY, String(Math.round(width)))),
  });
  const card = new HoverCard({
    state: () => session.state,
    frame: () => session.animator?.frame ?? 0,
    report: () => session.report,
    modelIndex: (union) => parts.frames.modelIndex(union),
    stage: hub.ui.stage,
    insets: () => session.insets,
  });
  const bar = new TimelineBar({
    onPlayPause: () => parts.playback.togglePlay(),
    onStep: (delta) => parts.playback.step(delta),
    onSeek: (position) => {
      session.animator?.pause();
      session.animator?.setPosition(position);
      card.hide();
    },
    onJump: (frame) => session.animator?.goTo(frame),
    onSpeed: (speed) => {
      if (session.animator) session.animator.speed = speed;
    },
    onLoop: (loop) => {
      if (session.animator) session.animator.loop = loop;
    },
    onOrbit: (orbit) => hub.ui.scene.setOrbit(orbit),
    onSource: (key) => {
      void parts.loader.openSource(key as SourceKey);
    },
  });
  return { scoreBox, inspector, bar, card };
}
