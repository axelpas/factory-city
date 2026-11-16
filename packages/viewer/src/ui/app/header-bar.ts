import { type Loaded, SOURCE_LABELS, type SourceKey, selectableSources } from "../../data/load";
import { clear, el } from "../../lib/dom";
import { presetStatuses } from "../../presets/index";
import { projectContext } from "../../view/context";
import { type IconName, icon } from "../icons";
import { lensGroups, renderLensButton, renderLensList } from "../lens";
import type { Hub } from "./hub";

/** The header across the top: the project and its branch, the indicator, and the buttons of the page. */
export class HeaderBar {
  /** What was analyzed: the project, its branch or revision, the subfolder when only one was taken. */
  private readonly context = el("span", {
    class: "context",
    attrs: { "aria-label": "Analyzed project and branch" },
  });
  private readonly projectSelect = el("select", {
    title: "Switch project",
    attrs: { "aria-label": "Project" },
  });
  /** The preset picker: the main control of the bar. Each preset is listed with the question it answers. */
  private readonly lensButton = el("summary", {
    title: "Presets set all channels at once and answer one question (P: next preset)",
    attrs: { "aria-label": "Indicator" },
  });
  private readonly lensList = el("div", { class: "menu-list lens-list" });
  private readonly lensMenu = el(
    "details",
    { class: "menu popover lens-menu" },
    this.lensButton,
    this.lensList,
  );
  private readonly question = el("span", { class: "question" });

  constructor(private readonly hub: Hub) {}

  /** The header element, with the controls of the page in it; made once the widgets exist. */
  build(): HTMLElement {
    const { ui } = this.hub;
    const iconButton = (name: IconName, label: string, title: string, onClick: () => void) => {
      const b = el("button", { title, class: "icon quiet", attrs: { type: "button", "aria-label": label } });
      b.append(icon(name));
      b.addEventListener("click", onClick);
      return b;
    };
    const help = el("button", {
      text: "?",
      title: "How to read this city, and keyboard shortcuts (?)",
      class: "icon quiet",
      attrs: { type: "button" },
    });
    help.addEventListener("click", () => ui.help.toggle());
    this.projectSelect.addEventListener("change", () => {
      const url = new URL(location.href);
      url.searchParams.set("project", this.projectSelect.value);
      location.href = url.toString();
    });
    return el(
      "header",
      { class: "bar" },
      // what is shown: the project and its branch
      this.projectSelect,
      this.context,
      el("span", { class: "bar-rule" }),
      // what is asked of the city: the indicator (a preset) and the question it answers
      el("span", { class: "bar-label", text: "Indicator", attrs: { "aria-hidden": "true" } }),
      this.lensMenu,
      this.question,
      el("span", { class: "spacer" }),
      // panels
      el("span", { class: "bar-rule" }),
      // view and page actions
      ui.finder.element,
      iconButton("top", "Top view", "Top view: look straight down (V)", () => ui.scene.topView()),
      iconButton("reset", "Reset the view", "Reset the view (R)", () => ui.scene.resetCamera()),
      ui.appearance.element,
      ui.exportMenu.element,
      help,
    );
  }

  fillProjectSelect(projects: Array<{ slug: string; name: string }>, current: string | undefined): void {
    clear(this.projectSelect);
    for (const p of projects) {
      const o = el("option", { text: p.name, attrs: { value: p.slug } });
      if (p.slug === current) o.selected = true;
      this.projectSelect.append(o);
    }
    this.projectSelect.hidden = projects.length < 2;
  }

  /** The project and its branch, at the top of the page. The name is left to the project switcher when it shows. */
  renderContext(loaded: Loaded, project: string): void {
    const c = projectContext(loaded.manifest, project);
    const where = c.path ? `${c.name} / ${c.path}` : c.name;
    this.context.replaceChildren(
      ...(this.projectSelect.hidden ? [el("b", { class: "context-name", text: where })] : []),
      el("span", { class: "context-ref" }, icon("branch"), el("span", { text: c.ref })),
    );
    this.context.title = `${where}, ${c.ref}`;
  }

  /** The ways of cutting the history sit in the playback options of the timeline bar. */
  fillSources(current: SourceKey): void {
    const { session, ui } = this.hub;
    ui.bar.setSources(
      selectableSources(session.available).map((value) => ({ value, label: SOURCE_LABELS[value] })),
      current,
    );
  }

  /** The indicator list and its question follow the preset in force. */
  updatePresetSelect(): void {
    const { session, parts } = this.hub;
    const s = session.state;
    if (!s) return;
    const statuses = presetStatuses(s.ref, session.report?.dimensions);
    renderLensButton(this.lensButton, s.preset?.label ?? "Custom");
    renderLensList(
      this.lensList,
      lensGroups(statuses, s.ref.manifest?.dataLevel ?? 0),
      s.preset?.id,
      (id) => {
        this.lensMenu.open = false;
        parts.presets.choosePreset(id);
      },
    );
    this.question.textContent = s.preset?.question ?? "Your own mapping: channels were changed by hand.";
  }
}
