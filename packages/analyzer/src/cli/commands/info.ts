import { METRICS } from "@factory-city/schema";
import type { Command } from "commander";
import { doctor } from "../../doctor.js";
import { LANGUAGES } from "../../languages/index.js";

/** Registers the commands of this module on the program. */
export function registerInfo(program: Command): void {
  program
    .command("metrics")
    .description("List the metrics, their definition and the data level they need")
    .option("--json", "print machine-readable output")
    .action((opts: { json?: boolean }) => {
      if (opts.json) {
        console.log(JSON.stringify(METRICS, null, 2));
        return;
      }
      for (const m of METRICS) console.log(`${m.id.padEnd(26)} level ${m.level}  ${m.definition}`);
    });

  program
    .command("languages")
    .description("List the supported languages")
    .option("--json", "print machine-readable output")
    .action((opts: { json?: boolean }) => {
      if (opts.json) {
        console.log(
          JSON.stringify(
            LANGUAGES.map(({ id, label, tier, extensions }) => ({ id, label, tier, extensions })),
            null,
            2,
          ),
        );
        return;
      }
      for (const l of LANGUAGES)
        console.log(`${l.label.padEnd(14)} tier ${l.tier}  ${l.extensions.join(" ")}`);
      console.log(
        `${"Other text".padEnd(14)} tier 3  any other text file, with --all: line and git metrics only`,
      );
    });
}

/** Registers `doctor`, the last command of the list. */
export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Print the data level reached and the one action that unlocks the next")
    .argument("[path]", "folder to check", ".")
    .option("--json", "print machine-readable output")
    .action(async (path: string, opts: { json?: boolean }) => {
      const report = await doctor(path);
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      console.log(`Data level ${report.level} (${report.levelName})`);
      for (const c of report.checks) console.log(`  ${c.ok ? "ok" : "--"}  ${c.name}: ${c.detail}`);
      console.log(`Next: ${report.next}`);
    });
}
