import { describe, expect, it } from "vitest";

import {
  closableDuplicateIds,
  duplicateGroupSizes,
  findDuplicateGroups,
  pickDuplicateKeeper,
  type DuplicateCandidate,
} from "../src/model/duplicates";

function dup(
  id: number,
  url: string,
  overrides: Partial<DuplicateCandidate> = {}
): DuplicateCandidate {
  return {
    id,
    url,
    pinned: overrides.pinned ?? false,
    lastAccessed: overrides.lastAccessed ?? 1000,
    active: overrides.active ?? false,
  };
}

describe("findDuplicateGroups (review F8)", () => {
  it("groups by normalized URL so tracking-param variants collapse together", () => {
    const groups = findDuplicateGroups([
      dup(1, "https://news.example/story?utm_source=newsletter"),
      dup(2, "https://news.example/story"),
      dup(3, "https://news.example/story?ref=social"),
      dup(4, "https://news.example/other"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.tabs.map((tab) => tab.id)).toEqual([1, 2, 3]);
    expect(groups[0]!.key).toBe("https://news.example/story");
  });

  it("ignores trailing-slash and case differences in the path shape it normalizes", () => {
    const groups = findDuplicateGroups([
      dup(1, "https://docs.example/guide/"),
      dup(2, "https://docs.example/guide"),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("returns nothing when every URL is unique", () => {
    expect(findDuplicateGroups([dup(1, "https://a.example/x"), dup(2, "https://b.example/x")]))
      .toHaveLength(0);
  });
});

describe("pickDuplicateKeeper (review F8)", () => {
  it("prefers the active copy over more-recently-accessed ones", () => {
    const keeper = pickDuplicateKeeper([
      dup(1, "https://a.example/x", { active: true, lastAccessed: 1 }),
      dup(2, "https://a.example/x", { lastAccessed: 999 }),
    ]);
    expect(keeper.id).toBe(1);
  });

  it("falls back to the most recently accessed copy", () => {
    const keeper = pickDuplicateKeeper([
      dup(1, "https://a.example/x", { lastAccessed: 10 }),
      dup(2, "https://a.example/x", { lastAccessed: 50 }),
      dup(3, "https://a.example/x", { lastAccessed: 20 }),
    ]);
    expect(keeper.id).toBe(2);
  });
});

describe("closableDuplicateIds (review F8)", () => {
  it("closes every non-keeper copy", () => {
    const ids = closableDuplicateIds([
      dup(1, "https://a.example/x", { lastAccessed: 50 }),
      dup(2, "https://a.example/x", { lastAccessed: 10 }),
      dup(3, "https://a.example/x", { lastAccessed: 20 }),
    ]);
    expect(ids).toEqual([2, 3]);
  });

  it("never closes pinned duplicates, even non-keeper ones", () => {
    const ids = closableDuplicateIds([
      dup(1, "https://a.example/x", { lastAccessed: 50 }),
      dup(2, "https://a.example/x", { lastAccessed: 10, pinned: true }),
    ]);
    expect(ids).toEqual([]);
  });

  it("aggregates across multiple groups in one host", () => {
    const ids = closableDuplicateIds([
      dup(1, "https://a.example/x", { lastAccessed: 50 }),
      dup(2, "https://a.example/x", { lastAccessed: 10 }),
      dup(3, "https://a.example/y", { lastAccessed: 50 }),
      dup(4, "https://a.example/y", { lastAccessed: 10 }),
      dup(5, "https://a.example/z"),
    ]);
    expect(ids).toEqual([2, 4]);
  });
});

describe("duplicateGroupSizes (review F8 row badges)", () => {
  it("maps every duplicate member to its group size and omits uniques", () => {
    const sizes = duplicateGroupSizes([
      dup(1, "https://a.example/x"),
      dup(2, "https://a.example/x?utm_source=t"),
      dup(3, "https://a.example/x?ref=r"),
      dup(4, "https://a.example/unique"),
    ]);
    expect(sizes.get(1)).toBe(3);
    expect(sizes.get(2)).toBe(3);
    expect(sizes.get(3)).toBe(3);
    expect(sizes.has(4)).toBe(false);
  });
});
