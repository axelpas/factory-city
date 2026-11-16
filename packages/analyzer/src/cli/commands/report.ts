import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Factory, Report } from "@factory-city/schema";
import type { Command } from "commander";
import { factoryMarkdown } from "../../factory/markdown.js";
import { reportMarkdown } from "../../health/markdown.js";
import { analyzeAndWrite } from "../shared.js";

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
    .action(
      async (
        path: string,
        opts: { format: string; top: string; json?: boolean; period: string; by?: string },
      ) => {
        const dir = resolve(path);
        const format = opts.json ? "json" : opts.format;
        if (format !== "md" && format !== "json")
          throw new Error(`Unknown --format "${format}". Use md or json.`);
        const top = Number(opts.top);
        if (!Number.isInteger(top) || top < 1) throw new Error("--top must be a whole number of at least 1.");
        // a data folder holds a report already; any other folder is analyzed first
        if (opts.period !== "30d" && opts.period !== "all") {
          throw new Error(`Unknown --period "${opts.period}". Use 30d or all.`);
        }
        const stored = ["report.issue.json", "report.commit.json", "report.day.json", "report.json"]
          .map((f) => join(dir, f))
          .find(
            (f) => existsSync(f) && !existsSync(join(dir, "package.json")) && !existsSync(join(dir, ".git")),
          );
        const report: Report = stored
          ? (JSON.parse(await readFile(stored, "utf8")) as Report)
          : (await analyzeAndWrite(path, {}, true)).result.report;
        // the factory KPIs come with a per-issue timeline
        const factoryPath = join(dir, "factory.json");
        const factory =
          stored && existsSync(factoryPath)
            ? (JSON.parse(await readFile(factoryPath, "utf8")) as Factory)
            : undefined;
        if (format === "json") {
          const body = {
            ...report,
            hotspots: report.hotspots.slice(0, top),
            ...(factory ? { factory } : {}),
          };
          console.log(JSON.stringify(body, null, 2));
          return;
        }
        process.stdout.write(reportMarkdown(report, top));
        if (factory) {
          const period = opts.period === "all" ? "all" : "last30";
          process.stdout.write(`\n${factoryMarkdown(factory, { period, by: opts.by })}`);
        } else if (opts.by) {
          console.error(
            "Factory KPIs need a per-issue timeline: run `factory-city timeline --by issue`, then `factory-city report <data folder>`.",
          );
        }
      },
    );
}
