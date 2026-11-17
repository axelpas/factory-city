import { expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { LANGUAGES } from "../src/languages/index.js";
import { computeMetrics } from "../src/metrics/file-metrics.js";
import { getParser } from "../src/parse.js";
import { resolvePython } from "../src/resolve/modules.js";
import { makeTree } from "./helpers.js";
import { values } from "./history-helpers.js";

const python = LANGUAGES.find((l) => l.id === "python") as (typeof LANGUAGES)[number];

async function measure(code: string, isTest = false) {
  return computeMetrics(await getParser(python.grammar), python, code, isTest);
}

const only = (m: Record<string, number>, prefix: string) =>
  Object.fromEntries(
    Object.entries(m).filter(([k, v]) => k.startsWith(prefix) && v > 0 && !k.endsWith("density")),
  );

// ------------------------------------------------------------------------------------------ coupling

it("python coupling > reads the modules of import and from-import statements, with the names as candidates", async () => {
  const { imports } = await measure(
    "import os, sys as system\nfrom . import sibling\nfrom .pkg.mod import thing, other as o\nfrom ..up import x\nimport a.b.c\n",
  );
  expect(imports).toEqual([
    "os",
    "sys",
    ".",
    ".sibling",
    ".pkg.mod",
    ".pkg.mod.thing",
    ".pkg.mod.other",
    "..up",
    "..up.x",
    "a.b.c",
  ]);
});

const FILES = new Set([
  "app/__init__.py",
  "app/main.py",
  "app/util.py",
  "app/models/__init__.py",
  "app/models/user.py",
  "other/util.py",
  "tests/test_main.py",
]);

it("python coupling > resolves relative imports from the folder of the importer", () => {
  expect(resolvePython(".util", "app/main.py", FILES)).toBe("app/util.py");
  expect(resolvePython(".models", "app/main.py", FILES)).toBe("app/models/__init__.py");
  expect(resolvePython(".models.user", "app/main.py", FILES)).toBe("app/models/user.py");
  expect(resolvePython("..util", "app/models/user.py", FILES)).toBe("app/util.py");
  expect(resolvePython(".", "app/main.py", FILES)).toBe("app/__init__.py");
  expect(resolvePython(".missing", "app/main.py", FILES)).toBeUndefined();
});

it("python coupling > resolves absolute imports by name among the project's files, the closest first", () => {
  expect(resolvePython("app.models.user", "tests/test_main.py", FILES)).toBe("app/models/user.py");
  expect(resolvePython("app", "tests/test_main.py", FILES)).toBe("app/__init__.py");
  // two files answer to `util`: the one next to the importer wins
  expect(resolvePython("util", "app/main.py", FILES)).toBe("app/util.py");
  expect(resolvePython("util", "other/run.py", FILES)).toBe("other/util.py");
});

it("python coupling > leaves the standard library and installed packages without a file", () => {
  for (const spec of ["os", "numpy.linalg", "typing"])
    expect(resolvePython(spec, "app/main.py", FILES), spec).toBeUndefined();
});

it("python coupling > links the files of a project and counts what each imports and what imports it", async () => {
  const dir = makeTree({
    "app/__init__.py": "",
    "app/main.py":
      "import os\nfrom app.util import helper\nfrom .models import user\n\ndef run():\n    return helper(user)\n",
    "app/util.py": "def helper(x):\n    return x\n",
    "app/models/__init__.py": "",
    "app/models/user.py": "from app import util\n\nNAME = 'x'\n",
  });
  const v = values(await analyze({ folder: dir }));
  expect(v.get("app/main.py")).toMatchObject({ imports_out: 3, imports_in: 0 });
  expect(v.get("app/util.py")).toMatchObject({ imports_in: 2 });
  expect(v.get("app/models/user.py")).toMatchObject({ imports_out: 2 });
});

// ------------------------------------------------------------------------------------------ cohesion

const COHESIVE = `
LIMIT = 10

def check(x):
    return x < LIMIT

def clamp(x):
    return min(x, LIMIT)
`;

const SPLIT = `
def read_config(path):
    return open(path).read()

def render_chart(data):
    return str(data)

def send_mail(to):
    return to
`;

it("python cohesion > functions that share a module constant form one group", async () => {
  const { metrics } = await measure(COHESIVE);
  expect(metrics).toMatchObject({ cohesion_groups: 1, lack_of_cohesion: 0 });
});

it("python cohesion > unrelated functions form several groups", async () => {
  const { metrics } = await measure(SPLIT);
  expect(metrics.cohesion_groups).toBe(3);
  expect(metrics.lack_of_cohesion).toBe(1);
});

it("python cohesion > methods that share a field set in __init__ are one group, decorators included", async () => {
  const { metrics } = await measure(`
class Box:
    def __init__(self):
        self.items = []
        self.label = "x"

    @property
    def count(self):
        return len(self.items)

    def add(self, x):
        self.items.append(x)

    def title(self):
        return self.label
`);
  // count and add share items; title only uses label
  expect(metrics.cohesion_groups).toBe(2);
});

it("python cohesion > a method that calls another through self joins it; a file with no function is unavailable", async () => {
  const { metrics } = await measure(`
class A:
    def one(self):
        return self.two()

    def two(self):
        return 2
`);
  expect(metrics.cohesion_groups).toBe(1);
  expect((await measure("X = 1\n")).metrics.cohesion_groups).toBeUndefined();
});

it("python cohesion > a test file is not rated, and a file that only imports is a barrel", async () => {
  expect((await measure(SPLIT, true)).metrics.cohesion_groups).toBeUndefined();
  expect((await measure("from .a import f\nfrom .b import g\n")).metrics.cohesion_groups).toBeUndefined();
});

// ------------------------------------------------------------------------------------------ shortcuts

it("python shortcuts > finds lint and type-checker suppressions", async () => {
  const { metrics } = await measure(
    "import os  # noqa\nx = 1  # type: ignore\ny = 2  # pylint: disable=invalid-name\nz = 3  # pyright: ignore\n",
  );
  expect(only(metrics, "escape_")).toEqual({
    escape_lint_disable: 2,
    escape_type_ignore: 2,
    escape_hatches: 4,
  });
});

it("python shortcuts > finds skipped tests, by decorator and by call", async () => {
  const { metrics } = await measure(
    "@pytest.mark.skip(reason='x')\ndef test_a():\n    pass\n\n@unittest.skipIf(True, 'y')\ndef test_b():\n    pass\n\ndef test_c():\n    pytest.skip('z')\n    self.skipTest('w')\n",
  );
  expect(metrics.escape_skipped_test).toBe(4);
});

it("python shortcuts > finds an empty except block, bare or not, and leaves one that does something", async () => {
  const { metrics } = await measure(
    "try:\n    a()\nexcept:\n    pass\ntry:\n    b()\nexcept ValueError:\n    pass\ntry:\n    c()\nexcept KeyError:\n    log(1)\ntry:\n    d()\nexcept OSError:\n    # we do not care\n    pass\n",
  );
  expect(metrics.escape_empty_catch).toBe(3);
});

it("python shortcuts > leaves look-alikes alone: text that only says noqa, a test that is not skipped", async () => {
  const { metrics } = await measure(
    'msg = "noqa and type: ignore are words"\n@pytest.mark.parametrize("a", [1])\ndef test_a(a):\n    assert a\n',
  );
  expect(only(metrics, "escape_")).toEqual({});
});

// ------------------------------------------------------------------------------------------ security

const sec = async (code: string) => only((await measure(code)).metrics, "security_");

const POSITIVES: Array<[kind: string, code: string]> = [
  ["dynamic_code", "eval(user)\n"],
  ["dynamic_code", "exec(code)\n"],
  ["command_exec", "os.system(cmd)\n"],
  ["command_exec", "subprocess.run(cmd, shell=True)\n"],
  ["unsafe_deserialization", "pickle.loads(blob)\n"],
  ["unsafe_deserialization", "yaml.load(stream)\n"],
  ["unsafe_deserialization", "yaml.load(stream, Loader=yaml.Loader)\n"],
  ["unsafe_deserialization", "yaml.unsafe_load(stream)\n"],
  ["unsafe_html", "mark_safe(text)\n"],
  ["unsafe_html", "Markup(text)\n"],
  ["hardcoded_secret", "password = 'correct-horse-battery'\n"],
  ["hardcoded_secret", 'API_KEY: str = "abcdefgh12345678"\n'],
  ["hardcoded_secret", `key = "${"AKIA"}${"A".repeat(16)}"\n`],
  ["tls_disabled", "requests.get(url, verify=False)\n"],
  ["tls_disabled", "ctx = ssl._create_unverified_context()\n"],
  ["tls_disabled", "ctx.verify_mode = ssl.CERT_NONE\n"],
  ["sql_concat", 'cursor.execute(f"select * from t where id = {i}")\n'],
  ["sql_concat", 'cursor.execute("select * from t where id = " + i)\n'],
  ["sql_concat", 'cursor.execute("select * from t where id = %s" % i)\n'],
  ["sql_concat", 'cursor.execute("select * from t where id = {}".format(i))\n'],
];

it.each(POSITIVES)("python security > finds %s: %s", async (kind, code) => {
  const found = await sec(code);
  expect(found[`security_${kind}`], JSON.stringify(found)).toBe(1);
  expect(found.security_signals).toBe(1);
});

const LOOK_ALIKES = [
  "evaluate(user)\n",
  "ast.literal_eval(text)\n",
  "subprocess.run([cmd, arg])\n",
  "subprocess.run(cmd, shell=False)\n",
  "yaml.load(stream, Loader=yaml.SafeLoader)\n",
  "yaml.safe_load(stream)\n",
  "json.loads(blob)\n",
  "escape(text)\n",
  "password = os.environ['PASSWORD']\n",
  "password = ''\n",
  "token = 'short'\n",
  "requests.get(url, verify=True)\n",
  "cursor.execute('select * from t where id = %s', (i,))\n",
  "cursor.execute('select 1')\n",
  'log(f"select {x}")\n',
];

it.each(LOOK_ALIKES)("python security > leaves alone: %s", async (code) => {
  expect(await sec(code)).toEqual({});
});

it("python security > never keeps what a secret says, and does not rate test files", async () => {
  const code = "password = 'correct-horse-battery'\n";
  const result = await measure(code);
  expect(JSON.stringify(result)).not.toContain("correct-horse");
  expect(Object.keys((await measure(code, true)).metrics).filter((k) => k.startsWith("security_"))).toEqual(
    [],
  );
});

it("python security > counts a chained or nested call once", async () => {
  expect((await sec('rows = cursor.execute(f"select {a}").fetchall()\n')).security_sql_concat).toBe(1);
  expect((await sec("data = yaml.load(stream).get('k')\n")).security_unsafe_deserialization).toBe(1);
});

it("python security > yaml.load is safe with a safe loader however the call is written", async () => {
  for (const code of [
    "yaml.load(f(x), Loader=yaml.SafeLoader)\n",
    "yaml.load(x, yaml.SafeLoader)\n",
    "yaml.load(read(path), Loader=yaml.CSafeLoader)\n",
  ])
    expect(await sec(code), code).toEqual({});
  expect((await sec("yaml.load(f(x))\n")).security_unsafe_deserialization).toBe(1);
  expect((await sec("yaml.load(f(x), Loader=yaml.FullLoader)\n")).security_unsafe_deserialization).toBe(1);
});

it("python security > a field named like a secret that holds a path or a field name is not one", async () => {
  for (const code of [
    'TOKEN_URL = "/oauth/token"\n',
    'PASSWORD_FIELD = "password_confirmation"\n',
    'api_key_header = "https://x.io/k"\n',
  ])
    expect(await sec(code), code).toEqual({});
});
