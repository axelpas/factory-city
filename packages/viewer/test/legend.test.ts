import { computeLayout } from "@factory-city/layout";
import { expect, it } from "vitest";
import { defaultMapping } from "../src/presets/index";
import { DEFAULT_THEME } from "../src/themes/index";
import { legendModel } from "../src/view/legend";
import { computePlacements } from "../src/view/placements";
import { makeModel, SAMPLE } from "./helpers";

const model = makeModel(SAMPLE);
const { mapping } = defaultMapping(model);
const layout = computeLayout(model.files.map((f) => ({ path: f.path, weight: f.values.rloc ?? 1 })));
const color = computePlacements(model, layout, mapping, DEFAULT_THEME).legend;

it("legend > has one line per channel, each with its metric and how to read it", () => {
  const legend = legendModel(model, mapping, color);
  expect(legend.lines.map((l) => l.channel)).toEqual(["Area", "Height", "Color"]);
  expect(legend.lines.map((l) => l.metricId)).toEqual([mapping.area, mapping.height, mapping.color]);
  expect(legend.lines[1]?.text).toBe("taller = more complex");
  expect(legend.color.kind).toBe("sequential");
});

it("legend > counts the files that have no value for the color metric, and only those", () => {
  expect(legendModel(model, mapping, color).unavailable).toBe(0);
  const metric = mapping.color as string;
  const holed = makeModel(
    SAMPLE.map((s, i) => {
      if (i > 1) return s;
      const { [metric]: _dropped, ...values } = s.values;
      return { ...s, values };
    }),
  );
  expect(legendModel(holed, mapping, color).unavailable).toBe(2);
  // without a color metric nothing is "unavailable"
  expect(legendModel(holed, { ...mapping, color: null }, color).unavailable).toBe(0);
});

it("legend > carries the extra note, such as what one block is worth", () => {
  expect(legendModel(model, mapping, color, "light", String, "One block = 3").note).toBe("One block = 3");
  expect(legendModel(model, mapping, color).note).toBeUndefined();
});
