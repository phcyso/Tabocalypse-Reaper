import { describe, expect, it } from "vitest";

import { dupChipState } from "../src/dom/render.js";

const base = {
  urlTotal: 4,
  bucketSize: 2,
  keeper: false,
  pinned: false,
  active: false,
  crossGroup: true,
  crossContainer: false,
};

describe("dupChipState (five-state pill grammar, design v2)", () => {
  it("unique URL: no chip", () => {
    const state = dupChipState({ ...base, urlTotal: 1, bucketSize: 0 });
    expect(state).toMatchObject({ kind: "none", show: false });
  });

  it("keeper of a bucket: accent '✓ kept'", () => {
    const state = dupChipState({ ...base, keeper: true });
    expect(state).toMatchObject({ kind: "keeper", show: true, text: "✓ kept", cls: "keeperDup" });
  });

  it("closable same-bucket copy: '×2/4' danger with explanatory title", () => {
    const state = dupChipState(base);
    expect(state).toMatchObject({
      kind: "closable", show: true, text: "×2/4", cls: "",
    });
    expect(state.title).toContain("2 of the 4 copies");
    expect(state.title).toContain("the newest copy stays");
  });

  it("bare '×N' when the bucket holds every copy (back-compat)", () => {
    const state = dupChipState({ ...base, urlTotal: 3, bucketSize: 3 });
    expect(state).toMatchObject({ kind: "closable", text: "×3" });
  });

  it("pinned non-keeper: muted '×N · pinned'", () => {
    const state = dupChipState({ ...base, pinned: true });
    expect(state).toMatchObject({ kind: "pinned", text: "×2 · pinned", cls: "protectedDup" });
  });

  it("active non-keeper: muted '×N' (an active tab is never closed)", () => {
    const state = dupChipState({ ...base, active: true });
    expect(state).toMatchObject({ kind: "active", cls: "protectedDup", text: "×2" });
    expect(state.title).toContain("Active tab stays");
  });

  it("singleton bucket: muted '4 elsewhere' with placement title", () => {
    const state = dupChipState({ ...base, bucketSize: 1 });
    expect(state).toMatchObject({ kind: "elsewhere", text: "4 elsewhere", cls: "crossGroupDup" });
    expect(state.title).toContain("different tab groups");
  });

  it("elsewhere title prefers the group wording, falls back to containers", () => {
    const groupOnly = dupChipState({ ...base, bucketSize: 1, crossGroup: true, crossContainer: false });
    const containerOnly = dupChipState({ ...base, bucketSize: 1, crossGroup: false, crossContainer: true });
    expect(groupOnly.title).toContain("tab groups");
    expect(containerOnly.title).toContain("containers");
  });
});
