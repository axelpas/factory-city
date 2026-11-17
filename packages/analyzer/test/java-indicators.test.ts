import { expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { LANGUAGES } from "../src/languages/index.js";
import { computeMetrics } from "../src/metrics/file-metrics.js";
import { getParser } from "../src/parse.js";
import { resolveJava } from "../src/resolve/modules.js";
import { makeTree } from "./helpers.js";
import { values } from "./history-helpers.js";

const java = LANGUAGES.find((l) => l.id === "java") as (typeof LANGUAGES)[number];

async function measure(code: string, isTest = false) {
  return computeMetrics(await getParser(java.grammar), java, code, isTest);
}

const only = (m: Record<string, number>, prefix: string) =>
  Object.fromEntries(
    Object.entries(m).filter(([k, v]) => k.startsWith(prefix) && v > 0 && !k.endsWith("density")),
  );

// ------------------------------------------------------------------------------------------ coupling

it("java coupling > reads single, static and wildcard imports with their full names", async () => {
  const { imports } = await measure(
    "package a;\nimport java.util.List;\nimport static java.lang.Math.max;\nimport com.example.model.*;\nclass A {}\n",
  );
  expect(imports).toEqual(["java.util.List", "java.lang.Math.max", "com.example.model.*"]);
});

const FILES = new Set([
  "src/main/java/com/example/app/Main.java",
  "src/main/java/com/example/app/util/Helper.java",
  "src/main/java/com/example/app/model/User.java",
  "src/main/java/com/example/app/model/Order.java",
  "src/test/java/com/example/app/util/Helper.java",
]);

it("java coupling > resolves a class to the file named after it, in the folders of its package", () => {
  expect(resolveJava("com.example.app.model.User", "src/main/java/com/example/app/Main.java", FILES)).toEqual(
    ["src/main/java/com/example/app/model/User.java"],
  );
});

it("java coupling > reads a static import as the class it names, and a wildcard as the package folder", () => {
  const from = "src/main/java/com/example/app/Main.java";
  expect(resolveJava("com.example.app.util.Helper.parse", from, FILES)).toEqual([
    "src/main/java/com/example/app/util/Helper.java",
  ]);
  expect(resolveJava("com.example.app.model.*", from, FILES).sort()).toEqual([
    "src/main/java/com/example/app/model/Order.java",
    "src/main/java/com/example/app/model/User.java",
  ]);
});

it("java coupling > prefers the file closest to the importer when two answer to a name", () => {
  expect(resolveJava("com.example.app.util.Helper", "src/test/java/com/example/app/X.java", FILES)).toEqual([
    "src/test/java/com/example/app/util/Helper.java",
  ]);
});

it("java coupling > leaves the JDK and libraries without a file", () => {
  for (const spec of ["java.util.List", "org.junit.jupiter.api.Test", "java.util.*", "lombok.Data"])
    expect(resolveJava(spec, "src/main/java/com/example/app/Main.java", FILES), spec).toEqual([]);
});

it("java coupling > links the files of a project", async () => {
  const dir = makeTree({
    "src/com/x/Main.java":
      "package com.x;\nimport java.util.List;\nimport com.x.util.Helper;\nclass Main { }\n",
    "src/com/x/util/Helper.java": "package com.x.util;\nclass Helper { }\n",
  });
  const v = values(await analyze({ folder: dir }));
  expect(v.get("src/com/x/Main.java")).toMatchObject({ imports_out: 1 });
  expect(v.get("src/com/x/util/Helper.java")).toMatchObject({ imports_in: 1 });
});

// ------------------------------------------------------------------------------------------ cohesion

it("java cohesion > methods that use the same field, with or without this, are one group", async () => {
  const { metrics } = await measure(`class Box {
    private final java.util.List<Integer> items = null;
    private String label;
    Box(String label) { this.label = label; }
    int count() { return items.size(); }
    void add(int x) { this.items.add(x); }
    String title() { return label; }
}`);
  // count and add share items; title only uses label
  expect(metrics.cohesion_groups).toBe(2);
});

it("java cohesion > a method that calls another of its class joins it", async () => {
  const { metrics } = await measure(
    "class A {\n  int one() { return two(); }\n  int two() { return 2; }\n}\n",
  );
  expect(metrics.cohesion_groups).toBe(1);
});

it("java cohesion > methods that use nothing in common are several groups", async () => {
  const { metrics } = await measure(
    "class A {\n  int readConfig() { return 1; }\n  int renderChart() { return 2; }\n  int sendMail() { return 3; }\n}\n",
  );
  expect(metrics.cohesion_groups).toBe(3);
});

it("java cohesion > a class with no method is unavailable, and a test file is not rated", async () => {
  expect((await measure("class A { int x; }\n")).metrics.cohesion_groups).toBeUndefined();
  expect(
    (await measure("class A { int a() { return 1; } }\n", true)).metrics.cohesion_groups,
  ).toBeUndefined();
});

// ------------------------------------------------------------------------------------------ shortcuts

it("java shortcuts > finds suppressions, in comments and annotations", async () => {
  const { metrics } = await measure(`class A {
    @SuppressWarnings("unchecked")
    void a() { int x = 1; // NOSONAR
    }
    @SuppressFBWarnings
    void b() { } // NOPMD
}`);
  expect(only(metrics, "escape_")).toEqual({ escape_lint_disable: 4, escape_hatches: 4 });
});

it("java shortcuts > finds disabled tests, whatever the way of disabling them", async () => {
  const { metrics } = await measure(`class T {
    @Disabled void a() { }
    @Ignore("later") void b() { }
    @Test(enabled = false) void c() { }
    @Test void d() { }
}`);
  expect(metrics.escape_skipped_test).toBe(3);
});

it("java shortcuts > finds an empty catch block and leaves one that does something", async () => {
  const { metrics } = await measure(
    "class A { void a() { try { f(); } catch (Exception e) { } try { g(); } catch (Exception e) { log(e); } } }",
  );
  expect(metrics.escape_empty_catch).toBe(1);
});

// ------------------------------------------------------------------------------------------ security

const sec = async (body: string) =>
  only((await measure(`class A { void f() { ${body} } }`)).metrics, "security_");
const field = async (decl: string) => only((await measure(`class A { ${decl} }`)).metrics, "security_");

const POSITIVES: Array<[kind: string, body: string]> = [
  ["dynamic_code", "engine.eval(script);"],
  ["command_exec", "Runtime.getRuntime().exec(cmd);"],
  ["command_exec", 'new ProcessBuilder("sh", "-c", cmd).start();'],
  ["unsafe_deserialization", "Object o = new ObjectInputStream(in).readObject();"],
  ["unsafe_deserialization", "new XMLDecoder(in);"],
  ["hardcoded_secret", 'String password = "hunter2hunter2";'],
  ["hardcoded_secret", 'this.apiKey = "abcdefgh12345678";'],
  ["hardcoded_secret", `String k = "${"AKIA"}${"A".repeat(16)}";`],
  ["tls_disabled", "c.setHostnameVerifier((h, s) -> true);"],
  ["tls_disabled", "c.setHostnameVerifier(new NoopHostnameVerifier());"],
  ["tls_disabled", "c.setHostnameVerifier(SSLSocketFactory.ALLOW_ALL_HOSTNAME_VERIFIER);"],
  ["sql_concat", 'st.executeQuery("select * from t where id = " + id);'],
  ["sql_concat", 'em.createNativeQuery("select " + a);'],
  ["sql_concat", 'conn.prepareStatement(String.format("select %s", a));'],
];

it.each(POSITIVES)("java security > finds %s: %s", async (kind, body) => {
  const found = await sec(body);
  expect(found[`security_${kind}`], JSON.stringify(found)).toBe(1);
  expect(found.security_signals).toBe(1);
});

it("java security > finds a hard-coded secret in a field", async () => {
  expect(
    (await field('private static final String TOKEN = "abcdefgh12345678";')).security_hardcoded_secret,
  ).toBe(1);
});

const LOOK_ALIKES = [
  "evaluate(script);",
  'new ProcessBuilder("ls", "-l").start();',
  "Runtime.getRuntime().availableProcessors();",
  "Object o = new ObjectOutputStream(out);",
  'String password = System.getenv("PASSWORD");',
  'String password = "";',
  'String token = "short";',
  'st.executeQuery("select * from t where id = ?");',
  'log.info("select " + a);',
  "c.setHostnameVerifier(strict);",
];

it.each(LOOK_ALIKES)("java security > leaves alone: %s", async (body) => {
  expect(await sec(body)).toEqual({});
});

it("java security > never keeps what a secret says, and does not rate test files", async () => {
  const code = 'class A { String password = "correct-horse-battery"; }';
  expect(JSON.stringify(await measure(code))).not.toContain("correct-horse");
  expect(Object.keys((await measure(code, true)).metrics).filter((k) => k.startsWith("security_"))).toEqual(
    [],
  );
});
