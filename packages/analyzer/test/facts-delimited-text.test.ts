import { describe, expect, it } from "vitest";
import { readTable, splitLine } from "../src/collectors/facts.js";

describe("delimited text", () => {
  it("splits lines with quotes and escaped quotes", () => {
    expect(splitLine('a;"b;c";"say ""hi""";d', ";")).toEqual(["a", "b;c", 'say "hi"', "d"]);
    expect(splitLine("a,,c", ",")).toEqual(["a", "", "c"]);
  });

  it("guesses the delimiter and the header", () => {
    expect(readTable("a;b\n1;2", { columns: { issue: 1 } })).toEqual({
      names: ["a", "b"],
      rows: [["1", "2"]],
    });
    expect(readTable("1;2\n3;4", { columns: { issue: 1 } }).rows).toHaveLength(2);
    expect(readTable("#1,x", { columns: { issue: 1 } }).names).toEqual([]);
  });
});
