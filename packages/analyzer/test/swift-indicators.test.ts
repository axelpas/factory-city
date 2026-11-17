import { expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { LANGUAGES } from "../src/languages/index.js";
import { computeMetrics } from "../src/metrics/file-metrics.js";
import { getParser } from "../src/parse.js";
import { resolveSwift } from "../src/resolve/modules.js";
import type { ResolveContext } from "../src/resolve/types.js";
import { makeTree } from "./helpers.js";
import { values } from "./history-helpers.js";

const swift = LANGUAGES.find((l) => l.id === "swift") as (typeof LANGUAGES)[number];

async function measure(code: string, isTest = false) {
  return computeMetrics(await getParser(swift.grammar), swift, code, isTest);
}

const only = (m: Record<string, number>, prefix: string) =>
  Object.fromEntries(
    Object.entries(m).filter(([k, v]) => k.startsWith(prefix) && v > 0 && !k.endsWith("density")),
  );

// ------------------------------------------------------------------------------------------ coupling

it("swift coupling > reads imports, testable and kind-qualified ones", async () => {
  const { imports } = await measure(
    "import Foundation\nimport MyModule\n@testable import App\nimport struct Foundation.Date\n",
  );
  expect(imports).toEqual(["Foundation", "MyModule", "App", "Foundation.Date"]);
});

const ctx = (files: string[]): ResolveContext => ({
  files: new Set(files),
  configs: new Map(),
  packages: new Map(),
  goModules: new Map(),
  rustCrates: new Map(),
  namespaces: new Map(),
});
const FILES = [
  "Sources/App/main.swift",
  "Sources/Core/Model.swift",
  "Sources/Core/Store.swift",
  "Tests/CoreTests/ModelTests.swift",
  "Legacy/Net/Client.swift",
];

it("swift coupling > resolves a module to the files of its folder in Sources/, tests left out", () => {
  const c = ctx(FILES);
  expect(resolveSwift("Core", c).sort()).toEqual(["Sources/Core/Model.swift", "Sources/Core/Store.swift"]);
  expect(resolveSwift("Core.Model", c)).toHaveLength(2);
});

it("swift coupling > falls back on a folder of that name, and leaves system modules without a file", () => {
  const c = ctx(FILES);
  expect(resolveSwift("Net", c)).toEqual(["Legacy/Net/Client.swift"]);
  for (const spec of ["Foundation", "UIKit", "SwiftUI", "Alamofire"])
    expect(resolveSwift(spec, c), spec).toEqual([]);
});

it("swift coupling > links the files of a package; a module counts once in imports_out", async () => {
  const dir = makeTree({
    "Sources/App/main.swift": "import Foundation\nimport Core\nprint(1)\n",
    "Sources/Core/Model.swift": "public struct Model {}\n",
    "Sources/Core/Store.swift": "public struct Store {}\n",
  });
  const v = values(await analyze({ folder: dir }));
  expect(v.get("Sources/App/main.swift")?.imports_out).toBe(1);
  expect(v.get("Sources/Core/Model.swift")?.imports_in).toBe(1);
  expect(v.get("Sources/Core/Store.swift")?.imports_in).toBe(1);
});

// ------------------------------------------------------------------------------------------ cohesion

it("swift cohesion > methods that share a property, with or without self, are one group", async () => {
  const { metrics } = await measure(`struct Box {
    var items: [Int] = []
    let label: String
    func count() -> Int { return items.count }
    mutating func add(_ x: Int) { self.items.append(x) }
    func title() -> String { return label }
}`);
  // count and add share items; title only uses label
  expect(metrics.cohesion_groups).toBe(2);
});

it("swift cohesion > top-level functions that share a constant are one group; unrelated ones are several", async () => {
  const shared = await measure(
    "let limit = 10\nfunc check(_ x: Int) -> Bool { return x < limit }\nfunc clamp(_ x: Int) -> Int { return min(x, limit) }\n",
  );
  expect(shared.metrics.cohesion_groups).toBe(1);
  const split = await measure(
    "func readConfig() -> Int { return 1 }\nfunc renderChart() -> Int { return 2 }\nfunc sendMail() -> Int { return 3 }\n",
  );
  expect(split.metrics.cohesion_groups).toBe(3);
});

it("swift cohesion > a file with no function is unavailable, and a test file is not rated", async () => {
  expect((await measure("let a = 1\n")).metrics.cohesion_groups).toBeUndefined();
  expect((await measure("func a() -> Int { return 1 }\n", true)).metrics.cohesion_groups).toBeUndefined();
});

// ------------------------------------------------------------------------------------------ shortcuts

it("swift shortcuts > finds swiftlint suppressions and forced casts and tries", async () => {
  const { metrics } = await measure(`func f() {
    // swiftlint:disable:next force_cast
    let v = x as! String
    let r = try! g()
    let ok = x as? String
}`);
  expect(only(metrics, "escape_")).toEqual({
    escape_lint_disable: 1,
    escape_force_cast: 2,
    escape_hatches: 3,
  });
});

it("swift shortcuts > finds skipped tests", async () => {
  const { metrics } = await measure(
    'func t() throws {\n  throw XCTSkip("later")\n  try XCTSkipIf(true)\n}\n',
  );
  expect(metrics.escape_skipped_test).toBe(2);
});

it("swift shortcuts > finds a catch that does nothing, and leaves one that does something", async () => {
  const { metrics } = await measure(
    "func f() {\n  do { try g() } catch { }\n  do { try g() } catch { log(error) }\n}\n",
  );
  expect(metrics.escape_empty_catch).toBe(1);
});

// ------------------------------------------------------------------------------------------ security

const sec = async (body: string) =>
  only((await measure(`func f(_ a: String) { ${body} }`)).metrics, "security_");
const decl = async (code: string) => only((await measure(code)).metrics, "security_");

const POSITIVES: Array<[kind: string, body: string]> = [
  ["dynamic_code", "let e = NSExpression(format: a)"],
  ["command_exec", 'let s = "/bin/sh"'],
  ["command_exec", 'NSTask.launchedTask(withLaunchPath: "/bin/bash", arguments: ["-c", a])'],
  ["unsafe_deserialization", "NSKeyedUnarchiver.unarchiveObject(with: d)"],
  ["unsafe_deserialization", "u.requiresSecureCoding = false"],
  ["unsafe_html", 'web.loadHTMLString("<b>\\(a)</b>", baseURL: nil)'],
  ["hardcoded_secret", 'let password = "hunter2hunter2"'],
  ["hardcoded_secret", 'self.apiKey = "abcdefgh12345678"'],
  ["hardcoded_secret", `let k = "${"AKIA"}${"A".repeat(16)}"`],
  ["tls_disabled", "let c = URLCredential(trust: t)"],
  ["tls_disabled", "let e = DisabledTrustEvaluator()"],
  ["sql_concat", 'db.execute("select * from t where id = " + a)'],
  ["sql_concat", 'db.execute("select * from t where id = \\(a)")'],
];

it.each(POSITIVES)("swift security > finds %s: %s", async (kind, body) => {
  const found = await sec(body);
  expect(found[`security_${kind}`], JSON.stringify(found)).toBe(1);
  expect(found.security_signals).toBe(1);
});

it("swift security > finds a hard-coded secret in a property", async () => {
  expect((await decl('class A { var token = "abcdefgh12345678" }')).security_hardcoded_secret).toBe(1);
});

const LOOK_ALIKES = [
  "let e = NSExpression(forConstantValue: a)",
  'let s = "/usr/bin/env"',
  "NSKeyedUnarchiver.unarchivedObject(ofClass: X.self, from: d)",
  'web.loadHTMLString("<b>hello</b>", baseURL: nil)',
  'let password = ProcessInfo.processInfo.environment["PASSWORD"]',
  'let password = ""',
  'let token = "short"',
  'let tokenURL = "/oauth/token"',
  "let c = URLCredential(user: u, password: p, persistence: .none)",
  'db.execute("select * from t where id = ?", a)',
  'log("select " + a)',
];

it.each(LOOK_ALIKES)("swift security > leaves alone: %s", async (body) => {
  expect(await sec(body)).toEqual({});
});

it("swift security > never keeps what a secret says, and does not rate test files", async () => {
  const code = 'let password = "correct-horse-battery"\n';
  expect(JSON.stringify(await measure(code))).not.toContain("correct-horse");
  expect(Object.keys((await measure(code, true)).metrics).filter((k) => k.startsWith("security_"))).toEqual(
    [],
  );
});

it("swift coupling > a system framework is not a folder of the project that has the same name", () => {
  const c = ctx(["Sources/App/Network/Client.swift", "Sources/App/main.swift"]);
  expect(resolveSwift("Network", c)).toEqual([]);
  expect(resolveSwift("Security", ctx(["Security/Keys.swift"]))).toEqual([]);
  expect(resolveSwift("Billing", ctx(["Billing/Invoice.swift"]))).toEqual(["Billing/Invoice.swift"]);
});

it("swift cohesion > the methods of an extension of a type declared elsewhere are not rated", async () => {
  const { metrics } = await measure(
    "extension Box {\n    func a() -> Int { return 1 }\n    func b() -> Int { return 2 }\n}\n",
  );
  expect(metrics.cohesion_groups).toBeUndefined();
});

it("swift security > a private key block is found in a multi-line string", async () => {
  const code = 'let k = """\n-----BEGIN RSA PRIVATE KEY-----\nabc\n"""\n';
  expect((await decl(code)).security_hardcoded_secret).toBe(1);
});
