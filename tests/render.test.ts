import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderTree, type RenderContext } from "../src/dom/render";
import { buildTabModel, type TabSummary } from "../src/model/index.js";

vi.mock("../src/browser/tabs.js", () => ({
  closeTabs: vi.fn(async () => {}),
  closeTab: vi.fn(async () => {}),
  activateTab: vi.fn(async () => {}),
}));

function setupDom(): void {
  document.body.innerHTML = `
    <section class="toolbar">
      <button id="refresh">Refresh</button>
      <span id="refreshHint" class="small" hidden>Refresh to re-sync order</span>
    </section>
    <div id="stats"></div>
    <div id="tree"></div>
    <template id="hostTemplate">
      <section class="hostCard">
        <header class="hostHeader" tabindex="0" role="button" aria-expanded="false">
          <span class="twisty" aria-hidden="true">▸</span>
          <img class="ico hostIco" alt="" referrerpolicy="no-referrer" />
          <span class="hostName"></span>
          <span class="badge"></span>
          <div class="spacer"></div>
          <button class="close reapButton" title="Close all in host">Reap</button>
        </header>
        <div class="hostBody"></div>
      </section>
    </template>
    <template id="clusterTemplate">
      <div class="cluster">
        <header class="clusterHeader" tabindex="0" role="button" aria-expanded="false">
          <span class="twisty" aria-hidden="true">▸</span>
          <img class="ico clusterIco" alt="" referrerpolicy="no-referrer" />
          <span class="clusterName"></span>
          <span class="badge small"></span>
          <div class="spacer"></div>
          <button class="close reapButton" title="Close cluster">Reap</button>
        </header>
        <div class="clusterBody"></div>
      </div>
    </template>
  <template id="tabTemplate">
    <div class="tab">
      <img class="ico" alt="" referrerpolicy="no-referrer" />
      <span class="clusterTag small" hidden></span>
      <a class="title" target="_self"></a>
      <span class="path small"></span>
      <button class="x" title="Close tab">✕</button>
    </div>
  </template>
`;
}

function baseTab(overrides: Partial<TabSummary> = {}): TabSummary {
  return {
    id: overrides.id ?? Math.floor(Math.random() * 100_000),
    url: overrides.url ?? "https://example.com/", 
    title: overrides.title ?? "Example",
    pinned: overrides.pinned ?? false,
    windowId: overrides.windowId ?? 1,
    favIconUrl: overrides.favIconUrl ?? "",
  };
}

async function click(element: Element): Promise<void> {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await Promise.resolve();
  await Promise.resolve();
}

describe("renderTree incremental updates", () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
  });

  it("removes a single tab while preserving expanded sections", async () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    let activeTabs: TabSummary[] = [
      baseTab({
        id: 1,
        url: "https://example.com/one/a",
        title: "AAA",
      }),
      baseTab({
        id: 2,
        url: "https://example.com/one/b",
        title: "BBB",
      }),
      baseTab({
        id: 3,
        url: "https://example.com/two/c",
        title: "CCC",
      }),
    ];

    renderTree(buildTabModel(activeTabs), context);

    const hostHeader = document.querySelector<HTMLElement>(".hostHeader");
    expect(hostHeader).toBeDefined();
    const hostBodyInitial = document.querySelector<HTMLElement>(".hostBody");
    if (hostBodyInitial?.hidden) {
      await click(hostHeader!);
    }

    const firstClusterHeader = document.querySelector<HTMLElement>(".clusterHeader");
    expect(firstClusterHeader).toBeDefined();
    await click(firstClusterHeader!);

    const closeButton = document.querySelector<HTMLButtonElement>(".clusterBody .tab .x");
    expect(closeButton).toBeDefined();
    await click(closeButton!);

    expect(context.onRefresh).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".tab")).toHaveLength(2);

    const hostBadge = document.querySelector<HTMLElement>(".hostHeader .badge");
    expect(hostBadge?.textContent).toBe("2");

    const firstClusterBadge = document.querySelector<HTMLElement>(".cluster .badge");
    expect(firstClusterBadge?.textContent).toBe("1");

    const stats = document.getElementById("stats");
    expect(stats?.textContent).toBe("2 tabs matched");

    const clusterBody = document.querySelector<HTMLElement>(".cluster .clusterBody");
    expect(clusterBody?.hidden).toBe(false);

    const hint = document.getElementById("refreshHint");
    expect(hint?.hidden).toBe(false);

    activeTabs = activeTabs.filter((tab) => tab.id !== 1);
    renderTree(buildTabModel(activeTabs), context);

    const refreshedHint = document.getElementById("refreshHint");
    expect(refreshedHint?.hidden).toBe(true);

    const refreshedHostBody = document.querySelector<HTMLElement>(".hostBody");
    expect(refreshedHostBody?.hidden).toBe(false);

    const refreshedClusterBody = document.querySelector<HTMLElement>(".cluster .clusterBody");
    expect(refreshedClusterBody?.hidden).toBe(false);
  });

  it("removes an entire cluster and keeps the host expanded", async () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 10, url: "https://example.com/one/a", title: "AAA" }),
        baseTab({ id: 11, url: "https://example.com/one/b", title: "BBB" }),
        baseTab({ id: 12, url: "https://example.com/two/c", title: "CCC" }),
      ]),
      context
    );

    const hostHeader = document.querySelector<HTMLElement>(".hostHeader");
    expect(hostHeader).toBeDefined();
    const hostBodyInitial = document.querySelector<HTMLElement>(".hostBody");
    if (hostBodyInitial?.hidden) {
      await click(hostHeader!);
    }

    const hostBodyBefore = document.querySelector<HTMLElement>(".hostBody");
    expect(hostBodyBefore?.hidden).toBe(false);

    const firstClusterClose = document.querySelector<HTMLButtonElement>(".cluster .close");
    expect(firstClusterClose).toBeDefined();
    await click(firstClusterClose!);

    expect(context.onRefresh).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".cluster")).toHaveLength(1);

    const hostBadge = document.querySelector<HTMLElement>(".hostHeader .badge");
    expect(hostBadge?.textContent).toBe("1");

    const stats = document.getElementById("stats");
    expect(stats?.textContent).toBe("1 tab matched");

    const hostBody = document.querySelector<HTMLElement>(".hostBody");
    expect(hostBody?.hidden).toBe(false);

    const hint = document.getElementById("refreshHint");
    expect(hint?.hidden).toBe(false);
  });

  it("inlines a single cluster so its tabs are visible without expansion", () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 31, url: "https://example.com/docs/api", title: "API" }),
        baseTab({ id: 32, url: "https://example.com/docs/reference", title: "Reference" }),
        baseTab({ id: 33, url: "https://example.com/docs/faq", title: "FAQ" }),
      ]),
      context
    );

    const hostBody = document.querySelector<HTMLElement>(".hostBody");
    expect(hostBody?.hidden).toBe(false);

    const cluster = document.querySelector<HTMLElement>(".cluster");
    expect(cluster).not.toBeNull();

    const clusterHeader = cluster!.querySelector<HTMLElement>(".clusterHeader");
    expect(clusterHeader).not.toBeNull();
    expect(clusterHeader!.classList.contains("clusterHeaderHidden")).toBe(true);

    const clusterBody = cluster!.querySelector<HTMLElement>(".clusterBody");
    expect(clusterBody).not.toBeNull();
    expect(clusterBody!.hidden).toBe(false);

    const twisty = clusterHeader!.querySelector<HTMLElement>(".twisty");
    expect(twisty?.hidden).toBe(true);

    const closeButton = clusterHeader!.querySelector<HTMLButtonElement>(".close");
    expect(closeButton?.hidden).toBe(true);

    const tabs = clusterBody!.querySelectorAll<HTMLElement>(".tab");
    expect(tabs.length).toBe(3);

    const clusterTags = [...document.querySelectorAll<HTMLElement>(".clusterTag")];
    expect(clusterTags).toHaveLength(3);
    for (const tag of clusterTags) {
      expect(tag.hidden).toBe(false);
      expect(tag.textContent).toBe("docs");
    }
  });

  it("keeps multi-tab hosts collapsed by default", () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 41, url: "https://collapsed.example/docs/api", title: "API" }),
        baseTab({ id: 42, url: "https://collapsed.example/docs/reference", title: "Reference" }),
        baseTab({ id: 43, url: "https://collapsed.example/docs/faq", title: "FAQ" }),
      ]),
      context
    );

    const hostBody = document.querySelector<HTMLElement>(".hostBody");
    expect(hostBody?.hidden).toBe(true);
  });

  it("removes a host and updates totals without refreshing", async () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 21, url: "https://example.com/one/a", title: "AAA" }),
        baseTab({ id: 22, url: "https://example.com/two/b", title: "BBB" }),
        baseTab({ id: 23, url: "https://example.org/root", title: "CCC" }),
      ]),
      context
    );

    const hostHeader = document.querySelector<HTMLElement>(".hostHeader");
    const hostBodyInitial = document.querySelector<HTMLElement>(".hostBody");
    if (hostHeader && hostBodyInitial?.hidden) {
      await click(hostHeader);
    }

    const hostCloseButton = document.querySelector<HTMLButtonElement>(".hostHeader .close");
    expect(hostCloseButton).toBeDefined();
    await click(hostCloseButton!);

    expect(context.onRefresh).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".hostCard")).toHaveLength(1);

    const remainingHostName = document.querySelector<HTMLElement>(".hostName");
    expect(remainingHostName?.textContent).toContain("example.org");

    const stats = document.getElementById("stats");
    expect(stats?.textContent).toBe("1 tab matched");

    const hint = document.getElementById("refreshHint");
    expect(hint?.hidden).toBe(false);
  });
});
