import { describe, expect, it } from "vitest";

import { naturalCompare } from "../src/utils/naturalCompare";

describe("naturalCompare (audit F-15)", () => {
  it("orders numeric suffixes like a human would", () => {
    const titles = ["item 10", "item 1", "item 2", "item 0"];
    expect([...titles].sort(naturalCompare)).toEqual(["item 0", "item 1", "item 2", "item 10"]);
  });

  it("is case-insensitive", () => {
    expect(naturalCompare("AAA", "bbb")).toBeLessThan(0);
    expect(naturalCompare("bbb", "AAA")).toBeGreaterThan(0);
  });

  it("ignores accents when ordering (base sensitivity)", () => {
    expect(naturalCompare("eclair", "éclair")).toBe(0);
  });

  it("handles multi-digit runs inside longer strings", () => {
    const titles = ["page 100", "page 99", "page 9a", "page 9"];
    expect([...titles].sort(naturalCompare)).toEqual(["page 9", "page 9a", "page 99", "page 100"]);
  });
});
