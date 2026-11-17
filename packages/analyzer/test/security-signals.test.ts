import { expect, it } from "vitest";
import { LANGUAGES } from "../src/languages/index.js";
import { computeMetrics } from "../src/metrics/file-metrics.js";
import { getParser } from "../src/parse.js";

async function signals(code: string, id = "typescript", isTest = false) {
  const language = LANGUAGES.find((l) => l.id === id);
  if (!language) throw new Error(`No language ${id}`);
  const parsed = computeMetrics(await getParser(language.grammar), language, code, isTest);
  return parsed;
}

const kinds = (m: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(m).filter(
      ([k, v]) => k.startsWith("security_") && v > 0 && k !== "security_signal_density",
    ),
  );

/** A template interpolation, written out so that the samples below are plain strings. */
const I = (name: string) => `$\x7b${name}}`;

// literals that look like secrets are built here, so that no secret-looking text sits in the source
const FAKE_TOKEN = `${"gh"}p_${"a1B2".repeat(9)}`;
const FAKE_KEY_BLOCK = `-----BEGIN ${"RSA"} PRIVATE KEY-----`;

const POSITIVE: Array<[kind: string, code: string]> = [
  ["dynamic_code", "const x = eval(input);"],
  ["dynamic_code", "const f = new Function('a', 'return a');"],
  ["command_exec", `import { exec } from 'node:child_process';\nexec(\`ls ${I("dir")}\`);`],
  ["command_exec", "spawn('ls', [dir], { shell: true });"],
  ["unsafe_html", "el.innerHTML = html;"],
  ["unsafe_html", "const v = <div dangerouslySetInnerHTML={{ __html: html }} />;"],
  ["unsafe_html", "document.write(html);"],
  ["hardcoded_secret", "const password = 'correct-horse-battery';"],
  ["hardcoded_secret", "const config = { apiKey: 'abcdef123456' };"],
  ["hardcoded_secret", `const t = "${FAKE_TOKEN}";`],
  ["hardcoded_secret", `const k = \`${FAKE_KEY_BLOCK}\`;`],
  ["tls_disabled", "https.request({ rejectUnauthorized: false });"],
  ["tls_disabled", "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';"],
  ["sql_concat", `db.query(\`SELECT * FROM users WHERE id = ${I("id")}\`);`],
  ["sql_concat", "db.query('SELECT * FROM users WHERE id = ' + id);"],
];

it.each(POSITIVE)("security signals > finds %s in: %s", async (kind, code) => {
  const { metrics } = await signals(code, code.includes("<div") ? "tsx" : "typescript");
  expect(metrics[`security_${kind}`]).toBe(1);
  expect(metrics.security_signals).toBe(1);
});

const HARMLESS = [
  "const m = /a+/.exec(text);",
  "const password = process.env.PASSWORD;",
  "const password = 'short';",
  `const token = \`${I("prefix")}-${I("suffix")}\`;`,
  "el.textContent = text;",
  "db.query('SELECT 1');",
  "db.query(sql, [id]);",
  "spawn('ls', [dir]);",
  "https.request({ rejectUnauthorized: true });",
  "const evaluate = (x: number) => x + 1;",
];

it.each(HARMLESS)("security signals > leaves a harmless look-alike alone: %s", async (code) => {
  const { metrics } = await signals(code);
  expect(metrics.security_signals).toBe(0);
});

it("security signals > counts several kinds in one file and gives the density per 1,000 lines", async () => {
  const code = ["eval(a);", "eval(b);", "el.innerHTML = c;", ...Array(7).fill("const n = 1;")].join("\n");
  const { metrics } = await signals(code);
  expect(kinds(metrics)).toEqual({ security_dynamic_code: 2, security_unsafe_html: 1, security_signals: 3 });
  expect(metrics.security_signal_density).toBeCloseTo((3 / 10) * 1000);
});

it("security signals > does not rate test files: the metrics are absent, never zero", async () => {
  const { metrics } = await signals("eval(input);", "typescript", true);
  expect(Object.keys(metrics).filter((k) => k.startsWith("security_"))).toEqual([]);
});

it("security signals > are unavailable for a language without rules", async () => {
  const python = LANGUAGES.find((l) => l.id === "python") as (typeof LANGUAGES)[number];
  const bare = { ...python, security: [] };
  const { metrics } = computeMetrics(await getParser(bare.grammar), bare, "def f():\n    return eval('1')\n");
  expect(Object.keys(metrics).filter((k) => k.startsWith("security_"))).toEqual([]);
});

it("security signals > never keep what a secret says", async () => {
  const result = await signals(`const password = 'correct-horse-battery';\nconst t = "${FAKE_TOKEN}";`);
  const everything = JSON.stringify(result);
  expect(everything).not.toContain("correct-horse");
  expect(everything).not.toContain(FAKE_TOKEN);
  expect(result.metrics.security_hardcoded_secret).toBe(2);
});
