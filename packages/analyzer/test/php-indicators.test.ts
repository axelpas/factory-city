import { expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { LANGUAGES } from "../src/languages/index.js";
import { computeMetrics } from "../src/metrics/file-metrics.js";
import { getParser } from "../src/parse.js";
import { resolvePhp } from "../src/resolve/modules.js";
import type { ResolveContext } from "../src/resolve/types.js";
import { makeTree } from "./helpers.js";
import { values } from "./history-helpers.js";

const php = LANGUAGES.find((l) => l.id === "php") as (typeof LANGUAGES)[number];

async function measure(code: string, isTest = false) {
  return computeMetrics(await getParser(php.grammar), php, `<?php\n${code}`, isTest);
}

const only = (m: Record<string, number>, prefix: string) =>
  Object.fromEntries(
    Object.entries(m).filter(([k, v]) => k.startsWith(prefix) && v > 0 && !k.endsWith("density")),
  );

// ------------------------------------------------------------------------------------------ coupling

it("php coupling > reads use clauses, groups, function imports and require, and the namespace the file declares", async () => {
  const { imports, declares } = await measure(
    "namespace App\\Services;\nuse App\\Models\\User;\nuse App\\Util\\{Helper, Str as S};\nuse function App\\Util\\slug;\nrequire_once 'lib/util.php';\nrequire __DIR__ . '/boot.php';\n",
  );
  expect(imports).toEqual([
    "use:use App\\Models\\User;",
    "use:use App\\Util\\{Helper, Str};",
    "use:use function App\\Util\\slug;",
    "req:lib/util.php",
    "req:/boot.php",
  ]);
  expect(declares).toEqual(["App\\Services"]);
});

const ctx = (files: string[], namespaces: Array<[string, string[]]>): ResolveContext => ({
  files: new Set(files),
  configs: new Map(),
  packages: new Map(),
  goModules: new Map(),
  rustCrates: new Map(),
  namespaces: new Map(namespaces),
});

const FILES = [
  "src/Models/User.php",
  "src/Util/Helper.php",
  "src/Util/Str.php",
  "src/Services/Box.php",
  "lib/util.php",
  "src/boot.php",
];
const NAMESPACES: Array<[string, string[]]> = [
  ["App\\Models", ["src/Models/User.php"]],
  ["App\\Util", ["src/Util/Helper.php", "src/Util/Str.php"]],
  ["App\\Services", ["src/Services/Box.php"]],
];

it("php coupling > resolves a class to the file named after it among the files of its namespace", () => {
  const c = ctx(FILES, NAMESPACES);
  expect(resolvePhp("use:use App\\Models\\User;", "src/Services/Box.php", c)).toEqual([
    "src/Models/User.php",
  ]);
  expect(resolvePhp("use:use \\App\\Models\\User;", "src/Services/Box.php", c)).toEqual([
    "src/Models/User.php",
  ]);
});

it("php coupling > expands a group and a list, and leaves function and const imports without a file", () => {
  const c = ctx(FILES, NAMESPACES);
  expect(resolvePhp("use:use App\\Util\\{Helper, Str};", "src/Services/Box.php", c).sort()).toEqual([
    "src/Util/Helper.php",
    "src/Util/Str.php",
  ]);
  expect(
    resolvePhp("use:use App\\Models\\User, App\\Util\\Helper;", "src/Services/Box.php", c).sort(),
  ).toEqual(["src/Models/User.php", "src/Util/Helper.php"]);
  expect(resolvePhp("use:use function App\\Util\\slug;", "src/Services/Box.php", c)).toEqual([]);
});

it("php coupling > leaves the framework and vendor classes without a file, and does not fall back on the namespace", () => {
  const c = ctx(FILES, NAMESPACES);
  for (const spec of [
    "use:use Illuminate\\Support\\Str;",
    "use:use App\\Models\\Missing;",
    "use:use Vendor\\Pkg\\Thing;",
  ])
    expect(resolvePhp(spec, "src/Services/Box.php", c), spec).toEqual([]);
});

it("php coupling > resolves a require from the folder of the file, __DIR__ included, then from the root", () => {
  const c = ctx(FILES, NAMESPACES);
  expect(resolvePhp("req:/boot.php", "src/index.php", c)).toEqual(["src/boot.php"]);
  expect(resolvePhp("req:lib/util.php", "src/index.php", c)).toEqual(["lib/util.php"]);
  expect(resolvePhp("req:nope.php", "src/index.php", c)).toEqual([]);
});

it("php coupling > keeps the path of a require, never the code around it", async () => {
  const { imports } = await measure(
    "require_once ABSPATH . 'wp-load.php';\ninclude $_SERVER['DOCUMENT_ROOT'] . $page;\nrequire \"$dir/x.php\";\n",
  );
  // the literal of the first, nothing for an expression or an interpolation
  expect(imports).toEqual(["req:wp-load.php"]);
});

it("php coupling > links the files of a project", async () => {
  const dir = makeTree({
    "src/Box.php":
      "<?php\nnamespace App;\nuse App\\Util\\Helper;\nuse Illuminate\\Support\\Str;\nclass Box { }\n",
    "src/Util/Helper.php": "<?php\nnamespace App\\Util;\nclass Helper { }\n",
  });
  const v = values(await analyze({ folder: dir }));
  expect(v.get("src/Box.php")?.imports_out).toBe(1);
  expect(v.get("src/Util/Helper.php")?.imports_in).toBe(1);
});

// ------------------------------------------------------------------------------------------ cohesion

it("php cohesion > methods that share a property, or call each other through $this, are one group", async () => {
  const { metrics } = await measure(`class Box {
    private $items = [];
    protected string $label = "x";
    public function __construct($label) { $this->label = $label; }
    public function count() { return count($this->items); }
    public function add($x) { $this->items[] = $x; return $this->count(); }
    public function title() { return $this->label; }
}`);
  // count and add share items (and add calls count); title only uses label
  expect(metrics.cohesion_groups).toBe(2);
});

it("php cohesion > unrelated functions are several groups; no function, or a test file, is unavailable", async () => {
  const split = await measure(
    "function read_config() { return 1; }\nfunction render_chart() { return 2; }\nfunction send_mail() { return 3; }\n",
  );
  expect(split.metrics.cohesion_groups).toBe(3);
  expect((await measure("$a = 1;\n")).metrics.cohesion_groups).toBeUndefined();
  expect((await measure("function a() {}\n", true)).metrics.cohesion_groups).toBeUndefined();
});

// ------------------------------------------------------------------------------------------ shortcuts

it("php shortcuts > finds lint and type-checker suppressions and the error-suppression operator", async () => {
  const { metrics } = await measure(`function f() {
    // phpcs:ignore
    @unlink($f);
    /** @phpstan-ignore-next-line */
    $x = 1; // @psalm-suppress MixedAssignment
}`);
  expect(only(metrics, "escape_")).toEqual({
    escape_lint_disable: 2,
    escape_type_ignore: 2,
    escape_hatches: 4,
  });
});

it("php shortcuts > finds skipped tests, and an empty catch block but not one that does something", async () => {
  const { metrics } = await measure(`class T extends TestCase {
    function a() { $this->markTestSkipped('later'); }
    function b() { $this->markTestIncomplete(); }
    function c() { try { f(); } catch (Exception $e) { } try { g(); } catch (Exception $e) { log($e); } }
}`);
  expect(metrics.escape_skipped_test).toBe(2);
  expect(metrics.escape_empty_catch).toBe(1);
});

// ------------------------------------------------------------------------------------------ security

const sec = async (body: string) => only((await measure(`function f($a) { ${body} }`)).metrics, "security_");
const decl = async (code: string) => only((await measure(code)).metrics, "security_");

const POSITIVES: Array<[kind: string, body: string]> = [
  ["dynamic_code", "eval($a);"],
  ["command_exec", "exec($a);"],
  ["command_exec", 'shell_exec("ls " . $a);'],
  ["command_exec", "$o = `ls $a`;"],
  ["unsafe_deserialization", "unserialize($a);"],
  ["unsafe_html", "echo $_GET['x'];"],
  ["hardcoded_secret", '$password = "hunter2hunter2";'],
  ["hardcoded_secret", "$conf = ['api_key' => 'abcdefgh12345678'];"],
  ["hardcoded_secret", `$k = "${"AKIA"}${"A".repeat(16)}";`],
  ["tls_disabled", "curl_setopt($c, CURLOPT_SSL_VERIFYPEER, false);"],
  ["tls_disabled", "$c = new Client(['verify' => false]);"],
  ["sql_concat", '$db->query("select * from t where id = " . $a);'],
  ["sql_concat", '$db->query("select * from t where id = $a");'],
  ["sql_concat", 'mysqli_query($c, "select " . $a);'],
];

it.each(POSITIVES)("php security > finds %s: %s", async (kind, body) => {
  const found = await sec(body);
  expect(found[`security_${kind}`], JSON.stringify(found)).toBe(1);
  expect(found.security_signals).toBe(1);
});

it("php security > finds a hard-coded secret in a property and a constant", async () => {
  expect((await decl('class A { private $password = "hunter2hunter2"; }')).security_hardcoded_secret).toBe(1);
  expect((await decl("class A { const API_KEY = 'abcdefgh12345678'; }")).security_hardcoded_secret).toBe(1);
});

const LOOK_ALIKES = [
  "evaluate($a);",
  "escapeshellarg($a);",
  "unserialize($a, ['allowed_classes' => false]);",
  "echo htmlspecialchars($_GET['x']);",
  "echo 'hello';",
  '$password = getenv("PASSWORD");',
  '$password = "";',
  '$token = "short";',
  '$token_url = "/oauth/token";',
  "curl_setopt($c, CURLOPT_SSL_VERIFYPEER, true);",
  "$c = new Client(['verify' => true]);",
  '$db->query("select * from t where id = ?");',
  'log("select " . $a);',
];

it.each(LOOK_ALIKES)("php security > leaves alone: %s", async (body) => {
  expect(await sec(body)).toEqual({});
});

it("php security > never keeps what a secret says, and does not rate test files", async () => {
  const code = '$password = "correct-horse-battery";\n';
  expect(JSON.stringify(await measure(code))).not.toContain("correct-horse");
  expect(Object.keys((await measure(code, true)).metrics).filter((k) => k.startsWith("security_"))).toEqual(
    [],
  );
});

it("php security > a private key block is found in single and double quoted strings; a property assigned through $this is a secret", async () => {
  expect((await sec("$k = 'BEGIN RSA PRIVATE KEY';")).security_hardcoded_secret).toBe(1);
  expect((await sec('$k = "BEGIN RSA PRIVATE KEY";')).security_hardcoded_secret).toBe(1);
  expect((await sec('$this->apiKey = "abcdefgh12345678";')).security_hardcoded_secret).toBe(1);
});
