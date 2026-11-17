import { expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { LANGUAGES } from "../src/languages/index.js";
import { computeMetrics } from "../src/metrics/file-metrics.js";
import { getParser } from "../src/parse.js";
import { resolveCsharp } from "../src/resolve/modules.js";
import type { ResolveContext } from "../src/resolve/types.js";
import { makeTree } from "./helpers.js";
import { values } from "./history-helpers.js";

const cs = LANGUAGES.find((l) => l.id === "csharp") as (typeof LANGUAGES)[number];

async function measure(code: string, isTest = false) {
  return computeMetrics(await getParser(cs.grammar), cs, code, isTest);
}

const only = (m: Record<string, number>, prefix: string) =>
  Object.fromEntries(
    Object.entries(m).filter(([k, v]) => k.startsWith(prefix) && v > 0 && !k.endsWith("density")),
  );

// ------------------------------------------------------------------------------------------ coupling

it("csharp coupling > reads using directives, with the alias and static forms, and the namespaces a file declares", async () => {
  const { imports, declares } = await measure(
    "using System;\nusing System.Collections.Generic;\nusing static System.Math;\nusing Alias = App.Util.Helper;\nnamespace App.Services { class A {} }\n",
  );
  expect(imports).toEqual(["System", "System.Collections.Generic", "System.Math", "App.Util.Helper"]);
  expect(declares).toEqual(["App.Services"]);
});

it("csharp coupling > reads a file-scoped namespace", async () => {
  expect((await measure("namespace App.Models;\nclass A {}\n")).declares).toEqual(["App.Models"]);
});

const ctx = (namespaces: Array<[string, string[]]>): ResolveContext => ({
  files: new Set(),
  configs: new Map(),
  packages: new Map(),
  goModules: new Map(),
  namespaces: new Map(namespaces),
});

it("csharp coupling > resolves a namespace to every file that declares it", () => {
  const c = ctx([["App.Models", ["Models/User.cs", "Models/Order.cs"]]]);
  expect(resolveCsharp("App.Models", c)).toEqual(["Models/User.cs", "Models/Order.cs"]);
});

it("csharp coupling > reads a using static or alias target as the namespace that holds the class", () => {
  const c = ctx([["App.Util", ["Util/Helper.cs"]]]);
  expect(resolveCsharp("App.Util.Helper", c)).toEqual(["Util/Helper.cs"]);
});

it("csharp coupling > leaves the framework and packages without a file", () => {
  const c = ctx([["App.Models", ["Models/User.cs"]]]);
  for (const spec of ["System", "System.Linq", "Newtonsoft.Json"])
    expect(resolveCsharp(spec, c), spec).toEqual([]);
});

it("csharp coupling > links the files of a project; a namespace counts once in imports_out", async () => {
  const dir = makeTree({
    "Program.cs": "using System;\nusing App.Models;\nnamespace App { class Program { } }\n",
    "Models/User.cs": "namespace App.Models { class User { } }\n",
    "Models/Order.cs": "namespace App.Models { class Order { } }\n",
  });
  const v = values(await analyze({ folder: dir }));
  expect(v.get("Program.cs")?.imports_out).toBe(1);
  expect(v.get("Models/User.cs")?.imports_in).toBe(1);
  expect(v.get("Models/Order.cs")?.imports_in).toBe(1);
});

// ------------------------------------------------------------------------------------------ cohesion

it("csharp cohesion > methods that share a field or a property, with or without this, are one group, namespace included", async () => {
  const { metrics } = await measure(`namespace App {
  class Box {
    private readonly List<int> items = new();
    public string Label { get; set; }
    public int Count() { return items.Count; }
    public void Add(int x) { this.items.Add(x); }
    public string Title() { return Label; }
  }
}`);
  // Count and Add share items; Title only uses Label
  expect(metrics.cohesion_groups).toBe(2);
});

it("csharp cohesion > works with a file-scoped namespace, and unrelated methods are several groups", async () => {
  const { metrics } = await measure(
    "namespace App;\nclass A {\n  int ReadConfig() { return 1; }\n  int RenderChart() { return 2; }\n  int SendMail() { return 3; }\n}\n",
  );
  expect(metrics.cohesion_groups).toBe(3);
});

it("csharp cohesion > a class with no method is unavailable, and a test file is not rated", async () => {
  expect((await measure("class A { int x; }\n")).metrics.cohesion_groups).toBeUndefined();
  expect(
    (await measure("class A { int A1() { return 1; } }\n", true)).metrics.cohesion_groups,
  ).toBeUndefined();
});

// ------------------------------------------------------------------------------------------ shortcuts

it("csharp shortcuts > finds suppressions and nullable opt-outs", async () => {
  const { metrics } = await measure(`#pragma warning disable CS0168
// ReSharper disable once UnusedMember.Global
#nullable disable
class A {
  [SuppressMessage("a", "b")]
  void F() { }
}`);
  expect(only(metrics, "escape_")).toEqual({
    escape_lint_disable: 3,
    escape_type_ignore: 1,
    escape_hatches: 4,
  });
});

it("csharp shortcuts > finds ignored and skipped tests", async () => {
  const { metrics } = await measure(`class T {
  [Ignore] void A() { }
  [Fact(Skip = "later")] void B() { }
  [Fact] void C() { }
}`);
  expect(metrics.escape_skipped_test).toBe(2);
});

it("csharp shortcuts > finds an empty catch block and leaves one that does something", async () => {
  const { metrics } = await measure(
    "class A { void F() { try { G(); } catch (Exception) { } try { G(); } catch (Exception e) { Log(e); } } }",
  );
  expect(metrics.escape_empty_catch).toBe(1);
});

// ------------------------------------------------------------------------------------------ security

const sec = async (body: string) =>
  only((await measure(`class A { void F() { ${body} } }`)).metrics, "security_");

const POSITIVES: Array<[kind: string, body: string]> = [
  ["dynamic_code", "CSharpScript.EvaluateAsync(code);"],
  ["command_exec", 'Process.Start("cmd", a);'],
  ["command_exec", "var i = new ProcessStartInfo(); i.UseShellExecute = true;"],
  ["unsafe_deserialization", "var f = new BinaryFormatter();"],
  [
    "unsafe_deserialization",
    "var s = new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.All };",
  ],
  ["unsafe_html", "Html.Raw(text);"],
  ["unsafe_html", "var h = new HtmlString(text);"],
  ["hardcoded_secret", 'var password = "hunter2hunter2";'],
  ["hardcoded_secret", 'this.ApiKey = "abcdefgh12345678";'],
  ["hardcoded_secret", `var k = "${"AKIA"}${"A".repeat(16)}";`],
  ["tls_disabled", "ServicePointManager.ServerCertificateValidationCallback = (s, c, ch, e) => true;"],
  [
    "tls_disabled",
    "h.ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator;",
  ],
  ["sql_concat", 'var c = new SqlCommand("select * from t where id = " + id);'],
  ["sql_concat", 'var c = new SqlCommand($"select {a}");'],
  ["sql_concat", 'db.Database.ExecuteSqlRaw($"delete from t where id = {a}");'],
];

it.each(POSITIVES)("csharp security > finds %s: %s", async (kind, body) => {
  const found = await sec(body);
  expect(found[`security_${kind}`], JSON.stringify(found)).toBe(1);
  expect(found.security_signals).toBe(1);
});

const LOOK_ALIKES = [
  "CSharpScript.Help();",
  'Process.Start("notepad.exe");',
  "var f = new JsonSerializer();",
  "var s = new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.None };",
  "Html.Encode(text);",
  "var password = Environment.GetEnvironmentVariable(a);",
  'var password = "";',
  'var token = "short";',
  'var c = new SqlCommand("select * from t where id = @id");',
  'db.Database.ExecuteSqlInterpolated($"delete {a}");',
  'Log.Info("select " + a);',
];

it.each(LOOK_ALIKES)("csharp security > leaves alone: %s", async (body) => {
  expect(await sec(body)).toEqual({});
});

it("csharp security > never keeps what a secret says, and does not rate test files", async () => {
  const code = 'class A { string password = "correct-horse-battery"; }';
  expect(JSON.stringify(await measure(code))).not.toContain("correct-horse");
  expect(Object.keys((await measure(code, true)).metrics).filter((k) => k.startsWith("security_"))).toEqual(
    [],
  );
});
