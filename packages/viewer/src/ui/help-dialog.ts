import { clear, el } from "../lib/dom";
import { fillHelp } from "./help";

/** What the help is told about the page. */
export interface HelpHost {
  /** The line saying which lenses are hidden for lack of data, if any. */
  hiddenLenses(): string | undefined;
  /** The help was closed for the first time: remember it, so that it does not open by itself again. */
  onSeen(): void;
}

/** The help card: how to read the city and the keyboard shortcuts. Focus goes into it and comes back. */
export class HelpDialog {
  readonly element = el("div", {
    class: "help",
    attrs: { role: "dialog", "aria-label": "How to read this city", hidden: "", tabindex: "-1" },
  });
  /** What had the focus when the help opened. */
  private opener: HTMLElement | null = null;

  constructor(private readonly host: HelpHost) {}

  get hidden(): boolean {
    return Boolean(this.element.hidden);
  }

  show(): void {
    fillHelp(this.element, this.host.hiddenLenses(), () => this.hide());
    const active = document.activeElement;
    this.opener = active instanceof HTMLElement && active !== document.body ? active : null;
    this.element.hidden = false;
    this.element.focus({ preventScroll: true });
  }

  hide(): void {
    this.element.hidden = true;
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = null;
    this.host.onSeen();
  }

  toggle(): void {
    if (this.hidden) this.show();
    else this.hide();
  }
}

/** The zone that says what the page waits for: data to load, a loading count, a file to drop, an error. */
export class DropZone {
  readonly element = el("div", { class: "drop" });

  /** Shows a message in the middle of the page. */
  say(message: string): void {
    this.element.hidden = false;
    clear(this.element);
    this.element.append(
      el("div", { class: "drop-box" }, el("h2", { text: "Factory City" }), el("p", { text: message })),
    );
  }

  hide(): void {
    this.element.hidden = true;
  }

  /** Shown or hidden as a whole, without touching what it says. */
  set hidden(value: boolean) {
    this.element.hidden = value;
  }
}
