const SPECIAL = new Set([".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (SPECIAL.has(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`, "i");
}

/**
 * Search box semantics: plain text matches anywhere in the path; a pattern with `*` or `?` is a glob,
 * matched on the whole path, or on the file name when the pattern has no slash.
 */
export function makePathFilter(query: string): ((path: string) => boolean) | null {
  const q = query.trim();
  if (q === "") return null;
  if (!/[*?]/.test(q)) {
    const lower = q.toLowerCase();
    return (path) => path.toLowerCase().includes(lower);
  }
  const re = globToRegExp(q);
  if (q.includes("/")) return (path) => re.test(path);
  return (path) => re.test(path) || re.test(path.slice(path.lastIndexOf("/") + 1));
}
