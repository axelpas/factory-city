import { el } from "../lib/dom";
import { icon } from "./icons";

export type InspectorTab = "file" | "health" | "factory";

const LABELS: Record<InspectorTab, string> = { file: "File", health: "Health", factory: "Factory" };
const TITLES: Record<InspectorTab, string> = {
  file: "Details of the selected file",
  health: "Score, risk profile and hotspots (H)",
  factory: "Factory KPIs and the issues to look at (F)",
};

export const INSPECTOR_MIN_WIDTH = 280;
export const INSPECTOR_MAX_WIDTH = 680;
/** The inspector never takes more than this share of the window. */
const MAX_SHARE = 0.6;

/** The width the inspector may take, for a wanted width and a window width. */
export function clampInspectorWidth(wanted: number, windowWidth: number): number {
  const max = Math.max(INSPECTOR_MIN_WIDTH, Math.min(INSPECTOR_MAX_WIDTH, windowWidth * MAX_SHARE));
  return Math.round(Math.min(Math.max(wanted, INSPECTOR_MIN_WIDTH), max));
}

export interface InspectorOptions {
  /** The content of each tab, in the order of the tabs. A pane is shown by clearing its `hidden` attribute, from anywhere. */
  panes: Record<InspectorTab, HTMLElement>;
  /** What the folded inspector shows: the code health in brief. */
  summary: HTMLElement;
  /** A tab was asked for from the inspector's own header. */
  onTab(tab: InspectorTab): void;
  /** The tab shown changed, or the inspector closed. */
  onChange(tab: InspectorTab | undefined): void;
  /** Width to start with, if one was remembered. */
  width?: number;
  onResize?(width: number): void;
}

/**
 * The one panel on the right, always there: the code health, the selected file and the factory share it as
 * tabs, with one header and one scrolling body. Folded, it shows the code health in brief. It follows its
 * panes: showing a pane unfolds the inspector on its tab and hides the others; hiding them all folds it.
 */
export class Inspector {
  readonly element = el("aside", {
    class: "inspector",
    attrs: { "aria-label": "Inspector", tabindex: "-1" },
  });
  private folded = true;
  private readonly foldButton: HTMLButtonElement;
  private readonly tabs = new Map<InspectorTab, HTMLButtonElement>();
  private current: InspectorTab | undefined;
  /** What had the focus when the inspector opened: it gets it back when the inspector closes. */
  private opener: HTMLElement | null = null;

  constructor(private readonly options: InspectorOptions) {
    const tablist = el("div", { class: "tabs", attrs: { role: "tablist", "aria-label": "Inspector" } });
    for (const tab of Object.keys(options.panes) as InspectorTab[]) {
      const button = el("button", {
        text: LABELS[tab],
        title: TITLES[tab],
        attrs: { type: "button", role: "tab", "aria-selected": "false", "data-tab": tab },
      });
      button.addEventListener("click", () => options.onTab(tab));
      this.tabs.set(tab, button);
      tablist.append(button);
      const pane = options.panes[tab];
      pane.setAttribute("role", "tabpanel");
      pane.classList.add("pane");
    }
    this.foldButton = el(
      "button",
      { class: "icon quiet inspector-fold", attrs: { type: "button" } },
      icon("chevron"),
    );
    this.foldButton.addEventListener("click", () => {
      if (this.folded) options.onTab("health");
      else this.close();
    });
    this.renderFold();
    const grip = el("div", {
      class: "inspector-grip",
      title: "Drag to resize",
      attrs: { role: "separator", "aria-orientation": "vertical", "aria-label": "Resize the inspector" },
    });
    this.watchGrip(grip);
    this.element.append(
      grip,
      el("header", { class: "inspector-head" }, tablist, this.foldButton),
      el("div", { class: "inspector-body" }, options.summary, ...Object.values(options.panes)),
    );
    this.element.classList.add("folded");
    if (options.width)
      this.element.style.width = `${clampInspectorWidth(options.width, window.innerWidth)}px`;

    // the panes are shown and hidden from many places: follow them
    const observer = new MutationObserver((records) => {
      const shown = records
        .map((r) => r.target as HTMLElement)
        .filter((pane) => !pane.hidden)
        .pop();
      this.sync(shown);
    });
    for (const pane of Object.values(options.panes))
      observer.observe(pane, { attributes: true, attributeFilter: ["hidden"] });
  }

  /** True while the inspector shows the code health in brief. */
  get isFolded(): boolean {
    return this.folded;
  }

  private renderFold(): void {
    this.foldButton.title = this.folded ? "Unfold the inspector" : "Fold the inspector (Escape)";
    this.foldButton.setAttribute("aria-label", this.folded ? "Unfold the inspector" : "Fold the inspector");
    this.foldButton.setAttribute("aria-expanded", String(!this.folded));
  }

  get tab(): InspectorTab | undefined {
    return this.current;
  }

  close(): void {
    for (const pane of Object.values(this.options.panes)) pane.hidden = true;
    this.sync(undefined);
  }

  /** One pane at most is shown: the one just revealed wins, and the others are hidden. */
  private showOnly(justShown: HTMLElement | undefined): InspectorTab | undefined {
    const entries = Object.entries(this.options.panes) as Array<[InspectorTab, HTMLElement]>;
    const winner = justShown ?? entries.find(([, pane]) => !pane.hidden)?.[1];
    // only a pane that is shown is touched: setting `hidden` again would wake the observer for nothing
    for (const [, pane] of entries) if (pane !== winner && !pane.hidden) pane.hidden = true;
    return entries.find(([, pane]) => pane === winner)?.[0];
  }

  private sync(justShown: HTMLElement | undefined): void {
    const tab = this.showOnly(justShown);
    // folded, the health tab is the one that speaks
    for (const [name, button] of this.tabs)
      button.setAttribute("aria-selected", String(name === (tab ?? "health")));
    const wasOpen = !this.folded;
    this.folded = tab === undefined;
    this.element.classList.toggle("folded", this.folded);
    this.options.summary.hidden = !this.folded;
    this.renderFold();
    if (wasOpen && this.folded) this.giveFocusBack();
    else if (!wasOpen && !this.folded) this.takeFocus();
    if (tab !== this.current) {
      this.current = tab;
      this.options.onChange(tab);
    }
  }

  /** Opening moves focus into the inspector; the control that had it is remembered. */
  private takeFocus(): void {
    const active = document.activeElement;
    this.opener = active instanceof HTMLElement && active !== document.body ? active : null;
    this.element.focus({ preventScroll: true });
  }

  /** Closing gives focus back to what had it, unless the user has moved on to something else. */
  private giveFocusBack(): void {
    const active = document.activeElement;
    const lost = active === document.body || active === null || this.element.contains(active);
    if (lost && this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = null;
  }

  private watchGrip(grip: HTMLElement): void {
    grip.addEventListener("pointerdown", (down) => {
      down.preventDefault();
      grip.setPointerCapture(down.pointerId);
      const right = this.element.getBoundingClientRect().right;
      const move = (e: PointerEvent) => {
        this.element.style.width = `${clampInspectorWidth(right - e.clientX, window.innerWidth)}px`;
      };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        this.options.onResize?.(this.element.getBoundingClientRect().width);
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
  }
}
