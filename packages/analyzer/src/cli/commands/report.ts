import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Factory, Report } from "@factory-city/schema";
import type { Command } from "commander";
import { factoryMarkdown } from "../../factory/markdown.js";
import { reportMarkdown } from "../../health/markdown.js";
import { analyzeAndWrite } from "../shared.js";

interface ReportOptions {
  format: string;
  top: string;
  json?: boolean;
  period: string;
  by?: string;
}

/** The options as checked values; a wrong one is an error that says what to use instead. */
function checked(opts: ReportOptions): { format: "md" | "json"; top: number } {
  const format = opts.json ? "json" : opts.format;
  if (format !== "md" && format !== "json") throw new Error(`Unknown --format "${format}". Use md or json.`);
  const top = Number(opts.top);
  if (!Number.isInteger(top) || top < 1) throw new Error("--top must be a whole number of at least 1.");
  if (opts.period !== "30d" && opts.period !== "all")
    throw new Error(`Unknown --period "${opts.period}". Use 30d or all.`);
  return { format, top };
}

/** The report already written in a data folder, when the folder is one (and not a project to analyze). */
function storedReport(dir: string): string | undefined {
  return ["report.issue.json", "report.commit.json", "report.day.json", "report.json"]
    .map((f) => join(dir, f))
    .find((f) => existsSync(f) && !existsSync(join(dir, "package.json")) && !existsSync(join(dir, ".git")));
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function printMarkdown(report: Report, factory: Factory | undefined, top: number, opts: ReportOptions): void {
  process.stdout.write(reportMarkdown(report, top));
  if (factory) {
    const period = opts.period === "all" ? "all" : "last30";
    process.stdout.write(`\n${factoryMarkdown(factory, { period, by: opts.by })}`);
  } else if (opts.by) {
    console.error(
      "Factory KPIs need a per-issue timeline: run `factory-city timeline --by issue`, then `factory-city report <data folder>`.",
    );
  }
}

async function run(path: string, opts: ReportOptions): Promise<void> {
  const dir = resolve(path);
  const { format, top } = checked(opts);
  // a data folder holds a report already; any other folder is analyzed first
  const stored = storedReport(dir);
  const report = stored
    ? await readJson<Report>(stored)
    : (await analyzeAndWrite(path, {}, true)).result.report;
  // the factory KPIs come with a per-issue timeline
  const factoryPath = join(dir, "factory.json");
  const factory = stored && existsSync(factoryPath) ? await readJson<Factory>(factoryPath) : undefined;
  if (format === "json") {
    const body = { ...report, hotspots: report.hotspots.slice(0, top), ...(factory ? { factory } : {}) };
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  printMarkdown(report, factory, top, opts);
}

/** Registers the commands of this module on the program. */
export function registerReport(program: Command): void {
  program
    .command("report")
    .description("Print the code-health report: score, risk profile and prioritized hotspots")
    .argument("[path]", "folder to analyze, or a data folder written by analyze or timeline", ".")
    .option("--format <format>", "md or json", "md")
    .option("--top <n>", "number of hotspots", "5")
    .option("--json", "same as --format json")
    .option("--period <period>", "period of the factory KPIs: 30d or all", "30d")
    .option("--by <group>", "group the factory KPIs by agent, model, kind or estimate")
    .action(run);
}
