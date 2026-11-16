import { Animator } from "../../anim/animator";
import { format } from "../../lib/format";
import { parseHex } from "../../view/color";
import { scoreAt } from "../../view/health";
import { buildDelays } from "../../view/state";
import type { Hub } from "./hub";

/** The animation of the timeline: build it for a layout, play and pause it, step through the frames. */
export class Playback {
  constructor(private readonly hub: Hub) {}

  /** Builds the scene for the current layout and a new animator; keeps what is on screen when there is something. */
  buildCity(keepCamera: boolean): void {
    const { session, ui, parts } = this.hub;
    const s = session.state;
    if (!s) return;
    const before = session.animator;
    const snapshot = before?.onScreen();
    const delays = buildDelays(s.data.paths, s.layout);
    ui.scene.setCity(s.layout, s.data.paths, delays, keepCamera);
    ui.districtLabels.setLayout(s.layout);
    const animator = new Animator(s.data.paths.length, delays, session.theme.ramps.sequential.map(parseHex), {
      states: (start, target) => {
        ui.scene.setStates(start, target);
        session.version++;
      },
      progress: (u) => ui.scene.setProgress(u),
      cut: () => this.crossFade(),
    });
    animator.speed = before?.speed ?? 1;
    animator.loop = before?.loop ?? false;
    session.animator = animator;
    this.applyMotion();
    session.stateCache.clear();
    const position = before ? before.frame : s.data.frames.length - 1;
    animator.reset(s.data.frames.length, (f) => parts.frames.stateOf(f), position);
    if (snapshot) animator.adopt(snapshot);
  }

  /** One animation frame: advance the animator, follow the playhead. */
  tick(dtMs: number): boolean {
    const { session, ui, parts } = this.hub;
    const a = session.animator;
    if (!a) return false;
    const moving = a.tick(dtMs);
    ui.bar.update(a.playhead, a.playing, dtMs);
    const s = session.state;
    if (s) ui.scoreBox.setScore(scoreAt(s.data, session.report, a.playhead));
    parts.frames.updateFrameViews();
    if (ui.notes.fpsBox)
      ui.notes.fpsBox.textContent = `${format.integer(Math.round(ui.scene.fps))} images per second`;
    return moving;
  }

  togglePlay(): void {
    const { session, ui } = this.hub;
    const a = session.animator;
    if (!a) return;
    if (a.playing) a.pause();
    else {
      ui.card.hide();
      ui.scene.setHover(null);
      a.play();
    }
    ui.scene.requestRender();
  }

  step(delta: number): void {
    const a = this.hub.session.animator;
    if (!a) return;
    a.pause();
    a.goTo(a.frame + delta);
  }

  /** The motion setting, or the system's, decides whether the picture changes at once. */
  applyMotion(): void {
    const { session, ui } = this.hub;
    const motion = ui.appearance.motion;
    const reduced = motion === "reduced" || (motion === "auto" && ui.reducedMotion.matches);
    if (session.animator) session.animator.reducedMotion = reduced;
  }

  /** Reduced motion: the picture changes at once and the canvas fades in briefly. */
  private crossFade(): void {
    const canvas = this.hub.ui.scene.canvas;
    canvas.classList.remove("fade");
    void canvas.offsetWidth;
    canvas.classList.add("fade");
  }
}
