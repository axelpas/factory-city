import { applyTheme } from "../../themes/index";
import type { Hub, Parts, Widgets } from "./hub";
import { createParts } from "./parts";
import { Session } from "./session";
import { buildWidgets } from "./widgets";
import { wirePage } from "./wire";

/** Makes the page: its data, its widgets, and the parts that connect them, all wired to the browser. */
export function createHub(root: HTMLElement): Hub {
  const session = new Session();
  const hub: Hub = { session, ui: {} as Widgets, parts: {} as Parts };
  hub.parts = createParts(hub);
  applyTheme(session.theme, document.documentElement);
  buildWidgets(hub, root);
  wirePage(hub);
  return hub;
}
