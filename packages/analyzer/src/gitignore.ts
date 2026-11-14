import { globToRegExp } from "./glob.js";

interface Rule {
  negated: boolean;
  dirOnly: boolean;
  regex: RegExp;
}

/** A .gitignore file's rules, relative to the folder that holds it. */
export class GitIgnore {
  private readonly rules: Rule[];

  constructor(
    text: string,
    readonly base: string,
  ) {
    this.rules = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, "");
      if (!line || line.startsWith("#")) continue;
      let pattern = line;
      const negated = pattern.startsWith("!");
      if (negated) pattern = pattern.slice(1);
      const dirOnly = pattern.endsWith("/");
      if (dirOnly) pattern = pattern.slice(0, -1);
      const anchored = pattern.includes("/");
      pattern = pattern.replace(/^\//, "");
      const body = globToRegExp(pattern).source.slice(1, -1);
      const regex = new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`);
      this.rules.push({ negated, dirOnly, regex });
    }
  }

  /** true = ignored, false = explicitly re-included, undefined = no rule matched. */
  test(path: string, isDir: boolean): boolean | undefined {
    const rel = this.base ? path.slice(this.base.length + 1) : path;
    let result: boolean | undefined;
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.regex.test(rel)) result = !rule.negated;
    }
    return result;
  }
}

/** Layered .gitignore files: the deepest rule that matches wins. */
export class GitIgnoreStack {
  private readonly layers: GitIgnore[] = [];

  push(layer: GitIgnore): void {
    this.layers.push(layer);
  }

  isIgnored(path: string, isDir: boolean): boolean {
    let result = false;
    for (const layer of this.layers) {
      if (layer.base && !path.startsWith(`${layer.base}/`)) continue;
      const r = layer.test(path, isDir);
      if (r !== undefined) result = r;
    }
    return result;
  }
}
