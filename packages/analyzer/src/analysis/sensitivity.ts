import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import type { AnalyzeOptions, FileValues } from "./types.js";

/** Words that make a path look like code worth a closer look: who may do what, secrets, money. */
const SENSITIVE =
  /(^|[/_.-])(auth(n|z|entication|orization)?|oauth|crypto|cipher|payments?|billing|secrets?|tokens?|sessions?|passwords?|credentials?|permissions?|acl|rbac|login|jwt)([/_.-]|$)/i;

/** Whether a path looks sensitive: by the default words, or by the patterns of the configuration. */
export function isSensitivePath(path: string, extra: readonly RegExp[] = []): boolean {
  return SENSITIVE.test(path) || extra.some((re) => re.test(path));
}

/**
 * Marks the files whose path looks sensitive (`sensitive_path` 1, else 0). This is a guess made from names,
 * which is why the patterns are configurable. Test files are not rated. Returns whether any file was rated.
 */
export async function addSensitivePaths(
  opts: AnalyzeOptions,
  attributesByPath: FileValues,
): Promise<boolean> {
  // an invalid configuration is reported by the history step: here the default words are enough
  const config = opts.shared?.config ?? (await loadConfig(resolve(opts.folder)).catch(() => undefined));
  const extra = (config?.sensitivePatterns ?? []).map((p) => new RegExp(p, "i"));
  let rated = false;
  for (const [path, values] of attributesByPath) {
    if (values.is_test === 1) continue;
    values.sensitive_path = isSensitivePath(path, extra) ? 1 : 0;
    rated = true;
  }
  return rated;
}
