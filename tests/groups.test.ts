import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildGroupModel, UNGROUPED_HOST_NAME } from "../src/model/buildGroupModel.js";
import {
  closableDuplicateIds,
  crossGroupDuplicateIds,
  duplicateGroupSizes,
} from "../src/model/duplicates.js";
import { buildTabModel } from "../src/model/buildModel.js";
import { renderTree, resetCloseGuardForTests } from "../src/dom/render";
import { buildTabModel, type GroupInfo, type TabSummary } from "../src/model/index.js";

type AnyRecord = Record<string, unknown>;

function tab(overrides: Partial<TabSummary> = {}): TabSummary {
  return {
    id: Math.floor(Math.random() * 100_000),
    url: "https://example.com/page",
    title: "Example",
    pinned: false,
    windowId: 1,
    favIconUrl: "",
    groupId: null,
    ...overrides,
  };
}

describe("buildGroupModel (tab groups view)", () => {
  const groups = new Map<number, GroupInfo>([
    [11, { id: 11, name: "Research", color: "blue" }],
    [22, { id: 22, name: "", color: "red" }],
  ]);

  it("groups tabs by groupId, named and unnamed", () => {
    const model = buildGroupModel(
      [
        tab({ id: 1, title: "Paper", url: "https://a.test/1", groupId: 11 }),
        tab({ id: 2, title: "Notes", url: "https://b.test/2", groupId: 11 }),
        tab({ id: 3, title: "Shop", url: "https://c.test/3", groupId: 22 }),
      ],
      groups,
      {}
    );
    expect(model.children.size).toBe(2);
    expect(model.count).toBe(3);
    const research = model.children.get("group:11")!;
    expect(research.name).toBe("Research");
    expect(research.count).toBe(2);
    const unnamed = model.children.get("group:22")!;
    expect(unnamed.name).toBe("Group 22"); // empty name falls back to a label
  });

  it("collects ungrouped tabs under the (no group) pseudo-host", () => {
    const model = buildGroupModel(
      [tab({ id: 1, url: "https://a.test/1", groupId: null })],
      groups,
      {}
    );
    const ungrouped = model.children.get("ungrouped")!;
    expect(ungrouped.name).toBe(UNGROUPED_HOST_NAME);
    expect(ungrouped.count).toBe(1);
  });

  it("keeps about:/file: pages that a host cluster would drop", () => {
    const model = buildGroupModel(
      [tab({ id: 1, url: "about:config", groupId: 11 })],
      groups,
      {}
    );
    expect(model.count).toBe(1);
  });

  it("applies pinned exclusion and filter", () => {
    const model = buildGroupModel(
      [
        tab({ id: 1, pinned: true, groupId: 11 }),
        tab({ id: 2, title: "Shopping list", groupId: 11 }),
        tab({ id: 3, title: "Unrelated", groupId: 22 }),
      ],
      groups,
      { excludePinned: true, filter: "shopping" }
    );
    expect(model.count).toBe(1);
  });
});

describe("group-aware duplicate policy", () => {
  const base = {
    url: "https://dup.test/page",
    pinned: false,
    lastAccessed: 100,
    active: false,
  };

  it("auto-suggests closing same-group duplicates only", () => {
    const tabs = [
      { ...base, id: 1, groupId: 5, lastAccessed: 300 }, // keeper
      { ...base, id: 2, groupId: 5 },
    ];
    expect(closableDuplicateIds(tabs)).toEqual([2]);
  });

  it("protects copies living in different groups", () => {
    const tabs = [
      { ...base, id: 1, groupId: 5 },
      { ...base, id: 2, groupId: 6 },
    ];
    expect(closableDuplicateIds(tabs)).toEqual([]);
    expect(crossGroupDuplicateIds(tabs).sort()).toEqual([1, 2]);
    expect(duplicateGroupSizes(tabs).get(1)).toBe(2); // informational chip stays
  });

  it("protects group-vs-ungrouped mixes", () => {
    const tabs = [
      { ...base, id: 1, groupId: 5 },
      { ...base, id: 2, groupId: null },
    ];
    expect(closableDuplicateIds(tabs)).toEqual([]);
    expect(crossGroupDuplicateIds(tabs).length).toBe(2);
  });

  it("keeps legacy behavior for ungrouped copies", () => {
    const tabs = [
      { ...base, id: 1, groupId: null, lastAccessed: 300 },
      { ...base, id: 2, groupId: null },
      { ...base, id: 3, groupId: null },
    ];
    expect(closableDuplicateIds(tabs).length).toBe(2);
    expect(crossGroupDuplicateIds(tabs)).toEqual([]);
  });
});

describe("queryOpenTabs window scoping", () => {
  let queryArg: unknown = undefined;

  beforeEach(() => {
    queryArg = undefined;
    (globalThis as AnyRecord).browser = {
      tabs: {
        query: vi.fn(async (arg: unknown) => {
          queryArg = arg;
          return [
            {
              id: 9,
              url: "https://scoped.test/x",
              title: "Scoped",
              pinned: false,
              windowId: 3,
              groupId: 4,
            },
          ];
        }),
      },
    };
  });

  afterEach(() => {
    delete (globalThis as AnyRecord).browser;
  });

  it("queries one window when a windowId is given and carries groupId", async () => {
    const { queryOpenTabs } = await import("../src/browser/tabs.js");
    const tabs = await queryOpenTabs({ windowId: 3 });
    expect(queryArg).toEqual({ windowId: 3 });
    expect(tabs[0].groupId).toBe(4);
  });

  it("queries all windows when unscoped", async () => {
    const { queryOpenTabs } = await import("../src/browser/tabs.js");
    await queryOpenTabs();
    expect(queryArg).toEqual({});
  });
});

describe("group chips render", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section class="toolbar"></section>
      <div id="stats"></div><div id="tree"></div>
      <template id="hostTemplate"><section class="hostCard"><header class="hostHeader" tabindex="0" role="button" aria-expanded="false"><span class="twisty">▸</span><img class="ico hostIco"/><span class="icoFallback hostIcoFallback" hidden></span><span class="hostName"></span><span class="badge"></span><span class="pinChip" hidden></span><span class="winChip" hidden></span><span class="groupChip" hidden></span><div class="spacer"></div><button class="close reapButton">Reap</button></header><div class="hostBody"></div></section></template>
      <template id="clusterTemplate"><div class="cluster"><header class="clusterHeader" tabindex="0" role="button" aria-expanded="false"><span class="twisty">▸</span><img class="ico clusterIco"/><span class="icoFallback clusterIcoFallback" hidden></span><span class="clusterName"></span><span class="badge small"></span><span class="pinChip" hidden></span><span class="dupChip" hidden></span><div class="spacer"></div><button class="close reapButton">Reap</button></header><div class="clusterBody"></div></div></template>
      <template id="tabTemplate"><div class="tab"><img class="ico"/><span class="icoFallback tabIcoFallback" hidden></span><a class="title" target="_self"></a><span class="path small"></span><span class="ageChip" hidden></span><span class="winChip" hidden></span><span class="dupChip" hidden></span><span class="groupChip" hidden></span><button class="x">✕</button></div></template>
      <template id="soloTemplate"><div class="soloRow"><img class="ico soloIco"/><span class="icoFallback soloIcoFallback" hidden></span><span class="soloHost small"></span><a class="title soloTitle" target="_self"></a><span class="path small"></span><span class="ageChip" hidden></span><span class="winChip" hidden></span><span class="groupChip" hidden></span><button class="x">✕</button></div></template>`;
    resetCloseGuardForTests();
  });

  it("labels rows with the tab group name and color", () => {
    const tabs = [tab({ id: 1, url: "https://a.test/1", title: "Solo page", groupId: 11 })];
    const root = buildTabModel(tabs, { excludePinned: true, filter: "" });
    renderTree(root, {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
      groupLabels: new Map([[11, { id: 11, name: "Research", color: "blue" }]]),
    });
    const chip = document.querySelector<HTMLElement>(".soloRow .groupChip")!;
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toBe("Research");
    expect(chip.style.getPropertyValue("--group-color")).toBe("#31a5e7");
  });

  it("hides the group chip when no labels are provided", () => {
    const tabs = [tab({ id: 1, url: "https://a.test/1", title: "Solo page", groupId: 11 })];
    const root = buildTabModel(tabs, { excludePinned: true, filter: "" });
    renderTree(root, { sortMode: "count", onRefresh: vi.fn(async () => {}) });
    const chip = document.querySelector<HTMLElement>(".soloRow .groupChip")!;
    expect(chip.hidden).toBe(true);
  });
});
