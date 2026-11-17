import { createHash } from "node:crypto";
import { LANGUAGES } from "../languages/index.js";
import { ANALYZER_VERSION } from "./constants.js";

/**
 * What the per-file cache is valid for: the analyzer version and the rules of every language. The rules decide
 * which metrics a file has (imports, cohesion, shortcuts, security), so a cache written under other rules would
 * keep serving files that lack them. A change to the engine itself still goes with a new analyzer version.
 */
export const CACHE_VERSION = `${ANALYZER_VERSION}+${createHash("sha256")
  .update(JSON.stringify(LANGUAGES))
  .digest("hex")
  .slice(0, 12)}`;
