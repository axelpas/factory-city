import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";

const require = createRequire(import.meta.url);
let initialized: Promise<void> | undefined;
const parsers = new Map<string, Promise<Parser>>();

/** Grammars shipped with this package, for languages the grammar package does not cover (see `grammars/NOTICE.md`). */
const OWN_GRAMMARS = fileURLToPath(new URL("../grammars/", import.meta.url));

/** Where a grammar file is: this package's own folder first, then the grammar package. */
export function grammarPath(grammar: string): string {
  const file = `tree-sitter-${grammar}.wasm`;
  const own = join(OWN_GRAMMARS, file);
  if (existsSync(own)) return own;
  return join(dirname(require.resolve("@vscode/tree-sitter-wasm/package.json")), "wasm", file);
}

/** The grammar itself, to check a configuration against its node types. */
export async function loadGrammar(grammar: string): Promise<Language> {
  initialized ??= Parser.init();
  await initialized;
  return Language.load(grammarPath(grammar));
}

/** One parser per grammar, created on first use. Grammars are WebAssembly: nothing to compile at install. */
export function getParser(grammar: string): Promise<Parser> {
  initialized ??= Parser.init();
  let parser = parsers.get(grammar);
  if (!parser) {
    parser = initialized
      .then(() => Language.load(grammarPath(grammar)))
      .then((language) => {
        const p = new Parser();
        p.setLanguage(language);
        return p;
      });
    parsers.set(grammar, parser);
  }
  return parser;
}
