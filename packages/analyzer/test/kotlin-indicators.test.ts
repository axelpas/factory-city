import { expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { LANGUAGES } from "../src/languages/index.js";
import { computeMetrics } from "../src/metrics/file-metrics.js";
import { getParser } from "../src/parse.js";
import { resolveKotlin } from "../src/resolve/modules.js";
import type { ResolveContext } from "../src/resolve/types.js";
import { makeTree } from "./helpers.js";
import { values } from "./history-helpers.js";

const kotlin = LANGUAGES.find((l) => l.id === "kotlin") as (typeof LANGUAGES)[number];

async function measure(code: string, isTest = false) {
  return computeMetrics(await getParser(kotlin.grammar), kotlin, code, isTest);
}

const only = (m: Record<string, number>, prefix: string) =>
  Object.fromEntries(
    Object.entries(m).filter(([k, v]) => k.startsWith(prefix) && v > 0 && !k.endsWith("density")),
  );

// ------------------------------------------------------------------------------------------ coupling

it("kotlin coupling > reads imports, aliased and wildcard ones, and the package the file declares", async () => {
  const { imports, declares } = await measure(
    "package com.example.app\n\nimport java.util.List\nimport com.example.app.util.Helper as H\nimport com.example.app.model.*\n\nclass A\n",
  );
  expect(imports).toEqual(["java.util.List", "com.example.app.util.Helper", "com.example.app.model.*"]);
  expect(declares).toEqual(["com.example.app"]);
});

const ctx = (files: string[], namespaces: Array<[string, string[]]>): ResolveContext => ({
  files: new Set(files),
  configs: new Map(),
  packages: new Map(),
  goModules: new Map(),
  namespaces: new Map(namespaces),
});

it("kotlin coupling > resolves a class to the file named after it, and a function to the files of its package", () => {
  const files = ["src/com/x/util/Helper.kt", "src/com/x/util/Strings.kt", "src/com/x/Main.kt"];
  const c = ctx(files, [["com.x.util", ["src/com/x/util/Helper.kt", "src/com/x/util/Strings.kt"]]]);
  expect(resolveKotlin("com.x.util.Helper", "src/com/x/Main.kt", c)).toEqual(["src/com/x/util/Helper.kt"]);
  expect(resolveKotlin("com.x.util.slugify", "src/com/x/Main.kt", c)).toEqual([
    "src/com/x/util/Helper.kt",
    "src/com/x/util/Strings.kt",
  ]);
  expect(resolveKotlin("com.x.util.*", "src/com/x/Main.kt", c)).toHaveLength(2);
});

it("kotlin coupling > leaves the standard library and dependencies without a file", () => {
  const c = ctx(["src/com/x/Main.kt"], [["com.x", ["src/com/x/Main.kt"]]]);
  for (const spec of ["kotlin.collections.List", "java.util.*", "org.junit.Test"])
    expect(resolveKotlin(spec, "src/com/x/Main.kt", c), spec).toEqual([]);
});

it("kotlin coupling > links the files of a project", async () => {
  const dir = makeTree({
    "src/com/x/Main.kt": "package com.x\n\nimport com.x.util.Helper\n\nclass Main\n",
    "src/com/x/util/Helper.kt": "package com.x.util\n\nclass Helper\n",
  });
  const v = values(await analyze({ folder: dir }));
  expect(v.get("src/com/x/Main.kt")?.imports_out).toBe(1);
  expect(v.get("src/com/x/util/Helper.kt")?.imports_in).toBe(1);
});

// ------------------------------------------------------------------------------------------ cohesion

it("kotlin cohesion > methods that share a property, with or without this, are one group", async () => {
  const { metrics } = await measure(`class Box(val label: String) {
    private val items = mutableListOf<Int>()
    fun count(): Int = items.size
    fun add(x: Int) { this.items.add(x) }
    fun title() = label
}`);
  // count and add share items; title only uses label
  expect(metrics.cohesion_groups).toBe(2);
});

it("kotlin cohesion > top-level functions that share a constant are one group; unrelated ones are several", async () => {
  const shared = await measure(
    "const val LIMIT = 10\n\nfun check(x: Int) = x < LIMIT\n\nfun clamp(x: Int) = minOf(x, LIMIT)\n",
  );
  expect(shared.metrics.cohesion_groups).toBe(1);
  const split = await measure("fun readConfig() = 1\n\nfun renderChart() = 2\n\nfun sendMail() = 3\n");
  expect(split.metrics.cohesion_groups).toBe(3);
});

it("kotlin cohesion > a file with no function is unavailable, and a test file is not rated", async () => {
  expect((await measure("val a = 1\n")).metrics.cohesion_groups).toBeUndefined();
  expect((await measure("fun a() = 1\n", true)).metrics.cohesion_groups).toBeUndefined();
});

// ------------------------------------------------------------------------------------------ shortcuts

it("kotlin shortcuts > finds suppressions, in comments and annotations", async () => {
  const { metrics } = await measure(`class A {
    @Suppress("UNCHECKED_CAST")
    fun a() { val x = 1 // noinspection
    }
    @SuppressLint("NewApi")
    fun b() { }
}`);
  expect(only(metrics, "escape_")).toEqual({ escape_lint_disable: 3, escape_hatches: 3 });
});

it("kotlin shortcuts > finds ignored tests", async () => {
  const { metrics } = await measure(
    "class T {\n  @Ignore fun a() { }\n  @Disabled fun b() { }\n  @Test fun c() { }\n}\n",
  );
  expect(metrics.escape_skipped_test).toBe(2);
});

it("kotlin shortcuts > finds an empty catch block and leaves one that does something", async () => {
  const { metrics } = await measure(
    "fun f() {\n  try { g() } catch (e: Exception) { }\n  try { g() } catch (e: Exception) { log(e) }\n}\n",
  );
  expect(metrics.escape_empty_catch).toBe(1);
});

// ------------------------------------------------------------------------------------------ security

const sec = async (body: string) => only((await measure(`fun f() { ${body} }`)).metrics, "security_");

const POSITIVES: Array<[kind: string, body: string]> = [
  ["dynamic_code", "engine.eval(script)"],
  ["command_exec", "Runtime.getRuntime().exec(cmd)"],
  ["command_exec", 'ProcessBuilder("sh", "-c", cmd).start()'],
  ["unsafe_deserialization", "ObjectInputStream(input).readObject()"],
  ["hardcoded_secret", 'val password = "hunter2hunter2"'],
  ["hardcoded_secret", 'val apiKey: String = "abcdefgh12345678"'],
  ["hardcoded_secret", `val k = "${"AKIA"}${"A".repeat(16)}"`],
  ["tls_disabled", "c.setHostnameVerifier { _, _ -> true }"],
  ["tls_disabled", "val v = HostnameVerifier { _, _ -> true }"],
  ["tls_disabled", "c.setHostnameVerifier(NoopHostnameVerifier())"],
  ["sql_concat", 'st.executeQuery("select * from t where id = " + id)'],
  ["sql_concat", 'st.executeQuery("select * from t where id = $id")'],
  ["sql_concat", 'db.rawQuery("select ${"$"}{a}")'],
];

it.each(POSITIVES)("kotlin security > finds %s: %s", async (kind, body) => {
  const found = await sec(body);
  expect(found[`security_${kind}`], JSON.stringify(found)).toBe(1);
  expect(found.security_signals).toBe(1);
});

const LOOK_ALIKES = [
  "evaluate(script)",
  'ProcessBuilder("ls", "-l").start()',
  "ObjectOutputStream(out)",
  'val password = System.getenv("PASSWORD")',
  'val password = ""',
  'val token = "short"',
  'st.executeQuery("select * from t where id = ?")',
  'log.info("select " + a)',
  "c.setHostnameVerifier(strict)",
];

it.each(LOOK_ALIKES)("kotlin security > leaves alone: %s", async (body) => {
  expect(await sec(body)).toEqual({});
});

it("kotlin security > never keeps what a secret says, and does not rate test files", async () => {
  const code = 'val password = "correct-horse-battery"\n';
  expect(JSON.stringify(await measure(code))).not.toContain("correct-horse");
  expect(Object.keys((await measure(code, true)).metrics).filter((k) => k.startsWith("security_"))).toEqual(
    [],
  );
});
