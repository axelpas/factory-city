import { computeLayout } from "@factory-city/layout";

import { createFormat } from "../src/lib/format";

import { type FileSpec, makeModel } from "./helpers";

export const fmt = createFormat(["en-US"]);

export const FILES: FileSpec[] = [
  {
    path: "core/a.ts",
    values: {
      rloc: 200,
      mcc: 40,
      imports_out: 6,
      imports_in: 1,
      cohesion_groups: 4,
      lack_of_cohesion: 1,
      escape_hatches: 6,
      escape_hatch_density: 30,
    },
  },
  {
    path: "core/b.ts",
    values: {
      rloc: 100,
      mcc: 10,
      imports_out: 2,
      imports_in: 3,
      cohesion_groups: 1,
      lack_of_cohesion: 0,
      escape_hatches: 0,
      escape_hatch_density: 0,
    },
  },
  {
    path: "core/c.ts",
    values: {
      rloc: 50,
      mcc: 6,
      imports_out: 1,
      imports_in: 2,
      cohesion_groups: 2,
      lack_of_cohesion: 0.5,
      escape_hatches: 1,
      escape_hatch_density: 20,
    },
  },
  {
    path: "ui/x.ts",
    values: {
      rloc: 80,
      mcc: 9,
      imports_out: 3,
      imports_in: 0,
      cohesion_groups: 1,
      lack_of_cohesion: 0,
      escape_hatches: 0,
      escape_hatch_density: 0,
    },
  },
];

export const model = makeModel(FILES, undefined, {
  core: { folder_cohesion: 0.8 },
  ui: { folder_cohesion: 0.2 },
});

export const layout = computeLayout(model.files.map((f) => ({ path: f.path, weight: f.values.rloc ?? 1 })));
