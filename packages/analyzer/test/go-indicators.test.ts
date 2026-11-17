import { expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { LANGUAGES } from "../src/languages/index.js";
import { computeMetrics } from "../src/metrics/file-metrics.js";
import { getParser } from "../src/parse.js";
import { resolveGo } from "../src/resolve/modules.js";
import type { ResolveContext } from "../src/resolve/types.js";
import { makeTree } from "./helpers.js";
import { values } from "./history-helpers.js";

const go = LANGUAGES.find((l) => l.id === "go") as (typeof LANGUAGES)[number];

async function measure(code: string, isTest = false) {
  return computeMetrics(await getParser(go.grammar), go, code, isTest);
}

const only = (m: Record<string, number>, prefix: string) =>
  Object.fromEntries(
    Object.entries(m).filter(([k, v]) => k.startsWith(prefix) && v > 0 && !k.endsWith("density")),
  );

// ------------------------------------------------------------------------------------------ coupling

it("go coupling > reads the import paths of grouped, aliased, blank and single imports", async () => {
  const { imports } = await measure(
    'package main\n\nimport (\n\t"fmt"\n\tstr "strings"\n\t_ "net/http/pprof"\n\t"example.com/app/internal/util"\n)\n\nimport "os/exec"\n',
  );
  expect(imports).toEqual(["fmt", "strings", "net/http/pprof", "example.com/app/internal/util", "os/exec"]);
});

const FILES = new Set([
  "go.mod",
  "main.go",
  "internal/util/util.go",
  "internal/util/strings.go",
  "internal/util/util_test.go",
  "internal/db/db.go",
  "cmd/tool/main.go",
]);
const ctx = (goModules: Array<[string, string]>): ResolveContext => ({
  files: FILES,
  configs: new Map(),
  packages: new Map(),
  goModules: new Map(goModules),
});

it("go coupling > resolves an import path to the files of the package folder, tests left out", () => {
  const c = ctx([["", "example.com/app"]]);
  expect(resolveGo("example.com/app/internal/util", c)).toEqual([
    "internal/util/util.go",
    "internal/util/strings.go",
  ]);
  expect(resolveGo("example.com/app", c)).toEqual(["main.go"]);
});

it("go coupling > leaves the standard library and dependencies without a file when a go.mod is known", () => {
  const c = ctx([["", "example.com/app"]]);
  for (const spec of ["fmt", "net/http", "github.com/other/lib/util", "example.com/application/x"])
    expect(resolveGo(spec, c), spec).toEqual([]);
});

it("go coupling > without a go.mod, matches the end of the import path to a folder (two segments at least)", () => {
  const c = ctx([]);
  expect(resolveGo("example.com/app/internal/db", c)).toEqual(["internal/db/db.go"]);
  expect(resolveGo("db", c)).toEqual([]);
});

it("go coupling > links the files of a project; an imported package counts once in imports_out", async () => {
  const dir = makeTree({
    "go.mod": "module example.com/app\n\ngo 1.22\n",
    "main.go":
      'package main\n\nimport (\n\t"fmt"\n\t"example.com/app/util"\n)\n\nfunc main() { fmt.Println(util.A()) }\n',
    "util/a.go": "package util\n\nfunc A() int { return 1 }\n",
    "util/b.go": "package util\n\nfunc B() int { return 2 }\n",
  });
  const v = values(await analyze({ folder: dir }));
  expect(v.get("main.go")?.imports_out).toBe(1);
  expect(v.get("util/a.go")?.imports_in).toBe(1);
  expect(v.get("util/b.go")?.imports_in).toBe(1);
});

// ------------------------------------------------------------------------------------------ cohesion

it("go cohesion > methods that use the same field of their type are one group", async () => {
  const { metrics } = await measure(`package x

type Box struct {
	items []int
	label string
}

func (b *Box) Add(x int)     { b.items = append(b.items, x) }
func (b *Box) Count() int    { return len(b.items) }
func (b Box) Title() string  { return b.label }
`);
  // Add and Count share items; Title only uses label
  expect(metrics.cohesion_groups).toBe(2);
});

it("go cohesion > a method that calls another through its receiver joins it", async () => {
  const { metrics } = await measure(`package x

type A struct{}

func (a A) One() int { return a.Two() }
func (a A) Two() int { return 2 }
`);
  expect(metrics.cohesion_groups).toBe(1);
});

it("go cohesion > functions that share a package constant are one group; unrelated ones are several", async () => {
  const shared = await measure(
    "package x\n\nconst Limit = 10\n\nfunc Check(x int) bool { return x < Limit }\n\nfunc Clamp(x int) int { return min(x, Limit) }\n",
  );
  expect(shared.metrics.cohesion_groups).toBe(1);
  const split = await measure(
    "package x\n\nfunc ReadConfig(p string) string { return p }\n\nfunc RenderChart(d int) int { return d }\n\nfunc SendMail(t string) string { return t }\n",
  );
  expect(split.metrics.cohesion_groups).toBe(3);
});

it("go cohesion > a file with no function is unavailable, and a test file is not rated", async () => {
  expect((await measure("package x\n\nconst A = 1\n")).metrics.cohesion_groups).toBeUndefined();
  expect((await measure("package x\n\nfunc A() {}\n", true)).metrics.cohesion_groups).toBeUndefined();
});

// ------------------------------------------------------------------------------------------ shortcuts

it("go shortcuts > finds nolint and nosec markers", async () => {
  const { metrics } = await measure(
    "package x\n\nfunc f() {\n\t_ = g() //nolint:errcheck\n\t//lint:ignore SA1019 legacy\n\th() // #nosec G104\n}\n",
  );
  expect(only(metrics, "escape_")).toEqual({ escape_lint_disable: 3, escape_hatches: 3 });
});

it("go shortcuts > finds skipped tests", async () => {
  const { metrics } = await measure(
    'package x\n\nfunc TestA(t *testing.T) {\n\tt.Skip("later")\n\tt.Skipf("no %s", "x")\n\tt.SkipNow()\n}\n',
  );
  expect(metrics.escape_skipped_test).toBe(3);
});

it("go shortcuts > finds an error check with an empty body, and leaves one that does something", async () => {
  const { metrics } = await measure(
    "package x\n\nfunc f() {\n\tif err != nil {\n\t}\n\tif err := g(); err != nil {\n\t}\n\tif err != nil {\n\t\tlog(err)\n\t}\n\tif ok {\n\t}\n}\n",
  );
  expect(metrics.escape_empty_catch).toBe(2);
});

it("go shortcuts > leaves look-alikes alone", async () => {
  const { metrics } = await measure(
    'package x\n\nvar msg = "nolint and #nosec are words"\n\nfunc f(t *T) { t.Run("a", nil) }\n',
  );
  expect(only(metrics, "escape_")).toEqual({});
});

// ------------------------------------------------------------------------------------------ security

const sec = async (code: string) => only((await measure(`package x\n\n${code}`)).metrics, "security_");

const POSITIVES: Array<[kind: string, code: string]> = [
  ["command_exec", 'func f(x string) { exec.Command("sh", "-c", x).Run() }\n'],
  ["command_exec", 'func f(ctx C, x string) { exec.CommandContext(ctx, "bash", "-c", x).Run() }\n'],
  ["unsafe_html", "func f(s string) T { return template.HTML(s) }\n"],
  ["hardcoded_secret", 'var password = "hunter2hunter2"\n'],
  ["hardcoded_secret", 'const APIKey = "abcdefgh12345678"\n'],
  ["hardcoded_secret", 'func f() { token := "abcdefgh12345678"; _ = token }\n'],
  ["hardcoded_secret", 'func f() { c := Config{Password: "abcdefgh12345678"}; _ = c }\n'],
  ["hardcoded_secret", `var k = "${"AKIA"}${"A".repeat(16)}"\n`],
  ["tls_disabled", "func f() { c := &tls.Config{InsecureSkipVerify: true}; _ = c }\n"],
  ["tls_disabled", "func f(c *tls.Config) { c.InsecureSkipVerify = true }\n"],
  ["sql_concat", 'func f(a string) { db.Query("select * from t where id = " + a) }\n'],
  ["sql_concat", 'func f(a string) { db.Exec(fmt.Sprintf("delete from t where id = %s", a)) }\n'],
  ["sql_concat", 'func f(ctx C, a string) { db.QueryContext(ctx, "select " + a) }\n'],
];

it.each(POSITIVES)("go security > finds %s: %s", async (kind, code) => {
  const found = await sec(code);
  expect(found[`security_${kind}`], JSON.stringify(found)).toBe(1);
  expect(found.security_signals).toBe(1);
});

const LOOK_ALIKES = [
  'func f() { exec.Command("ls", "-l").Run() }\n',
  'func f(x string) { exec.Command("git", x).Run() }\n',
  "func f(s string) string { return html.EscapeString(s) }\n",
  'var password = os.Getenv("PASSWORD")\n',
  'var password = ""\n',
  'const token = "short"\n',
  "func f() { c := &tls.Config{InsecureSkipVerify: false}; _ = c }\n",
  'func f(a int) { db.Query("select * from t where id = $1", a) }\n',
  'func f() { db.Query("select 1") }\n',
  'func f(a string) { log.Println("select " + a) }\n',
];

it.each(LOOK_ALIKES)("go security > leaves alone: %s", async (code) => {
  expect(await sec(code)).toEqual({});
});

it("go security > never keeps what a secret says, and does not rate test files", async () => {
  const code = 'package x\n\nvar password = "correct-horse-battery"\n';
  expect(JSON.stringify(await measure(code))).not.toContain("correct-horse");
  expect(Object.keys((await measure(code, true)).metrics).filter((k) => k.startsWith("security_"))).toEqual(
    [],
  );
});
