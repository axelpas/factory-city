const REGEX_SPECIAL = new Set([".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);

/** The pattern for a star at `i`: `**` crosses folders (and eats a following slash), `*` stays in one. Returns where to go on. */
function star(glob: string, i: number): { re: string; next: number } {
  if (glob[i + 1] !== "*") return { re: "[^/]*", next: i };
  if (glob[i + 2] === "/") return { re: "(?:.*/)?", next: i + 2 };
  return { re: ".*", next: i + 1 };
}

/** Minimal glob support for --include / --exclude: `**`, `*`, `?`, matched on posix relative paths. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*") {
      const s = star(glob, i);
      re += s.re;
      i = s.next;
    } else if (c === "?") re += "[^/]";
    else re += REGEX_SPECIAL.has(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(path));
}
