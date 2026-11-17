import { expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { LANGUAGES } from "../src/languages/index.js";
import { computeMetrics } from "../src/metrics/file-metrics.js";
import { getParser } from "../src/parse.js";
import { resolveRuby } from "../src/resolve/modules.js";
import type { ResolveContext } from "../src/resolve/types.js";
import { makeTree } from "./helpers.js";
import { values } from "./history-helpers.js";

const ruby = LANGUAGES.find((l) => l.id === "ruby") as (typeof LANGUAGES)[number];

async function measure(code: string, isTest = false) {
  return computeMetrics(await getParser(ruby.grammar), ruby, code, isTest);
}

const only = (m: Record<string, number>, prefix: string) =>
  Object.fromEntries(
    Object.entries(m).filter(([k, v]) => k.startsWith(prefix) && v > 0 && !k.endsWith("density")),
  );

// ------------------------------------------------------------------------------------------ coupling

it("ruby coupling > reads require, require_relative and load, and leaves a symbol argument alone", async () => {
  const { imports } = await measure(
    "require 'json'\nrequire_relative 'lib/util'\nrequire_relative '../helper'\nrequire \"app/models/user\"\nload 'tasks/x.rb'\nautoload :Thing, 'app/thing'\nputs 'require x'\n",
  );
  expect(imports).toEqual([
    "req:json",
    "rel:lib/util",
    "rel:../helper",
    "req:app/models/user",
    "req:tasks/x.rb",
  ]);
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
  "lib/app.rb",
  "lib/util.rb",
  "helper.rb",
  "app/models/user.rb",
  "lib/models/user.rb",
  "tasks/x.rb",
];

it("ruby coupling > resolves require_relative from the folder of the file, with or without .rb", () => {
  const c = ctx(FILES);
  expect(resolveRuby("rel:util", "lib/app.rb", c)).toEqual(["lib/util.rb"]);
  expect(resolveRuby("rel:../helper", "lib/app.rb", c)).toEqual(["helper.rb"]);
  expect(resolveRuby("rel:util.rb", "lib/app.rb", c)).toEqual(["lib/util.rb"]);
  expect(resolveRuby("rel:missing", "lib/app.rb", c)).toEqual([]);
});

it("ruby coupling > resolves require along the load path: the file whose path ends like the name, the closest first", () => {
  const c = ctx(FILES);
  expect(resolveRuby("req:app/models/user", "lib/app.rb", c)).toEqual(["app/models/user.rb"]);
  expect(resolveRuby("req:models/user", "lib/app.rb", c)).toEqual(["lib/models/user.rb"]);
  expect(resolveRuby("req:util", "lib/app.rb", c)).toEqual(["lib/util.rb"]);
});

it("ruby coupling > leaves gems and the standard library without a file", () => {
  const c = ctx(FILES);
  for (const spec of ["req:json", "req:active_support/core_ext", "req:set"])
    expect(resolveRuby(spec, "lib/app.rb", c), spec).toEqual([]);
});

it("ruby coupling > links the files of a project", async () => {
  const dir = makeTree({
    "lib/app.rb": "require 'json'\nrequire_relative 'util'\nclass App; end\n",
    "lib/util.rb": "module Util; end\n",
  });
  const v = values(await analyze({ folder: dir }));
  expect(v.get("lib/app.rb")?.imports_out).toBe(1);
  expect(v.get("lib/util.rb")?.imports_in).toBe(1);
});

// ------------------------------------------------------------------------------------------ cohesion

it("ruby cohesion > methods that share an instance variable, an accessor or a call are one group, module included", async () => {
  const { metrics } = await measure(`module App
  class Box
    attr_reader :label
    def initialize(label)
      @label = label
      @items = []
    end
    def count
      @items.size
    end
    def add(x)
      @items << x
      count
    end
    def title
      label
    end
  end
end`);
  // count and add share @items (and add calls count); title only uses label
  expect(metrics.cohesion_groups).toBe(2);
});

it("ruby cohesion > top-level methods that share a constant are one group; unrelated ones are several", async () => {
  const shared = await measure(
    "LIMIT = 10\ndef check(x)\n  x < LIMIT\nend\ndef clamp(x)\n  [x, LIMIT].min\nend\n",
  );
  expect(shared.metrics.cohesion_groups).toBe(1);
  const split = await measure(
    "def read_config\n  1\nend\ndef render_chart\n  2\nend\ndef send_mail\n  3\nend\n",
  );
  expect(split.metrics.cohesion_groups).toBe(3);
});

it("ruby cohesion > a file with no method is unavailable, and a test file is not rated", async () => {
  expect((await measure("A = 1\n")).metrics.cohesion_groups).toBeUndefined();
  expect((await measure("def a\n  1\nend\n", true)).metrics.cohesion_groups).toBeUndefined();
});

// ------------------------------------------------------------------------------------------ shortcuts

it("ruby shortcuts > finds rubocop and type-checker suppressions", async () => {
  const { metrics } = await measure(
    "# typed: ignore\nx = y # rubocop:disable Style/Foo\n# :nocov:\nz = T.unsafe(w)\n",
  );
  expect(only(metrics, "escape_")).toEqual({
    escape_lint_disable: 2,
    escape_type_ignore: 2,
    escape_hatches: 4,
  });
});

it("ruby shortcuts > finds skipped and focused tests", async () => {
  const { metrics } = await measure(
    "describe 'a' do\n  skip 'later'\n  pending 'x'\n  xit 'b' do\n  end\n  fit 'c' do\n  end\n  it 'd' do\n  end\nend\n",
  );
  expect(metrics.escape_skipped_test).toBe(3);
  expect(metrics.escape_focused_test).toBe(1);
});

it("ruby shortcuts > finds a rescue that does nothing, and leaves one that does something", async () => {
  const { metrics } = await measure(
    "begin\n  a\nrescue\nend\nbegin\n  b\nrescue => e\nend\nbegin\n  c\nrescue StandardError\n  nil\nend\nbegin\n  d\nrescue\n  log(1)\nend\n",
  );
  expect(metrics.escape_empty_catch).toBe(3);
});

// ------------------------------------------------------------------------------------------ security

const sec = async (body: string) => only((await measure(`def f(a)\n  ${body}\nend\n`)).metrics, "security_");

const POSITIVES: Array<[kind: string, body: string]> = [
  ["dynamic_code", "eval(a)"],
  ["dynamic_code", "obj.instance_eval(a)"],
  ["command_exec", 'system("ls #{a}")'],
  ["command_exec", "exec(a)"],
  ["command_exec", "`ls #{a}`"],
  ["unsafe_deserialization", "Marshal.load(a)"],
  ["unsafe_deserialization", "YAML.load(a)"],
  ["unsafe_html", "raw(a)"],
  ["unsafe_html", "a.html_safe"],
  ["hardcoded_secret", 'password = "hunter2hunter2"'],
  ["hardcoded_secret", 'conf = { api_key: "abcdefgh12345678" }'],
  ["hardcoded_secret", `k = "${"AKIA"}${"A".repeat(16)}"`],
  ["tls_disabled", "http.verify_mode = OpenSSL::SSL::VERIFY_NONE"],
  ["tls_disabled", "conn = Faraday.new(ssl: { verify: false })"],
  ["sql_concat", `User.where("name = '#{"#"}{a}'")`],
  ["sql_concat", 'conn.execute("select " + a)'],
];

it.each(POSITIVES)("ruby security > finds %s: %s", async (kind, body) => {
  const found = await sec(body);
  expect(found[`security_${kind}`], JSON.stringify(found)).toBe(1);
  expect(found.security_signals).toBe(1);
});

const LOOK_ALIKES = [
  "evaluate(a)",
  "obj.class_eval do\n  1\nend",
  'system("ls", "-l")',
  "YAML.safe_load(a)",
  "JSON.parse(a)",
  "sanitize(a)",
  'password = ENV["PASSWORD"]',
  'password = ""',
  'token = "short"',
  'token_url = "/oauth/token"',
  "conn = Faraday.new(ssl: { verify: true })",
  'User.where("name = ?", a)',
  "User.where(name: a)",
  'log("select " + a)',
];

it.each(LOOK_ALIKES)("ruby security > leaves alone: %s", async (body) => {
  expect(await sec(body)).toEqual({});
});

it("ruby security > never keeps what a secret says, and does not rate test files", async () => {
  const code = 'password = "correct-horse-battery"\n';
  expect(JSON.stringify(await measure(code))).not.toContain("correct-horse");
  expect(Object.keys((await measure(code, true)).metrics).filter((k) => k.startsWith("security_"))).toEqual(
    [],
  );
});
