import { posix } from "node:path";

/** The folder of a path: "" at the root. */
export function dirOf(path: string): string {
  const d = posix.dirname(path);
  return d === "." ? "" : d;
}
