import { computeLayout } from "@factory-city/layout";

import { defaultMapping } from "../src/presets/index";

import type { Theme } from "../src/themes/index";

import { parseHex } from "../src/view/color";

import { makeModel, SAMPLE } from "./helpers";

export const model = makeModel(SAMPLE, {
  categories: { language: ["typescript", "tsx"], is_test: ["no", "yes"] },
});

export const layout = computeLayout(model.files.map((f) => ({ path: f.path, weight: f.values.rloc ?? 1 })));

export const { mapping } = defaultMapping(model);

export const hex = (theme: Theme, key: string) => parseHex(theme.colors[key] as string);
