import "./style.css";
import { App } from "./ui/app";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app element");
new App(root).start().catch((err: unknown) => {
  root.textContent = `Factory City could not start: ${err instanceof Error ? err.message : String(err)}`;
});
