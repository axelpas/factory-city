import type { Layout } from "@factory-city/layout";
import { computeLayout } from "@factory-city/layout";
import type { TimelineData } from "../../data/timeline";
import { layoutWeights } from "../../data/timeline";
import { type Mapping, presetStatuses } from "../../presets/index";
import { applyTheme, type Theme } from "../../themes/index";
import type { Hub } from "./hub";
import { safeStorage, THEME_KEY } from "./session";

/** The preset and the mapping in force, and the theme: changing one of them draws the city again. */
export class Presets {
  constructor(private readonly hub: Hub) {}

  choosePreset(id: string): void {
    const { session, ui } = this.hub;
    const s = session.state;
    if (!s) return;
    const status = presetStatuses(s.ref, session.report?.dimensions).find((p) => p.preset.id === id);
    if (!status?.available || !status.mapping) return;
    s.preset = status.preset;
    s.mapping = status.mapping;
    this.relayoutAndRefresh();
    ui.viewPanel.build();
  }

  setMapping(patch: Partial<Mapping>): void {
    const { session, ui, parts } = this.hub;
    const s = session.state;
    if (!s) return;
    const areaChanged = patch.area !== undefined && patch.area !== s.mapping.area;
    s.mapping = { ...s.mapping, ...patch };
    if (s.preset) session.lastPreset = s.preset.id;
    s.preset = undefined;
    if (areaChanged) this.relayoutAndRefresh();
    else parts.frames.refresh();
    ui.headerBar.updatePresetSelect();
    ui.viewPanel.renderState();
  }

  /** The parcels for a mapping: the area metric decides how much ground each file gets. */
  layoutFor(data: TimelineData, mapping: Mapping): Layout {
    return computeLayout(layoutWeights(data, mapping.area));
  }

  private relayoutAndRefresh(): void {
    const { session, parts } = this.hub;
    const s = session.state;
    if (!s) return;
    s.layout = this.layoutFor(s.data, s.mapping);
    parts.playback.buildCity(true);
    parts.frames.refresh();
  }

  nextPreset(): void {
    const { session } = this.hub;
    const s = session.state;
    if (!s) return;
    const available = presetStatuses(s.ref, session.report?.dimensions).filter((p) => p.available);
    if (available.length === 0) return;
    const at = available.findIndex((p) => p.preset.id === s.preset?.id);
    const next = available[(at + 1) % available.length];
    if (next) this.choosePreset(next.preset.id);
  }

  /** Switches theme at runtime: same data, same mapping, another look. Buildings move from the current view. */
  setTheme(theme: Theme): void {
    const { session, ui, parts } = this.hub;
    const s = session.state;
    const cameraChanged = theme.camera.type !== session.theme.camera.type;
    session.theme = theme;
    safeStorage(() => localStorage.setItem(THEME_KEY, theme.id));
    applyTheme(theme, document.documentElement);
    ui.scene.applyTheme(theme);
    ui.scene.setGlow(ui.appearance.glow);
    ui.appearance.showTheme(theme);
    if (!s) return;
    // a theme may prefer a scale (Blocks counts whole blocks); leaving it gives the previous scale back
    if (session.scaleBeforeTheme && !theme.scale) {
      s.mapping = { ...s.mapping, scale: session.scaleBeforeTheme };
      session.scaleBeforeTheme = undefined;
    }
    if (theme.scale && s.mapping.scale !== theme.scale) {
      session.scaleBeforeTheme ??= s.mapping.scale;
      s.mapping = { ...s.mapping, scale: theme.scale };
    }
    parts.playback.buildCity(!cameraChanged);
    ui.viewPanel.build();
    parts.frames.refresh();
  }
}
