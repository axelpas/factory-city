import { expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { LANGUAGES } from "../src/languages/index.js";
import { computeMetrics } from "../src/metrics/file-metrics.js";
import { getParser } from "../src/parse.js";
import { resolveC } from "../src/resolve/modules.js";
import type { ResolveContext } from "../src/resolve/types.js";
import { makeTree } from "./helpers.js";
import { values } from "./history-helpers.js";

async function measureAs(id: string, code: string, isTest = false) {
  const lang = LANGUAGES.find((l) => l.id === id) as (typeof LANGUAGES)[number];
  return computeMetrics(await getParser(lang.grammar), lang, code, isTest);
}
const c = (code: string, isTest = false) => measureAs("c", code, isTest);
const cpp = (code: string, isTest = false) => measureAs("cpp", code, isTest);

const only = (m: Record<string, number>, prefix: string) =>
  Object.fromEntries(
    Object.entries(m).filter(([k, v]) => k.startsWith(prefix) && v > 0 && !k.endsWith("density")),
  );

// ------------------------------------------------------------------------------------------ coupling

it("c coupling > reads quoted and angle includes, told apart", async () => {
  const { imports } = await c(
    '#include <stdio.h>\n#include "util.h"\n#include "../lib/helper.h"\n#include <mylib/api.h>\n',
  );
  expect(imports).toEqual(["s:stdio.h", "q:util.h", "q:../lib/helper.h", "s:mylib/api.h"]);
});

const ctx = (files: string[]): ResolveContext => ({
  files: new Set(files),
  configs: new Map(),
  packages: new Map(),
  goModules: new Map(),
  rustCrates: new Map(),
  namespaces: new Map(),
});
const FILES = ["src/main.c", "src/util.h", "lib/helper.h", "include/mylib/api.h", "src/sub/util.h"];

it("c coupling > resolves a quoted include from the folder of the file, then by the end of the path", () => {
  const c0 = ctx(FILES);
  expect(resolveC("q:util.h", "src/main.c", c0)).toEqual(["src/util.h"]);
  expect(resolveC("q:../lib/helper.h", "src/main.c", c0)).toEqual(["lib/helper.h"]);
  expect(resolveC("q:mylib/api.h", "src/main.c", c0)).toEqual(["include/mylib/api.h"]);
  expect(resolveC("q:util.h", "src/sub/x.c", c0)).toEqual(["src/sub/util.h"]);
  expect(resolveC("q:missing.h", "src/main.c", c0)).toEqual([]);
});

it("c coupling > an angle include is the system's unless it names a folder of the project", () => {
  const c0 = ctx(FILES);
  expect(resolveC("s:stdio.h", "src/main.c", c0)).toEqual([]);
  // `util.h` exists in the project, but <util.h> is not asking for it
  expect(resolveC("s:util.h", "src/main.c", c0)).toEqual([]);
  expect(resolveC("s:mylib/api.h", "src/main.c", c0)).toEqual(["include/mylib/api.h"]);
  expect(resolveC("s:sys/types.h", "src/main.c", c0)).toEqual([]);
});

it("c coupling > links the files of a project, headers included", async () => {
  const dir = makeTree({
    "src/main.c": '#include <stdio.h>\n#include "util.h"\nint main(void) { return 0; }\n',
    "src/util.h": "int util(void);\n",
  });
  const v = values(await analyze({ folder: dir }));
  expect(v.get("src/main.c")?.imports_out).toBe(1);
  expect(v.get("src/util.h")?.imports_in).toBe(1);
});

// ------------------------------------------------------------------------------------------ cohesion

it("c cohesion > functions that share a static variable or a struct type are one group", async () => {
  const shared = await c(
    "static int limit = 3;\nint check(int x) { return x < limit; }\nint clamp(int x) { return x > limit ? limit : x; }\n",
  );
  expect(shared.metrics.cohesion_groups).toBe(1);
  const typed = await c(
    "struct box { int a; };\nint get(struct box *b) { return b->a; }\nvoid put(struct box *b, int v) { b->a = v; }\n",
  );
  expect(typed.metrics.cohesion_groups).toBe(1);
});

it("c cohesion > a function that calls another joins it; unrelated functions are several groups", async () => {
  expect(
    (await c("int two(void) { return 2; }\nint one(void) { return two(); }\n")).metrics.cohesion_groups,
  ).toBe(1);
  const split = await c(
    "int read_config(void) { return 1; }\nint render_chart(void) { return 2; }\nint send_mail(void) { return 3; }\n",
  );
  expect(split.metrics.cohesion_groups).toBe(3);
});

it("c cohesion > a prototype declares no name, a file with no function is unavailable, a test file is not rated", async () => {
  // two prototypes of the same name would otherwise tie two unrelated functions together
  const { metrics } = await c(
    "int shared(int);\nint a(void) { return shared(1); }\nint b(void) { return 2; }\n",
  );
  expect(metrics.cohesion_groups).toBe(2);
  expect((await c("static int a = 1;\n")).metrics.cohesion_groups).toBeUndefined();
  expect((await c("int a(void) { return 1; }\n", true)).metrics.cohesion_groups).toBeUndefined();
});

it("cpp cohesion > methods that share a field, inside a namespace and a template, are one group", async () => {
  const { metrics } = await cpp(`namespace app {
template <typename T>
class Box {
public:
    Box(int l) : label(l) {}
    ~Box() {}
    int count() const { return items.size(); }
    void add(int x) { this->items.push_back(x); }
    int title() { return label; }
private:
    std::vector<int> items;
    int label;
};
}`);
  // the constructor and the destructor are not methods; count and add share items, title uses label
  expect(metrics.cohesion_groups).toBe(2);
});

it("cpp cohesion > a method defined outside its class belongs to it", async () => {
  const { metrics } = await cpp(`class Box { public: void add(int x); int count(); private: int items; };
void Box::add(int x) { items += x; }
int Box::count() { return items; }`);
  expect(metrics.cohesion_groups).toBe(1);
});

// ------------------------------------------------------------------------------------------ shortcuts

it("c shortcuts > finds lint suppressions and disabled tests", async () => {
  const { metrics } = await c(`#pragma GCC diagnostic ignored "-Wunused"
int f(void) {
    g(); // NOLINT
    /* NOLINTNEXTLINE */
    h();
    return 0;
}
TEST(Suite, DISABLED_name) { }
TEST(Suite, enabled) { }`);
  expect(only(metrics, "escape_")).toEqual({
    escape_lint_disable: 3,
    escape_skipped_test: 1,
    escape_hatches: 4,
  });
});

it("cpp shortcuts > finds an empty catch block and leaves one that does something", async () => {
  const { metrics } = await cpp(
    "void f() { try { g(); } catch (...) { } try { g(); } catch (const E& e) { log(e); } }",
  );
  expect(metrics.escape_empty_catch).toBe(1);
});

// ------------------------------------------------------------------------------------------ security

const sec = async (body: string) => only((await c(`void f(char *a) { ${body} }`)).metrics, "security_");
const secPlus = async (body: string) => only((await cpp(`void f(char *a) { ${body} }`)).metrics, "security_");

const POSITIVES: Array<[kind: string, body: string]> = [
  ["dynamic_code", "dlopen(path, 0);"],
  ["command_exec", "system(a);"],
  ["command_exec", 'popen(a, "r");'],
  ["unsafe_function", "gets(buf);"],
  ["unsafe_function", "strcpy(d, a);"],
  ["unsafe_function", 'sprintf(buf, "%s", a);'],
  ["hardcoded_secret", 'const char *password = "hunter2hunter2";'],
  ["hardcoded_secret", 'char api_key[] = "abcdefgh12345678";'],
  ["hardcoded_secret", `const char *k = "${"AKIA"}${"A".repeat(16)}";`],
  ["tls_disabled", "SSL_CTX_set_verify(ctx, SSL_VERIFY_NONE, NULL);"],
  ["tls_disabled", "curl_easy_setopt(c, CURLOPT_SSL_VERIFYPEER, 0L);"],
];

it.each(POSITIVES)("c security > finds %s: %s", async (kind, body) => {
  const found = await sec(body);
  expect(found[`security_${kind}`], JSON.stringify(found)).toBe(1);
  expect(found.security_signals).toBe(1);
});

it("c security > finds an SQL statement built with a format; a #define secret too", async () => {
  expect((await sec('snprintf(q, 99, "select * from t where id = %s", a);')).security_sql_concat).toBe(1);
  expect(
    only((await c('#define API_KEY "abcdefgh12345678"\n')).metrics, "security_").security_hardcoded_secret,
  ).toBe(1);
});

const LOOK_ALIKES = [
  "dlclose(h);",
  "systemd_notify(a);",
  "strncpy(d, a, 9);",
  'snprintf(buf, 9, "%s", a);',
  'const char *password = getenv("PASSWORD");',
  'const char *password = "";',
  'const char *token = "short";',
  'const char *token_url = "/oauth/token";',
  "SSL_CTX_set_verify(ctx, SSL_VERIFY_PEER, NULL);",
  "curl_easy_setopt(c, CURLOPT_SSL_VERIFYPEER, 1L);",
  'snprintf(q, 99, "log %s", a);',
];

it.each(LOOK_ALIKES)("c security > leaves alone: %s", async (body) => {
  expect(await sec(body)).toEqual({});
});

it("cpp security > finds std::system and unqualified calls once, and never keeps a secret", async () => {
  expect((await secPlus("std::system(a);")).security_command_exec).toBe(1);
  expect((await secPlus("std::strcpy(d, a);")).security_unsafe_function).toBe(1);
  const code = 'const char *password = "correct-horse-battery";\n';
  expect(JSON.stringify(await cpp(code))).not.toContain("correct-horse");
  expect(Object.keys((await cpp(code, true)).metrics).filter((k) => k.startsWith("security_"))).toEqual([]);
});
