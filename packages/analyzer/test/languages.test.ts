import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { isFullyCovered, LANGUAGES, languageForPath } from "../src/languages/index.js";
import { computeMetrics } from "../src/metrics/file-metrics.js";
import { getParser, loadGrammar } from "../src/parse.js";
import { isTestPath } from "../src/select.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/languages/${name}`, import.meta.url), "utf8");

async function measureFile(name: string) {
  const language = languageForPath(name);
  if (!language) throw new Error(`No language for ${name}`);
  return { language, ...computeMetrics(await getParser(language.grammar), language, fixture(name)) };
}

async function measure(id: string, code: string) {
  const language = LANGUAGES.find((l) => l.id === id);
  if (!language) throw new Error(`No language ${id}`);
  return computeMetrics(await getParser(language.grammar), language, code).metrics;
}

/**
 * Every fixture is the same small program: `classify` (an if with a logical operator, two else-if, a loop
 * inside a loop, a last choice) and a one-line method. One comment-only line, one silenced check.
 * Only the number of code lines differs from one language to the next.
 */
const TIER2: Array<[id: string, file: string, rloc: number]> = [
  ["python", "sample.py", 15],
  ["go", "sample.go", 23],
  ["java", "Sample.java", 21],
  ["csharp", "Sample.cs", 32],
  ["c", "sample.c", 18],
  ["cpp", "sample.cpp", 23],
  ["rust", "sample.rs", 26],
  ["php", "sample.php", 21],
  ["ruby", "sample.rb", 20],
  ["kotlin", "Sample.kt", 25],
  ["swift", "Sample.swift", 21],
];

/** The languages that are measured on every indicator, hence Tier 1; the others are still Tier 2. */
const FULL = ["python", "go", "java", "csharp", "kotlin", "rust", "php"];

it("tiers > a language is Tier 1 exactly when every indicator is covered", () => {
  for (const l of LANGUAGES) expect(isFullyCovered(l) ? 1 : 2, l.id).toBe(l.tier);
});

it.each(TIER2)("%s: measures the sample program", async (id, file, rloc) => {
  const { language, metrics, syntaxErrors, imports } = await measureFile(file);
  expect(language.id).toBe(id);
  expect(language.tier).toBe(FULL.includes(id) ? 1 : 2);
  expect(syntaxErrors).toBe(false);
  expect(metrics.comment_lines).toBe(1);
  expect(metrics.rloc).toBe(rloc);
  expect(metrics.functions).toBe(2);
  // branches: if, logical operator, else-if, else-if, loop, inner loop, last choice = 7; plus 2 functions
  expect(metrics.mcc).toBe(9);
  // classify alone: 1 + 7
  expect(metrics.max_function_complexity).toBe(8);
  // the loop inside the loop; an else-if chain does not go deeper
  expect(metrics.max_nesting_level).toBe(2);
  expect(metrics.escape_lint_disable).toBe(1);
  expect(metrics.escape_hatches).toBe(1);
  // a language without coupling or cohesion configured: unavailable, not zero
  if (!FULL.includes(id)) {
    expect(imports).toEqual([]);
    expect(metrics.cohesion_groups).toBeUndefined();
    expect(metrics.lack_of_cohesion).toBeUndefined();
  }
});

it("Tier 2 languages > covers the eleven languages of the specification", () => {
  const ids = LANGUAGES.map((l) => l.id);
  for (const [id] of TIER2) expect(ids).toContain(id);
});

it("Tier 2 languages > reads a .h file with the C++ grammar, under its own label", () => {
  expect(languageForPath("include/api.h")).toMatchObject({ id: "c-header", grammar: "cpp" });
  expect(languageForPath("src/main.c")?.id).toBe("c");
});

it("Tier 2 languages > still measures a file with syntax errors", async () => {
  const language = LANGUAGES.find((l) => l.id === "python") as (typeof LANGUAGES)[number];
  const result = computeMetrics(
    await getParser(language.grammar),
    language,
    "def broken(:\n    if x:\n        return 1\n",
  );
  expect(result.syntaxErrors).toBe(true);
  expect(result.metrics.loc).toBe(3);
  expect(result.metrics.rloc).toBe(3);
});

it("language configurations > keep the category codes of earlier snapshots: new languages are appended", () => {
  expect(LANGUAGES.slice(0, 3).map((l) => l.id)).toEqual(["typescript", "tsx", "javascript"]);
  expect(new Set(LANGUAGES.map((l) => l.id)).size).toBe(LANGUAGES.length);
});

it("language configurations > give each extension to one language only", () => {
  const seen = new Map<string, string>();
  for (const l of LANGUAGES)
    for (const ext of l.extensions) {
      expect(seen.get(ext), `${ext} is claimed by ${seen.get(ext)} and ${l.id}`).toBeUndefined();
      seen.set(ext, l.id);
    }
});

// a configuration that inherits from another may carry rules for nodes its own grammar lacks
const own = LANGUAGES.filter((l) => !l.extends).map((l) => [l.id, l] as const);
it.each(own)("%s: names only node types its grammar has", async (_id, l) => {
  const grammar = await loadGrammar(l.grammar);
  const known = (type: string) =>
    grammar.idForNodeType(type, true) !== null || grammar.idForNodeType(type, false) !== null;
  const named = [
    ...l.comment,
    ...l.functions,
    ...l.branches,
    ...l.nesting,
    ...l.logical.nodeTypes,
    ...Object.keys(l.nestingExceptParent),
    ...Object.values(l.nestingExceptParent).flat(),
    ...l.shortcuts.flatMap((rule) => (rule.nodeType ? [rule.nodeType] : [])),
  ];
  const unknown = [...new Set(named)].filter((type) => !known(type));
  expect(unknown).toEqual([]);
});

it("Tier 2 shortcuts beyond lint comments > python: a skipped test", async () => {
  const m = await measure("python", "@pytest.mark.skip\ndef test_a():\n    pass\n");
  expect(m.escape_skipped_test).toBe(1);
});

it("Tier 2 shortcuts beyond lint comments > go: a skipped test", async () => {
  const m = await measure("go", 'package p\nfunc TestA(t *testing.T) {\n\tt.Skip("later")\n}\n');
  expect(m.escape_skipped_test).toBe(1);
});

it("Tier 2 shortcuts beyond lint comments > java: a disabled test and an empty catch, each kind counted once", async () => {
  const code = [
    "class T {",
    "  @Disabled",
    "  void a() { try { run(); } catch (Exception e) { } }",
    '  @Ignore("flaky")',
    "  void b() { try { run(); } catch (Exception e) { log(e); } }",
    "}",
  ].join("\n");
  const m = await measure("java", code);
  expect(m.escape_skipped_test).toBe(2);
  expect(m.escape_empty_catch).toBe(1);
  expect(m.escape_hatches).toBe(3);
});

it("Tier 2 shortcuts beyond lint comments > c#: a pragma and an empty catch that only holds a comment", async () => {
  const code = [
    "class T {",
    "#pragma warning disable CS0168",
    "  void A() { try { Run(); } catch (Exception e) { /* nothing */ } }",
    "#pragma warning restore CS0168",
    "}",
  ].join("\n");
  const m = await measure("csharp", code);
  expect(m.escape_lint_disable).toBe(1);
  expect(m.escape_empty_catch).toBe(1);
});

it("Tier 2 shortcuts beyond lint comments > c++: a silenced warning and an empty catch", async () => {
  const code = [
    '#pragma GCC diagnostic ignored "-Wunused"',
    "void a() { try { run(); } catch (...) { } }",
  ].join("\n");
  const m = await measure("cpp", code);
  expect(m.escape_lint_disable).toBe(1);
  expect(m.escape_empty_catch).toBe(1);
});

it("Tier 2 shortcuts beyond lint comments > rust: an ignored test", async () => {
  const m = await measure("rust", "#[test]\n#[ignore]\nfn slow() {}\n");
  expect(m.escape_skipped_test).toBe(1);
  expect(m.escape_lint_disable).toBe(0);
});

it("Tier 2 shortcuts beyond lint comments > php: an empty catch", async () => {
  const m = await measure("php", "<?php\ntry { run(); } catch (Exception $e) { }\n");
  expect(m.escape_empty_catch).toBe(1);
});

it("Tier 2 shortcuts beyond lint comments > kotlin: a lint comment", async () => {
  const m = await measure("kotlin", "// ktlint-disable no-wildcard-imports\nfun a() {}\n");
  expect(m.escape_lint_disable).toBe(1);
});

it("test files of Tier 2 languages > are recognized by their usual names", () => {
  for (const path of [
    "pkg/parser_test.go",
    "app/test_models.py",
    "src/main/OrderServiceTest.java",
    "Billing/InvoiceTests.cs",
    "spec/models/user_spec.rb",
    "Sources/AppTests/LoginTests.swift",
    "src/OrderSpec.kt",
  ])
    expect(isTestPath(path), path).toBe(true);
  for (const path of ["src/contest.py", "src/Latest.java", "lib/attestation.rb", "src/Manifest.kt"])
    expect(isTestPath(path), path).toBe(false);
});
