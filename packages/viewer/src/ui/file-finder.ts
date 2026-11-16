import { clear, el } from "../lib/dom";
import { format } from "../lib/format";
import { type FileEntry, findFiles } from "../view/finder";
import { icon } from "./icons";
import { POPOVER_CLASS } from "./popovers";

export interface FileFinderOptions {
  /** The files of the frame under the playhead; read each time the finder opens. */
  files(): FileEntry[];
  /** A file was chosen: select it and show its details. */
  onChoose(entry: FileEntry): void;
}

/**
 * The keyboard path to the files of the city: a search field and the list of matches. Arrow keys move
 * between the field and the matches, Enter chooses, Escape closes and gives focus back to the button.
 */
export class FileFinder {
  readonly element = el("details", { class: `${POPOVER_CLASS} menu finder` });
  private readonly input = el("input", {
    attrs: {
      type: "search",
      placeholder: "Find a file",
      "aria-label": "Find a file",
      autocomplete: "off",
      spellcheck: "false",
    },
  });
  private readonly list = el("ul", {
    class: "finder-list",
    attrs: { role: "listbox", "aria-label": "Matching files" },
  });
  private readonly count = el("p", { class: "muted finder-count", attrs: { role: "status" } });
  private entries: FileEntry[] = [];

  constructor(private readonly options: FileFinderOptions) {
    const summary = el(
      "summary",
      {
        class: "icon quiet",
        title: "Find a file and open its details (/)",
        attrs: { "aria-label": "Find a file" },
      },
      icon("search"),
    );
    this.element.append(
      summary,
      el("div", { class: "menu-list finder-body" }, this.input, this.count, this.list),
    );
    this.element.addEventListener("toggle", () => {
      if (!this.element.open) return;
      this.entries = options.files();
      this.input.value = "";
      this.render();
    });
    this.input.addEventListener("input", () => this.render());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.options_()[0]?.focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.options_()[0]?.click();
      }
    });
    this.list.addEventListener("keydown", (e) => {
      const items = this.options_();
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        items[Math.min(at + 1, items.length - 1)]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (at <= 0) this.input.focus();
        else items[at - 1]?.focus();
      }
    });
  }

  /** Opens the finder with the cursor in the field. */
  open(): void {
    this.element.open = true;
    this.input.focus();
  }

  close(): void {
    this.element.open = false;
  }

  private options_(): HTMLElement[] {
    return [...this.list.querySelectorAll<HTMLElement>('[role="option"]')];
  }

  private render(): void {
    const { matches, total } = findFiles(this.entries, this.input.value);
    clear(this.list);
    for (const entry of matches) {
      const cut = entry.path.lastIndexOf("/");
      const option = el(
        "button",
        { class: "finder-option", attrs: { type: "button", role: "option", "data-path": entry.path } },
        el("b", { text: entry.path.slice(cut + 1) }),
        el("span", { class: "muted", text: cut > 0 ? entry.path.slice(0, cut) : "" }),
      );
      option.addEventListener("click", () => {
        this.close();
        this.options.onChoose(entry);
      });
      this.list.append(el("li", { attrs: { role: "presentation" } }, option));
    }
    this.count.textContent =
      total === 0
        ? "No file matches."
        : total > matches.length
          ? `${format.integer(matches.length)} of ${format.integer(total)} files: keep typing to narrow down.`
          : `${format.integer(total)} ${total === 1 ? "file" : "files"}.`;
  }
}
