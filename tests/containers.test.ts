import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildContainerModel, NO_CONTAINER_HOST_NAME } from "../src/model/buildContainerModel.js";
import { closableDuplicateIds, crossContainerDuplicateIds } from "../src/model/duplicates.js";
import { renderTree, resetCloseGuardForTests } from "../src/dom/render";
import { buildTabModel, type ContainerInfo, type TabSummary } from "../src/model/index.js";

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
    cookieStoreId: "firefox-default",
    ...overrides,
  };
}

const containers = new Map<string, ContainerInfo>([
  ["abc", { cookieStoreId: "abc", name: "Banking", color: "#ec7f2d" }],
]);

describe("buildContainerModel (containers view)", () => {
  it("groups tabs by container, default tabs under (no container)", () => {
    const model = buildContainerModel(
      [
        tab({ id: 1, url: "https://bank.test/1", title: "Bank", cookieStoreId: "abc" }),
        tab({ id: 2, url: "https://bank.test/2", title: "Bank 2", cookieStoreId: "abc" }),
        tab({ id: 3, url: "https://plain.test/3", title: "Plain" }),
      ],
      containers,
      {}
    );
    expect(model.children.size).toBe(2);
    expect(model.count).toBe(3);
    const banking = model.children.get("container:abc")!;
    expect(banking.name).toBe("Banking");
    expect(banking.count).toBe(2);
    expect(model.children.get("default")!.name).toBe(NO_CONTAINER_HOST_NAME);
  });

  it("keeps host-less schemes that a host cluster would drop", () => {
    const model = buildContainerModel(
      [tab({ id: 1, url: "about:config", cookieStoreId: "abc" })],
      containers,
      {}
    );
    expect(model.count).toBe(1);
  });

  it("applies pinned exclusion and filter", () => {
    const model = buildContainerModel(
      [
        tab({ id: 1, pinned: true, cookieStoreId: "abc" }),
        tab({ id: 2, title: "Bank statement", cookieStoreId: "abc" }),
        tab({ id: 3, title: "Unrelated" }),
      ],
      containers,
      { excludePinned: true, filter: "bank" }
    );
    expect(model.count).toBe(1);
  });
});

describe("container-aware duplicate policy", () => {
  const base = {
    url: "https://dup.test/page",
    pinned: false,
    lastAccessed: 100,
    active: false,
    groupId: null,
  };

  it("protects copies living in different containers", () => {
    const tabs = [
      { ...base, id: 1, cookieStoreId: "abc" },
      { ...base, id: 2, cookieStoreId: "firefox-default" },
    ];
    expect(closableDuplicateIds(tabs)).toEqual([]);
    expect(crossContainerDuplicateIds(tabs).sort()).toEqual([1, 2]);
  });

  it("closes same-container copies when the whole duplicate group shares one container", () => {
    const tabs = [
      { ...base, id: 1, cookieStoreId: "abc", lastAccessed: 300 },
      { ...base, id: 2, cookieStoreId: "abc" },
    ];
    expect(closableDuplicateIds(tabs)).toEqual([2]);
    expect(crossContainerDuplicateIds(tabs)).toEqual([]);
  });

  it("closes only the same-placement copies when placements are mixed", () => {
    const tabs = [
      { ...base, id: 1, cookieStoreId: "abc", lastAccessed: 300 },
      { ...base, id: 2, cookieStoreId: "abc" },
      { ...base, id: 3, cookieStoreId: "firefox-default" },
    ];
    // placement-bucketed (design v2): the two abc copies dedupe within their
    // bucket; the default-container copy is protected (cross-placement).
    expect(closableDuplicateIds(tabs)).toEqual([2]);
    expect(crossContainerDuplicateIds(tabs).sort()).toEqual([1, 2, 3]);
  });
});

describe("container chips render", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section class="toolbar"></section>
      <div id="stats"></div><div id="tree"></div>
      <template id="hostTemplate"><section class="hostCard"><header class="hostHeader" tabindex="0" role="button" aria-expanded="false"><span class="twisty">▸</span><img class="ico hostIco"/><span class="icoFallback hostIcoFallback" hidden></span><span class="hostName"></span><span class="badge"></span><span class="pinChip" hidden></span><span class="winChip" hidden></span><span class="groupChip" hidden></span><span class="containerChip" hidden></span><div class="spacer"></div><button class="close reapButton">Reap</button></header><div class="hostBody"></div></section></template>
      <template id="clusterTemplate"><div class="cluster"><header class="clusterHeader" tabindex="0" role="button" aria-expanded="false"><span class="twisty">▸</span><img class="ico clusterIco"/><span class="icoFallback clusterIcoFallback" hidden></span><span class="clusterName"></span><span class="badge small"></span><span class="pinChip" hidden></span><span class="dupChip" hidden></span><div class="spacer"></div><button class="close reapButton">Reap</button></header><div class="clusterBody"></div></div></template>
      <template id="tabTemplate"><div class="tab"><img class="ico"/><span class="icoFallback tabIcoFallback" hidden></span><a class="title" target="_self"></a><span class="path small"></span><span class="ageChip" hidden></span><span class="winChip" hidden></span><span class="dupChip" hidden></span><span class="groupChip" hidden></span><span class="containerChip" hidden></span><button class="x">✕</button></div></template>
      <template id="soloTemplate"><div class="soloRow"><img class="ico soloIco"/><span class="icoFallback soloIcoFallback" hidden></span><span class="soloHost small"></span><a class="title soloTitle" target="_self"></a><span class="path small"></span><span class="ageChip" hidden></span><span class="winChip" hidden></span><span class="groupChip" hidden></span><span class="containerChip" hidden></span><button class="x">✕</button></div></template>`;
    resetCloseGuardForTests();
  });

  it("labels solo rows with the container name and hex color", () => {
    const tabs = [
      tab({ id: 1, url: "https://bank.test/1", title: "Bank page", cookieStoreId: "abc" }),
    ];
    const root = buildTabModel(tabs, { excludePinned: true, filter: "" });
    renderTree(root, {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
      containerLabels: containers,
    });
    const chip = document.querySelector<HTMLElement>(".soloRow .containerChip")!;
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toBe("Banking");
    expect(chip.style.getPropertyValue("--container-color")).toBe("#ec7f2d");
  });

  it("hides the container chip for default-container tabs", () => {
    const tabs = [tab({ id: 1, url: "https://plain.test/1", title: "Plain" })];
    const root = buildTabModel(tabs, { excludePinned: true, filter: "" });
    renderTree(root, {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
      containerLabels: containers,
    });
    const chip = document.querySelector<HTMLElement>(".soloRow .containerChip")!;
    expect(chip.hidden).toBe(true);
  });
});
