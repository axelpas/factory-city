import { Docks } from "./docks";
import { Frames } from "./frames";
import type { Hub, Parts } from "./hub";
import { Loader } from "./loader";
import { Playback } from "./playback";
import { Presets } from "./presets";

/** The parts that make the widgets work together: frames, playback, presets, docks, loading. */
export function createParts(hub: Hub): Parts {
  return {
    frames: new Frames(hub),
    playback: new Playback(hub),
    presets: new Presets(hub),
    docks: new Docks(hub),
    loader: new Loader(hub),
  };
}
