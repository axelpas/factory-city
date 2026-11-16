import { hiddenLensesLine } from "../../view/lenses";
import { AppearanceMenu, type MotionSetting } from "../appearance-menu";
import { ExportMenu } from "../export-menu";
import { FileFinder } from "../file-finder";
import { DropZone, HelpDialog } from "../help-dialog";
import type { Hub, Widgets } from "./hub";
import { HELP_KEY, LABELS_KEY, MEDIUM_QUERY, MOTION_KEY, safeStorage } from "./session";

type Tools = Pick<
  Widgets,
  "help" | "dropZone" | "finder" | "appearance" | "exportMenu" | "medium" | "reducedMotion"
>;

/** The help, the drop zone, the file finder, and the Appearance and Export menus, with the settings they keep. */
export function buildTools(hub: Hub): Tools {
  const { session, parts } = hub;
  return {
    help: new HelpDialog({
      hiddenLenses: () => hiddenLensesLine(hub.ui.bar.lenses) || undefined,
      onSeen: () => safeStorage(() => localStorage.setItem(HELP_KEY, "1")),
    }),
    dropZone: new DropZone(),
    finder: new FileFinder({
      files: () => parts.frames.finderFiles(),
      onChoose: (entry) => hub.ui.selection.open(entry.union),
    }),
    appearance: new AppearanceMenu(
      {
        theme: () => session.theme,
        setTheme: (theme) => parts.presets.setTheme(theme),
        onMotion: () => parts.playback.applyMotion(),
        setDistrictNames: (on) => hub.ui.districtLabels.setEnabled(on),
        setGlow: (on) => hub.ui.scene.setGlow(on),
        remember: (key, value) =>
          safeStorage(() => localStorage.setItem(key === "motion" ? MOTION_KEY : LABELS_KEY, value)),
      },
      {
        motion: (safeStorage(() => localStorage.getItem(MOTION_KEY)) as MotionSetting | null) ?? "auto",
        districtNames: safeStorage(() => localStorage.getItem(LABELS_KEY)) !== "off",
      },
    ),
    exportMenu: new ExportMenu({
      onPicture: (size, overlay) => hub.ui.exporter.exportPng(size, overlay),
      onVideo: () => void hub.ui.film.exportVideo(),
      frameCount: () => session.state?.data.frames.length ?? 1,
    }),
    medium: window.matchMedia(MEDIUM_QUERY),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)"),
  };
}
