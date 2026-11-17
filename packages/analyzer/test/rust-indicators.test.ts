import { expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { LANGUAGES } from "../src/languages/index.js";
import { computeMetrics } from "../src/metrics/file-metrics.js";
import { getParser } from "../src/parse.js";
import { resolveRust } from "../src/resolve/modules.js";
import type { ResolveContext } from "../src/resolve/types.js";
import { makeTree } from "./helpers.js";
import { values } from "./history-helpers.js";

const rust = LANGUAGES.find((l) => l.id === "rust") as (typeof LANGUAGES)[number];

async function measure(code: string, isTest = false) {
  return computeMetrics(await getParser(rust.grammar), rust, code, isTest);
}

const only = (m: Record<string, number>, prefix: string) =>
  Object.fromEntries(
    Object.entries(m).filter(([k, v]) => k.startsWith(prefix) && v > 0 && !k.endsWith("density")),
  );

// ------------------------------------------------------------------------------------------ coupling

it("rust coupling > reads use paths, groups and wildcards, and the modules a file declares", async () => {
  const { imports } = await measure(
    "mod util;\nmod models { pub struct A; }\nuse std::collections::HashMap;\nuse crate::util::helper;\nuse crate::models::{A, B as C};\nuse self::inner::*;\n",
  );
  expect(imports).toEqual([
    "mod:util",
    "std::collections::HashMap",
    "crate::util::helper",
    "crate::models::{A,B}",
    "self::inner::*",
  ]);
});

const FILES = [
  "Cargo.toml",
  "src/lib.rs",
  "src/util.rs",
  "src/models/mod.rs",
  "src/models/user.rs",
  "src/net/client.rs",
  "src/net.rs",
  "tools/Cargo.toml",
  "tools/src/main.rs",
];
const ctx = (crates: Array<[string, string]> = []): ResolveContext => ({
  files: new Set(FILES),
  configs: new Map(),
  packages: new Map(),
  goModules: new Map(),
  rustCrates: new Map(crates),
  namespaces: new Map(),
});

it("rust coupling > resolves mod x; next to the file, as x.rs or x/mod.rs", () => {
  expect(resolveRust("mod:util", "src/lib.rs", ctx())).toEqual(["src/util.rs"]);
  expect(resolveRust("mod:models", "src/lib.rs", ctx())).toEqual(["src/models/mod.rs"]);
  // inside src/net.rs the modules live in src/net/
  expect(resolveRust("mod:client", "src/net.rs", ctx())).toEqual(["src/net/client.rs"]);
  expect(resolveRust("mod:missing", "src/lib.rs", ctx())).toEqual([]);
});

it("rust coupling > resolves crate::, self:: and super:: paths, dropping the names of types and functions", () => {
  expect(resolveRust("crate::util::helper", "src/models/user.rs", ctx())).toEqual(["src/util.rs"]);
  expect(resolveRust("crate::models::user::User", "src/lib.rs", ctx())).toEqual(["src/models/user.rs"]);
  expect(resolveRust("super::user::User", "src/models/mod.rs", ctx())).toEqual(["src/models/user.rs"]);
  // `super::util` is not a module of `models`: the names a parent module holds are in its own file
  expect(resolveRust("super::util", "src/models/user.rs", ctx())).toEqual(["src/models/mod.rs"]);
});

it("rust coupling > expands a group of paths and a wildcard", () => {
  const found = resolveRust("crate::{util::helper,models::{self,user::User}}", "src/lib.rs", ctx()).sort();
  expect(found).toEqual(["src/models/mod.rs", "src/models/user.rs", "src/util.rs"]);
  expect(resolveRust("crate::models::*", "src/lib.rs", ctx())).toEqual(["src/models/mod.rs"]);
});

it("rust coupling > resolves another crate of the project by the name of its package, and leaves the others", () => {
  const c = ctx([["factory_tools", "tools"]]);
  // the crate's root file holds `run`
  expect(resolveRust("factory_tools::run", "src/lib.rs", c)).toEqual(["tools/src/main.rs"]);
  for (const spec of ["std::fs::File", "serde::Serialize", "core::fmt"])
    expect(resolveRust(spec, "src/lib.rs", c), spec).toEqual([]);
});

it("rust coupling > links the files of a project", async () => {
  const dir = makeTree({
    "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n',
    "src/lib.rs": "mod util;\npub use crate::util::helper;\n",
    "src/util.rs": "pub fn helper() -> u32 { 1 }\n",
  });
  const v = values(await analyze({ folder: dir }));
  expect(v.get("src/lib.rs")?.imports_out).toBe(1);
  expect(v.get("src/util.rs")?.imports_in).toBe(1);
});

// ------------------------------------------------------------------------------------------ cohesion

it("rust cohesion > methods that use the same field of their struct are one group, impl blocks merged", async () => {
  const { metrics } = await measure(`pub struct Boxy { items: Vec<i32>, label: String }

impl Boxy {
    pub fn count(&self) -> usize { self.items.len() }
}
impl Boxy {
    pub fn add(&mut self, x: i32) { self.items.push(x); }
    pub fn title(&self) -> &str { &self.label }
}`);
  // count and add share items; title only uses label
  expect(metrics.cohesion_groups).toBe(2);
});

it("rust cohesion > functions of a module and of an inline mod that share a constant are one group", async () => {
  const { metrics } = await measure(
    "const LIMIT: u32 = 10;\nfn check(x: u32) -> bool { x < LIMIT }\nmod inner { pub fn clamp(x: u32) -> u32 { x } }\n",
  );
  // check is linked to nothing else in the file; clamp is in the inner module and is read too
  expect(metrics.cohesion_groups).toBe(2);
});

it("rust cohesion > unrelated functions are several groups; no function, or a test file, is unavailable", async () => {
  const split = await measure(
    "fn read_config() -> u32 { 1 }\nfn render_chart() -> u32 { 2 }\nfn send_mail() -> u32 { 3 }\n",
  );
  expect(split.metrics.cohesion_groups).toBe(3);
  expect((await measure("const A: u32 = 1;\n")).metrics.cohesion_groups).toBeUndefined();
  expect((await measure("fn a() {}\n", true)).metrics.cohesion_groups).toBeUndefined();
});

// ------------------------------------------------------------------------------------------ shortcuts

it("rust shortcuts > finds allow attributes, unsafe blocks and ignored tests", async () => {
  const { metrics } = await measure(`#![allow(clippy::all)]
#[allow(dead_code)]
#[ignore]
fn t() {
    unsafe { do_it(); }
    unsafe { do_more(); }
}`);
  expect(only(metrics, "escape_")).toEqual({
    escape_lint_disable: 2,
    escape_skipped_test: 1,
    escape_unsafe_code: 2,
    escape_hatches: 5,
  });
});

it("rust shortcuts > finds an error arm that does nothing, and leaves one that does something", async () => {
  const { metrics } = await measure(
    "fn f() { match x { Ok(_) => {}, Err(_) => {} } match y { Err(e) => log(e), _ => {} } match z { Err(_) => (), _ => {} } }",
  );
  expect(metrics.escape_empty_catch).toBe(2);
});

it("rust shortcuts > leaves look-alikes alone", async () => {
  const { metrics } = await measure(
    '#[derive(Debug)]\n#[test]\nfn t() { let s = "unsafe and #[allow(x)] are words"; }\n',
  );
  expect(only(metrics, "escape_")).toEqual({});
});

// ------------------------------------------------------------------------------------------ security

const sec = async (body: string) => only((await measure(`fn f() { ${body} }`)).metrics, "security_");
const item = async (code: string) => only((await measure(code)).metrics, "security_");

const POSITIVES: Array<[kind: string, body: string]> = [
  ["dynamic_code", "let l = libloading::Library::new(path);"],
  ["command_exec", 'Command::new("sh").arg("-c").arg(cmd).output();'],
  ["unsafe_html", "let h = PreEscaped(text);"],
  ["hardcoded_secret", 'let password = "hunter2hunter2";'],
  ["hardcoded_secret", 'let api_key: &str = "abcdefgh12345678";'],
  ["hardcoded_secret", 'let c = Config { password: "hunter2hunter2" };'],
  ["hardcoded_secret", `let k = "${"AKIA"}${"A".repeat(16)}";`],
  ["tls_disabled", "let c = reqwest::Client::builder().danger_accept_invalid_certs(true);"],
  ["tls_disabled", "b.set_verify(SslVerifyMode::NONE);"],
  ["sql_concat", 'client.execute(&format!("select {}", a));'],
  ["sql_concat", 'sqlx::query(&format!("delete from t where id = {}", id));'],
  ["sql_concat", 'db.query("select ".to_string() + a);'],
];

it.each(POSITIVES)("rust security > finds %s: %s", async (kind, body) => {
  const found = await sec(body);
  expect(found[`security_${kind}`], JSON.stringify(found)).toBe(1);
  expect(found.security_signals).toBe(1);
});

it("rust security > finds a hard-coded secret in a const and a static", async () => {
  expect((await item('const TOKEN: &str = "abcdefgh12345678";')).security_hardcoded_secret).toBe(1);
  expect((await item('pub static PASSWORD: &str = "hunter2hunter2";')).security_hardcoded_secret).toBe(1);
});

const LOOK_ALIKES = [
  'Command::new("ls").arg("-l").output();',
  'Command::new("git").arg(x).output();',
  'let password = std::env::var("PASSWORD");',
  'let password = "";',
  'let token = "short";',
  'let token_url = "/oauth/token";',
  "let c = reqwest::Client::builder().danger_accept_invalid_certs(false);",
  'client.execute("select * from t where id = $1");',
  'log::info!("select {}", a);',
  "let h = escape(text);",
];

it.each(LOOK_ALIKES)("rust security > leaves alone: %s", async (body) => {
  expect(await sec(body)).toEqual({});
});

it("rust security > counts a chained call once, never keeps what a secret says, and does not rate test files", async () => {
  expect((await sec('Command::new("sh").arg("-c").arg(cmd).output();')).security_signals).toBe(1);
  const code = 'fn f() { let password = "correct-horse-battery"; }\n';
  expect(JSON.stringify(await measure(code))).not.toContain("correct-horse");
  expect(Object.keys((await measure(code, true)).metrics).filter((k) => k.startsWith("security_"))).toEqual(
    [],
  );
});
