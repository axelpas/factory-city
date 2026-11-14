import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Language, Parser } from "web-tree-sitter";

const require = createRequire(import.meta.url);
let initialized: Promise<void> | undefined;
const parsers = new Map<string, Promise<Parser>>();

function wasmDir(): string {
  return join(dirname(require.resolve("@vscode/tree-sitter-wasm/package.json")), "wasm");
}

/** One parser per grammar, created on first use. Grammars are WebAssembly: nothing to compile at install. */
export function getParser(grammar: string): Promise<Parser> {
  initialized ??= Parser.init();
  let parser = parsers.get(grammar);
  if (!parser) {
    parser = initialized
      .then(() => Language.load(join(wasmDir(), `tree-sitter-${grammar}.wasm`)))
      .then((language) => {
        const p = new Parser();
        p.setLanguage(language);
        return p;
      });
    parsers.set(grammar, parser);
  }
  return parser;
}
