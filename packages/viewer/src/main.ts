import "./style.css";
import type { VideoOptions } from "./export/video";
import { App } from "./ui/app";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app element");
const app = new App(root);
// integration hook, used by headless rendering: wait for `ready`, then ask for a picture or a film
const hook = {
  ready: false,
  capture: (width: number, height: number, overlay = true) => app.capture(width, height, overlay),
  /** Renders the film and returns it as base64, with its type. */
  video: async (options: VideoOptions) => {
    const result = await app.video(options);
    if (!result) return null;
    let binary = "";
    for (let i = 0; i < result.bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...result.bytes.subarray(i, i + 0x8000));
    }
    return { base64: btoa(binary), mime: result.mime, codec: result.codec, images: result.images };
  },
  /** Fingerprints of the images at some playhead positions, to compare two renders image for image. */
  /** Selects the first file shown, as a click on it does; false when there is none. */
  selectFirstFile: () => app.selectFirstFile(),
  /** The selected file's index, or null. */
  selected: () => app.selected(),
  imageHashes: (positions: number[], width: number, height: number) =>
    app.imageHashes(positions, width, height),
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
