#!/usr/bin/env node
import { Command } from "commander";
import { ANALYZER_VERSION } from "../analyze.js";
import { registerDoctor, registerInfo } from "./commands/info.js";
import { registerOpen } from "./commands/open.js";
import { registerRender } from "./commands/render.js";
import { registerReport } from "./commands/report.js";
import { registerTimeline } from "./commands/timeline.js";

const program = new Command();
program.name("factory-city").description("Turn a codebase into a 3D city.").version(ANALYZER_VERSION);
registerOpen(program);
registerInfo(program);
registerTimeline(program);
registerReport(program);
registerRender(program);
registerDoctor(program);

program.parseAsync().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
