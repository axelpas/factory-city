/** The end of a string literal that starts at `i`: the index just after its closing quote. */
function endOfString(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
  return j + 1;
}

/** The end of the comment that starts at `i`, or `i` when there is none there. */
function endOfComment(text: string, i: number): number {
  if (text[i] !== "/") return i;
  if (text[i + 1] === "/") {
    const end = text.indexOf("\n", i);
    return end < 0 ? text.length : end;
  }
  if (text[i + 1] === "*") {
    const end = text.indexOf("*/", i + 2);
    return end < 0 ? text.length : end + 2;
  }
  return i;
}

/** Removes comments and trailing commas so that tsconfig files (JSON with comments) can be parsed. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    const afterComment = endOfComment(text, i);
    if (c === '"') {
      const end = endOfString(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (afterComment > i) {
      i = afterComment;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}
