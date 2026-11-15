import "./style.css";
import { App } from "./ui/app";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app element");
const app = new App(root);
// integration hook, used by headless rendering: wait for `ready`, then ask for a picture
const hook = {
  ready: false,
  capture: (width: number, height: number, overlay = true) => app.capture(width, height, overlay),
};
(window as unknown as { factoryCity: typeof hook }).factoryCity = hook;
app
  .start()
  .then(() => {
    hook.ready = true;
  })
  .catch((err: unknown) => {
    hook.ready = true;
    root.textContent = `Factory City could not start: ${err instanceof Error ? err.message : String(err)}`;
  });
