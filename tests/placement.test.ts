import { describe, expect, it } from "vitest";

import {
  closableDuplicateIds,
  crossContainerDuplicateIds,
  crossGroupDuplicateIds,
  duplicateBucketSizes,
  duplicateGroupSizes,
  findDuplicateBuckets,
} from "../src/model/duplicates.js";
import { placementKey, tabPlacement } from "../src/model/placement.js";
import type { DuplicateCandidate } from "../src/model/index.js";

function dup(overrides: Partial<DuplicateCandidate> = {}): DuplicateCandidate {
  return {
    id: Math.floor(Math.random() * 100_000),
    url: "https://dup.test/page",
    pinned: false,
    lastAccessed: 100,
    active: false,
    groupId: null,
    cookieStoreId: "firefox-default",
    ...overrides,
  };
}

describe("placement normalization (model/placement.ts)", () => {
  it("treats groupId -1, 0 and null as the same ungrouped placement", () => {
    const a = tabPlacement({ groupId: -1, cookieStoreId: "firefox-default" });
    const b = tabPlacement({ groupId: 0, cookieStoreId: "firefox-default" });
    const c = tabPlacement({ groupId: null, cookieStoreId: "firefox-default" });
    expect(placementKey(a)).toBe(placementKey(b));
    expect(placementKey(b)).toBe(placementKey(c));
  });

  it("defaults an absent cookieStoreId to firefox-default", () => {
    expect(placementKey(tabPlacement({ cookieStoreId: undefined }))).toBe(
      placementKey(tabPlacement({ cookieStoreId: "firefox-default" }))
    );
  });

  it("keeps real group ids distinct", () => {
    expect(placementKey(tabPlacement({ groupId: 5 }))).not.toBe(
      placementKey(tabPlacement({ groupId: 6 }))
    );
  });
});

describe("findDuplicateBuckets (placement bucketing)", () => {
  it("splits one URL group into buckets per (group, container)", () => {
    const tabs = [
      dup({ id: 1, cookieStoreId: "abc" }),
      dup({ id: 2, cookieStoreId: "abc" }),
      dup({ id: 3, cookieStoreId: "firefox-default" }),
      dup({ id: 4, groupId: 7, cookieStoreId: "firefox-default" }),
    ];
    // singleton placements are omitted (same filter as duplicateGroupSizes)
    const buckets = findDuplicateBuckets(tabs);
    expect(buckets.map((b) => b.tabs.length)).toEqual([2]);
    expect(buckets.every((b) => b.key === "https://dup.test/page")).toBe(true);
    expect(buckets[0].cookieStoreId).toBe("abc");
  });

  it("keeps placements apart when only the group differs", () => {
    const tabs = [
      dup({ id: 1, groupId: 5 }),
      dup({ id: 2, groupId: 6 }),
    ];
    expect(findDuplicateBuckets(tabs)).toEqual([]);
  });

  it("keeps placements apart when only the container differs", () => {
    const tabs = [
      dup({ id: 1, groupId: 5, cookieStoreId: "abc" }),
      dup({ id: 2, groupId: 6, cookieStoreId: "other" }),
    ];
    expect(findDuplicateBuckets(tabs)).toEqual([]);
  });

  it("omits singleton URLs", () => {
    expect(findDuplicateBuckets([dup({ id: 1 }), dup({ id: 2, url: "https://other.test/" })])).toEqual([]);
  });
});

describe("closableDuplicateIds (bucketed)", () => {
  it("closes the non-keeper copy inside a same-placement bucket even when siblings live elsewhere", () => {
    const tabs = [
      dup({ id: 1, cookieStoreId: "abc", lastAccessed: 300 }), // keeper (newest in bucket)
      dup({ id: 2, cookieStoreId: "abc", lastAccessed: 200 }), // closable
      dup({ id: 3, cookieStoreId: "firefox-default" }),
      dup({ id: 4, groupId: 7, cookieStoreId: "firefox-default" }),
    ];
    expect(closableDuplicateIds(tabs)).toEqual([2]);
  });

  it("never closes the only copy of a placement", () => {
    const tabs = [
      dup({ id: 1, cookieStoreId: "abc" }),
      dup({ id: 2, groupId: 7 }),
    ];
    expect(closableDuplicateIds(tabs)).toEqual([]);
  });

  it("never closes pinned non-keeper copies per bucket", () => {
    // the unpinned copy is newest (keeper); the pinned older copy survives
    const tabs = [
      dup({ id: 1, cookieStoreId: "abc", pinned: true, lastAccessed: 100 }),
      dup({ id: 2, cookieStoreId: "abc", lastAccessed: 300 }),
    ];
    expect(closableDuplicateIds(tabs)).toEqual([]);
  });

  it("never closes active non-keeper copies per bucket (adversarial B2)", () => {
    const tabs = [
      dup({ id: 1, cookieStoreId: "abc", active: true, lastAccessed: 300 }),
      dup({ id: 2, cookieStoreId: "abc", lastAccessed: 200 }),
    ];
    // the active copy is the keeper anyway (active preferred); a second
    // active copy in another window would also survive:
    const withSecondActive = [
      dup({ id: 1, cookieStoreId: "abc", active: true, lastAccessed: 300 }),
      dup({ id: 2, cookieStoreId: "abc", active: true, lastAccessed: 200 }),
    ];
    expect(closableDuplicateIds(tabs)).toEqual([2]);
    expect(closableDuplicateIds(withSecondActive)).toEqual([]);
  });

  it("aggregates closable ids across multiple buckets in first-seen order", () => {
    const tabs = [
      dup({ id: 1, url: "https://a.test/", cookieStoreId: "abc", lastAccessed: 300 }),
      dup({ id: 2, url: "https://a.test/", cookieStoreId: "abc", lastAccessed: 200 }),
      dup({ id: 3, url: "https://b.test/", cookieStoreId: "abc", lastAccessed: 300 }),
      dup({ id: 4, url: "https://b.test/", cookieStoreId: "abc", lastAccessed: 200 }),
    ];
    expect(closableDuplicateIds(tabs)).toEqual([2, 4]);
  });
});

describe("duplicateBucketSizes", () => {
  it("maps each tab to its same-placement copy count and omits singletons", () => {
    const tabs = [
      dup({ id: 1, cookieStoreId: "abc" }),
      dup({ id: 2, cookieStoreId: "abc" }),
      dup({ id: 3, groupId: 9 }),
    ];
    const sizes = duplicateBucketSizes(tabs);
    expect(sizes.get(1)).toBe(2);
    expect(sizes.get(2)).toBe(2);
    expect(sizes.has(3)).toBe(false);
  });

  it("matches duplicateGroupSizes when one placement holds every copy", () => {
    const tabs = [dup({ id: 1 }), dup({ id: 2 }), dup({ id: 3 })];
    expect(duplicateBucketSizes(tabs)).toEqual(duplicateGroupSizes(tabs));
  });
});
