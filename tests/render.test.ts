import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderTree, resetCloseGuardForTests, type RenderContext } from "../src/dom/render";
import { closeTabs, reopenTab } from "../src/browser/tabs.js";
import { buildTabModel, type TabSummary } from "../src/model/index.js";
import { AUTO_COLLAPSE_HOST_COUNT, STALE_MS } from "../src/shared/constants.js";

vi.mock("../src/browser/tabs.js", () => ({
  closeTabs: vi.fn(async () => {}),
  closeTab: vi.fn(async () => {}),
  activateTab: vi.fn(async () => {}),
  reopenTab: vi.fn(async () => {}),
}));

const mocks = vi.hoisted(() => {
  const sweepStore: { current: unknown } = { current: null };
  return { sweepStore };
});

vi.mock("../src/browser/storage.js", () => ({
  loadUiPrefs: vi.fn(async () => ({})),
  saveUiPrefs: vi.fn(async () => {}),
  saveLastSweep: vi.fn(async (sweep: unknown) => {
    mocks.sweepStore.current = sweep;
  }),
  loadLastSweep: vi.fn(async () => mocks.sweepStore.current),
  clearLastSweep: vi.fn(async () => {
    mocks.sweepStore.current = null;
  }),
}));

function setupDom(): void {
  document.body.innerHTML = `
    <section class="toolbar">
      <button id="refresh">Refresh</button>
      <button id="refreshHint" class="refreshHint" hidden>Sort outdated — Refresh</button>
    </section>
    <div id="stats"></div>
    <div id="tree"></div>
    <div id="toast" class="toast" hidden>
      <span id="toastText"></span>
      <button id="toastAction" class="toastAction">Undo</button>
    </div>
    <template id="hostTemplate">
      <section class="hostCard">
        <header class="hostHeader" tabindex="0" role="button" aria-expanded="false">
          <span class="twisty" aria-hidden="true">▸</span>
          <img class="ico hostIco" alt="" referrerpolicy="no-referrer" />
          <span class="icoFallback hostIcoFallback" aria-hidden="true" hidden></span>
          <span class="hostName"></span>
          <span class="badge"></span>
          <span class="pinChip" hidden></span>
          <span class="winChip" hidden></span>
          <div class="spacer"></div>
          <button class="staleButton" title="Close tabs older than 24h" hidden>Reap stale</button>
          <button class="dupButton" title="Close duplicate tabs — keeps the newest copy" hidden>Close dups</button>
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
          <span class="icoFallback clusterIcoFallback" aria-hidden="true" hidden></span>
          <span class="clusterName"></span>
          <span class="badge small"></span>
          <span class="pinChip" hidden></span>
          <span class="dupChip" hidden></span>
          <div class="spacer"></div>
          <button class="close reapButton" title="Close cluster">Reap</button>
        </header>
        <div class="clusterBody"></div>
      </div>
    </template>
  <template id="tabTemplate">
    <div class="tab">
      <img class="ico" alt="" referrerpolicy="no-referrer" />
      <span class="icoFallback tabIcoFallback" aria-hidden="true" hidden></span>
      <a class="title" target="_self"></a>
      <span class="path small"></span>
      <span class="ageChip" hidden></span>
      <span class="winChip" hidden></span>
      <span class="dupChip" hidden></span>
      <button class="x" title="Close tab">✕</button>
    </div>
  </template>
  <template id="soloTemplate">
    <div class="soloRow">
      <img class="ico soloIco" alt="" referrerpolicy="no-referrer" />
      <span class="icoFallback soloIcoFallback" aria-hidden="true" hidden></span>
      <span class="soloHost small"></span>
      <a class="title soloTitle" target="_self"></a>
      <span class="path small"></span>
      <span class="ageChip" hidden></span>
      <span class="winChip" hidden></span>
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
    lastAccessed: overrides.lastAccessed,
    active: overrides.active,
  };
}

async function click(element: Element): Promise<void> {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Flushes the async reap/undo chains (several awaited browser calls deep). */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("renderTree incremental updates", () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mocks.sweepStore.current = null;
    resetCloseGuardForTests();
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

    // The cluster label shows once above the rows instead of a tag per row (F-16).
    const clusterLabel = clusterBody!.querySelector<HTMLElement>(".clusterLabel");
    expect(clusterLabel?.textContent).toBe("docs");
    expect(document.querySelectorAll(".clusterLabel")).toHaveLength(1);
    expect(document.querySelectorAll(".clusterTag")).toHaveLength(0);
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
    expect(document.querySelectorAll(".hostCard")).toHaveLength(0);

    // The remaining single-tab host renders as a compact solo row (review A1).
    const soloHost = document.querySelector<HTMLElement>(".soloRow .soloHost");
    expect(soloHost?.textContent).toContain("example.org");

    const stats = document.getElementById("stats");
    expect(stats?.textContent).toBe("1 tab matched");

    const hint = document.getElementById("refreshHint");
    expect(hint?.hidden).toBe(false);
  });

  it("disables Reap while closing and ignores a rapid double-click (audit F-1)", async () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 51, url: "https://first.example/one", title: "First" }),
        baseTab({ id: 53, url: "https://first.example/two", title: "First two" }),
        baseTab({ id: 52, url: "https://second.example/two", title: "Second" }),
        baseTab({ id: 54, url: "https://second.example/one", title: "Second one" }),
      ]),
      context
    );

    let resolveClose: (() => void) | null = null;
    vi.mocked(closeTabs).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve;
        })
    );

    const reap = document.querySelector<HTMLButtonElement>(".hostHeader .close");
    expect(reap).toBeDefined();

    // Double-dispatch synchronously, exactly like a rapid physical double-click.
    reap!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    reap!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(closeTabs).toHaveBeenCalledTimes(1);
    expect(reap!.disabled).toBe(true);

    resolveClose!();
    await settle();

    expect(closeTabs).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".hostCard")).toHaveLength(1);
    expect(document.querySelector<HTMLElement>(".hostName")?.textContent).toContain(
      "second.example"
    );
  });

  it("re-enables the Reap button when the close fails", async () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 61, url: "https://first.example/one", title: "First" }),
        baseTab({ id: 65, url: "https://first.example/two", title: "First two" }),
      ]),
      context
    );

    vi.mocked(closeTabs).mockRejectedValueOnce(new Error("no such tab"));

    const reap = document.querySelector<HTMLButtonElement>(".hostHeader .close");
    await click(reap!);

    expect(reap!.disabled).toBe(false);
    expect(context.onRefresh).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".hostCard")).toHaveLength(1);
  });

  it("ignores clicks on OTHER close buttons while a close is in flight (audit F-1)", async () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 62, url: "https://first.example/one", title: "First" }),
        baseTab({ id: 66, url: "https://first.example/two", title: "First two" }),
        baseTab({ id: 63, url: "https://second.example/two", title: "Second" }),
        baseTab({ id: 67, url: "https://second.example/one", title: "Second one" }),
      ]),
      context
    );

    const reaps = [...document.querySelectorAll<HTMLButtonElement>(".hostHeader .close")];
    expect(reaps).toHaveLength(2);

    // Simulate the shifted-row double-click: the second physical click lands on the
    // next host's Reap after the first card is removed — same pointer position, so the
    // double-click suppression must swallow it.
    reaps[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    reaps[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();

    expect(closeTabs).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".hostCard")).toHaveLength(1);
    expect(document.querySelector<HTMLElement>(".hostName")?.textContent).toContain(
      "second.example"
    );
  });

  it("allows a follow-up close after the in-flight one settles", async () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 64, url: "https://first.example/one", title: "First" }),
        baseTab({ id: 68, url: "https://first.example/two", title: "First two" }),
        baseTab({ id: 65, url: "https://second.example/two", title: "Second" }),
        baseTab({ id: 69, url: "https://second.example/one", title: "Second one" }),
      ]),
      context
    );

    const reapFor = (hostName: string): HTMLButtonElement =>
      [...document.querySelectorAll<HTMLButtonElement>(".hostHeader .close")].find(
        (button) =>
          button.closest(".hostCard")?.querySelector<HTMLElement>(".hostName")?.textContent ===
          hostName
      )!;

    reapFor("first.example").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    reapFor("second.example").dispatchEvent(new MouseEvent("click", { bubbles: true })); // swallowed (in flight)
    await settle();
    expect(closeTabs).toHaveBeenCalledTimes(1);

    // A genuine follow-up on the other row moves the pointer well away from the first
    // close click, so it is accepted even inside the double-click window.
    reapFor("second.example").dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 60, clientY: 420 })
    );
    await settle();
    expect(closeTabs).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll(".hostCard")).toHaveLength(0);
    expect(document.querySelectorAll(".soloRow")).toHaveLength(0);
  });

  it("marks pinned rows with the pin class and glyph hook (audit F-5)", () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel(
        [
          baseTab({ id: 71, url: "https://mail.example.com/inbox", title: "Inbox", pinned: true }),
          baseTab({ id: 72, url: "https://mail.example.com/list", title: "List" }),
        ],
        { excludePinned: false }
      ),
      context
    );

    const rows = [...document.querySelectorAll<HTMLElement>(".tab")];
    expect(rows).toHaveLength(2);
    const pinnedRow = rows.find((row) => row.classList.contains("pinnedTab"));
    expect(pinnedRow?.querySelector<HTMLElement>(".title")?.textContent).toBe("Inbox");
    expect(rows.filter((row) => row.classList.contains("pinnedTab"))).toHaveLength(1);
  });

  it("disables host Reap when every tab in the host is pinned (audit F-5)", async () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel(
        [
          baseTab({ id: 81, url: "https://mail.example.com/inbox", title: "Inbox", pinned: true }),
          baseTab({ id: 82, url: "https://mail.example.com/list", title: "List", pinned: true }),
        ],
        { excludePinned: false }
      ),
      context
    );

    const reap = document.querySelector<HTMLButtonElement>(".hostHeader .close");
    expect(reap?.disabled).toBe(true);
    expect(reap?.title).toBe("All pinned — nothing to reap");

    await click(reap!);
    expect(closeTabs).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".hostCard")).toHaveLength(1);
    expect(context.onRefresh).not.toHaveBeenCalled();
  });

  it("refreshes instead of removing the card when a reap leaves pinned tabs behind", async () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel(
        [
          baseTab({ id: 91, url: "https://mail.example.com/inbox", title: "Inbox", pinned: true }),
          baseTab({ id: 92, url: "https://mail.example.com/list", title: "List" }),
        ],
        { excludePinned: false }
      ),
      context
    );

    vi.mocked(closeTabs).mockResolvedValueOnce(undefined);

    const reap = document.querySelector<HTMLButtonElement>(".hostHeader .close");
    await click(reap!);

    expect(closeTabs).toHaveBeenCalledTimes(1);
    expect(vi.mocked(closeTabs).mock.calls[0]?.[0]).toEqual([92]);
    expect(context.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when an incremental close empties the tree (review)", async () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    // renderTree runs once with a non-empty model; the last tab is then closed
    // through its solo-row ✕ only.
    renderTree(
      buildTabModel([baseTab({ id: 121, url: "https://solo.example/one", title: "Solo" })]),
      context
    );

    vi.mocked(closeTabs).mockResolvedValueOnce(undefined);

    const x = document.querySelector<HTMLButtonElement>(".soloRow .x");
    expect(x).toBeDefined();
    await click(x!);

    expect(context.onRefresh).not.toHaveBeenCalled();
    expect(document.getElementById("stats")?.textContent).toBe("0 tabs matched");
    const empty = document.querySelector<HTMLElement>(".emptyState");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("All clear");
    expect(document.querySelectorAll(".hostCard")).toHaveLength(0);
    expect(document.querySelectorAll(".soloRow")).toHaveLength(0);
    // Nothing left to re-sort: the stale-order hint must stay hidden.
    expect(document.getElementById("refreshHint")?.hidden).toBe(true);
  });

  it("renders an empty-state message instead of a blank tree (audit F-7)", () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(buildTabModel([]), context);

    const empty = document.querySelector<HTMLElement>(".emptyState");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("All clear");
    expect(document.querySelectorAll(".hostCard")).toHaveLength(0);
  });

  it("explains the pinned filter and no-hit filter in the empty state (audit F-7)", () => {
    const base = { sortMode: "count", onRefresh: vi.fn(async () => {}) } as const;

    renderTree(buildTabModel([], { excludePinned: true }), {
      ...base,
      emptyState: "pinned-hidden",
    });
    let empty = document.querySelector<HTMLElement>(".emptyState");
    expect(empty?.textContent).toContain("Exclude pinned");

    renderTree(buildTabModel([], { excludePinned: true, filter: "zzz" }), {
      ...base,
      emptyState: "no-filter-hits",
      filter: "zzz",
    });
    empty = document.querySelector<HTMLElement>(".emptyState");
    expect(empty?.textContent).toContain("zzz");
    expect(empty?.textContent).toContain("Clear the filter");
  });

  it("sorts tabs within a cluster naturally, not lexicographically (audit F-15)", () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 111, url: "https://busy.example/fill/1", title: "item 1" }),
        baseTab({ id: 112, url: "https://busy.example/fill/10", title: "item 10" }),
        baseTab({ id: 113, url: "https://busy.example/fill/2", title: "item 2" }),
      ]),
      context
    );

    const titles = [...document.querySelectorAll<HTMLElement>(".tab .title")].map(
      (el) => el.textContent
    );
    expect(titles).toEqual(["item 1", "item 2", "item 10"]);
  });

  it("keeps expansion through a filter round-trip (audit F-10)", async () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };
    const allTabs: TabSummary[] = [
      baseTab({ id: 101, url: "https://example.com/one/a", title: "AAA" }),
      baseTab({ id: 102, url: "https://example.com/one/b", title: "BBB" }),
      baseTab({ id: 103, url: "https://other.example/two/c", title: "CCC" }),
    ];
    const universe = buildTabModel(allTabs, { excludePinned: false });

    const renderWithFilter = (filter: string): void => {
      renderTree(buildTabModel(allTabs, { excludePinned: false, filter }), {
        ...context,
        universeRoot: universe,
      });
    };

    renderWithFilter("");
    const firstHeader = document.querySelectorAll<HTMLElement>(".hostHeader")[0]!;
    expect(firstHeader.querySelector<HTMLElement>(".hostName")?.textContent).toBe("example.com");
    await click(firstHeader);
    expect(
      document.querySelector<HTMLElement>(".hostCard .hostBody")?.hidden
    ).toBe(false);

    // Filter the expanded host out entirely (the other host renders as a solo row).
    renderWithFilter("other");
    expect(document.querySelector<HTMLElement>(".soloRow .soloHost")?.textContent).toBe(
      "other.example"
    );

    // Clearing the filter must restore the expansion.
    renderWithFilter("");
    const exampleCard = [...document.querySelectorAll<HTMLElement>(".hostName")]
      .find((name) => name.textContent === "example.com")!
      .closest<HTMLElement>(".hostCard")!;
    expect(exampleCard.querySelector<HTMLElement>(".hostBody")?.hidden).toBe(false);
  });
});

describe("compact single-tab hosts (review A1)", () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mocks.sweepStore.current = null;
    resetCloseGuardForTests();
  });

  it("renders a single-tab host as one compact row without card chrome", () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 201, url: "https://lone.example/guide/intro", title: "Lone guide" }),
      ]),
      context
    );

    expect(document.querySelectorAll(".hostCard")).toHaveLength(0);
    expect(document.querySelectorAll(".cluster")).toHaveLength(0);

    const row = document.querySelector<HTMLElement>(".soloRow");
    expect(row).not.toBeNull();
    expect(row?.querySelector<HTMLElement>(".soloHost")?.textContent).toBe("lone.example");
    expect(row?.querySelector<HTMLElement>(".soloTitle")?.textContent).toBe("Lone guide");
    expect(row?.querySelector<HTMLElement>(".path")?.textContent).toBe("intro");
    expect(row?.querySelector<HTMLButtonElement>(".x")).not.toBeNull();
    expect(row?.querySelector<HTMLElement>(".badge")).toBeNull();
  });

  it("keeps the pin glyph on a pinned solo row", () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel(
        [baseTab({ id: 202, url: "https://pin.example/keep", title: "Keep me", pinned: true })],
        { excludePinned: false }
      ),
      context
    );

    const row = document.querySelector<HTMLElement>(".soloRow");
    expect(row?.classList.contains("pinnedTab")).toBe(true);
  });

  it("auto-collapses on open when there are more hosts than the threshold", () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    const tabs: TabSummary[] = [];
    for (let i = 0; i < AUTO_COLLAPSE_HOST_COUNT + 2; i += 1) {
      tabs.push(
        baseTab({ id: 300 + i, url: `https://host${i}.example/a/${i}`, title: `Host ${i}` }),
        baseTab({ id: 400 + i, url: `https://host${i}.example/b/${i}`, title: `Host ${i} B` })
      );
    }

    renderTree(buildTabModel(tabs), context);

    // 22 hosts × 2 tabs each: every card must open collapsed.
    const bodies = [...document.querySelectorAll<HTMLElement>(".hostBody")];
    expect(bodies.length).toBeGreaterThan(AUTO_COLLAPSE_HOST_COUNT);
    expect(bodies.every((body) => body.hidden)).toBe(true);
  });
});

describe("staleness chips and Reap stale (review F3)", () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mocks.sweepStore.current = null;
    resetCloseGuardForTests();
  });

  it("renders relative age chips on rows older than a minute", () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
      now: 1_000_000_000_000,
    };

    renderTree(
      buildTabModel([
        baseTab({
          id: 501,
          url: "https://aged.example/a",
          title: "Old",
          lastAccessed: context.now! - 2 * 24 * 3_600_000,
        }),
        baseTab({
          id: 502,
          url: "https://aged.example/b",
          title: "Fresh",
          lastAccessed: context.now! - 5_000,
        }),
      ]),
      context
    );

    const chips = [...document.querySelectorAll<HTMLElement>(".tab .ageChip")];
    expect(chips).toHaveLength(2);
    expect(chips[0]?.hidden).toBe(false);
    expect(chips[0]?.textContent).toBe("2d");
    expect(chips[1]?.hidden).toBe(true);
  });

  it("shows Reap stale only for hosts with stale unpinned tabs and closes just those", async () => {
    const now = Date.now();
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
      now,
    };

    renderTree(
      buildTabModel([
        baseTab({
          id: 510,
          url: "https://mix.example/old",
          title: "Old",
          lastAccessed: now - STALE_MS - 1000,
        }),
        baseTab({
          id: 511,
          url: "https://mix.example/new",
          title: "New",
          lastAccessed: now - 60_000,
        }),
        baseTab({
          id: 512,
          url: "https://mix.example/pin",
          title: "Pinned old",
          pinned: true,
          lastAccessed: now - STALE_MS - 1000,
        }),
        baseTab({
          id: 513,
          url: "https://fresh.example/only",
          title: "Fresh host",
          lastAccessed: now - 1000,
        }),
      ], { excludePinned: false }),
      context
    );

    const staleButtons = [...document.querySelectorAll<HTMLButtonElement>(".staleButton")];
    expect(staleButtons).toHaveLength(1);
    expect(staleButtons[0]!.hidden).toBe(false);
    expect(staleButtons[0]!.title).toContain("older than 24h");

    await click(staleButtons[0]!);

    expect(closeTabs).toHaveBeenCalledTimes(1);
    expect(vi.mocked(closeTabs).mock.calls[0]?.[0]).toEqual([510]);
    expect(context.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("sorts hosts stalest-first in the stale sort mode with an A→Z tie-break", () => {
    const now = 5_000_000_000_000;
    const context: RenderContext = {
      sortMode: "stale",
      onRefresh: vi.fn(async () => {}),
      now,
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 520, url: "https://zeta.example/a", title: "Z old", lastAccessed: now - 3 * 24 * 3_600_000 }),
        baseTab({ id: 521, url: "https://alpha.example/a", title: "A old", lastAccessed: now - 3 * 24 * 3_600_000 }),
        baseTab({ id: 522, url: "https://beta.example/a", title: "B older", lastAccessed: now - 9 * 24 * 3_600_000 }),
      ]),
      context
    );

    // Three single-tab hosts → three solo rows, ordered stalest first, then A→Z.
    const hosts = [...document.querySelectorAll<HTMLElement>(".soloRow .soloHost")].map(
      (el) => el.textContent
    );
    expect(hosts).toEqual(["beta.example", "alpha.example", "zeta.example"]);
  });
});

describe("window chips (review F2)", () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mocks.sweepStore.current = null;
    resetCloseGuardForTests();
  });

  it("badges rows and hosts from non-focused windows when tabs span windows", () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
      focusedWindowId: 1,
      multiWindow: true,
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 601, url: "https://one.example/a", title: "Focused", windowId: 1 }),
        baseTab({ id: 602, url: "https://two.example/b", title: "Elsewhere", windowId: 2 }),
        baseTab({ id: 603, url: "https://three.example/c", title: "Far away", windowId: 3 }),
      ]),
      context
    );

    const rows = [...document.querySelectorAll<HTMLElement>(".soloRow")];
    expect(rows).toHaveLength(3);

    const chipFor = (title: string): HTMLElement | null =>
      rows
        .find((row) => row.querySelector<HTMLElement>(".title")?.textContent === title)
        ?.querySelector<HTMLElement>(".winChip") ?? null;

    expect(chipFor("Focused")?.hidden ?? true).toBe(true);
    expect(chipFor("Elsewhere")?.textContent).toBe("W2");
    expect(chipFor("Far away")?.textContent).toBe("W3");
  });

  it("shows the group window chip on hosts spanning several windows", () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
      focusedWindowId: 1,
      multiWindow: true,
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 610, url: "https://split.example/one", title: "W1 copy", windowId: 1 }),
        baseTab({ id: 611, url: "https://split.example/two", title: "W2 copy", windowId: 2 }),
      ]),
      context
    );

    const hostChip = document.querySelector<HTMLElement>(".hostHeader .winChip");
    expect(hostChip?.hidden).toBe(false);
    expect(hostChip?.textContent).toBe("⧉ 2");
  });
});

describe("duplicate detection (review F8)", () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mocks.sweepStore.current = null;
    resetCloseGuardForTests();
  });

  it("badges duplicate rows and offers Close dups that keeps the newest copy", async () => {
    const now = Date.now();
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
      now,
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 701, url: "https://news.example/story?utm_source=nl", title: "Story", lastAccessed: now - 1000 }),
        baseTab({ id: 702, url: "https://news.example/story", title: "Story again", lastAccessed: now - 3_600_000 }),
        baseTab({ id: 703, url: "https://news.example/story?ref=x", title: "Story third", lastAccessed: now - 60_000 }),
        baseTab({ id: 704, url: "https://news.example/other", title: "Other", lastAccessed: now }),
      ]),
      context
    );

    // Host card with one cluster ("story" + "other" — first path segment) —
    // wait: /story and /other are two clusters.
    const dupChips = [...document.querySelectorAll<HTMLElement>(".tab .dupChip")].filter(
      (chip) => !chip.hidden
    );
    expect(dupChips).toHaveLength(3);
    expect(dupChips.every((chip) => chip.textContent === "×3")).toBe(true);

    const dupButton = document.querySelector<HTMLButtonElement>(".hostHeader .dupButton");
    expect(dupButton?.hidden).toBe(false);
    expect(dupButton?.title).toContain("2 duplicate tabs");

    await click(dupButton!);

    expect(closeTabs).toHaveBeenCalledTimes(1);
    // Keeper is the most recently accessed copy (701); the rest close.
    expect(vi.mocked(closeTabs).mock.calls[0]?.[0].sort()).toEqual([702, 703]);
    expect(context.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("never closes pinned duplicates and prefers the active copy as keeper", async () => {
    const now = Date.now();
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
      now,
    };

    renderTree(
      buildTabModel(
        [
          baseTab({ id: 710, url: "https://docs.example/page", title: "Old but active", lastAccessed: now - 86_400_000, active: true }),
          baseTab({ id: 711, url: "https://docs.example/page", title: "Newest", lastAccessed: now - 1000 }),
          baseTab({ id: 712, url: "https://docs.example/page?utm=x", title: "Pinned copy", pinned: true, lastAccessed: now - 2000 }),
        ],
        { excludePinned: false }
      ),
      context
    );

    const dupButton = document.querySelector<HTMLButtonElement>(".hostHeader .dupButton");
    expect(dupButton?.hidden).toBe(false);

    await click(dupButton!);

    // Active copy (710) is the keeper even though 711 is newer; pinned 712 survives.
    expect(vi.mocked(closeTabs).mock.calls[0]?.[0]).toEqual([711]);
  });

  it("hides the dup action when every duplicate is pinned", () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel(
        [
          baseTab({ id: 720, url: "https://pinned.example/dup", title: "Dup A", pinned: true }),
          baseTab({ id: 721, url: "https://pinned.example/dup", title: "Dup B", pinned: true }),
        ],
        { excludePinned: false }
      ),
      context
    );

    expect(document.querySelector<HTMLElement>(".hostHeader .dupButton")?.hidden).toBe(true);
  });
});

describe("reap undo toast (review F1)", () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mocks.sweepStore.current = null;
    resetCloseGuardForTests();
  });

  it("stores the sweep, toasts 'Reaped N', and Undo reopens the tabs", async () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 801, url: "https://gone.example/a", title: "Gone A" }),
        baseTab({ id: 802, url: "https://gone.example/b", title: "Gone B" }),
      ]),
      context
    );

    const reap = document.querySelector<HTMLButtonElement>(".hostHeader .close");
    await click(reap!);
    await settle();

    const toast = document.getElementById("toast");
    expect(toast?.hidden).toBe(false);
    expect(document.getElementById("toastText")?.textContent).toBe("Reaped 2");

    const stored = mocks.sweepStore.current as { tabs: { url: string; pinned: boolean; windowId: number }[] };
    expect(stored.tabs.map((tab) => tab.url)).toEqual([
      "https://gone.example/a",
      "https://gone.example/b",
    ]);
    expect(stored.tabs.every((tab) => tab.pinned === false)).toBe(true);

    document.getElementById("toastAction")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await settle();

    expect(reopenTab).toHaveBeenCalledTimes(2);
    expect(mocks.sweepStore.current).toBeNull();
    expect(document.getElementById("toast")?.hidden).toBe(true);
    expect(context.onRefresh).toHaveBeenCalled();
  });

  it("records undoable sweeps for cluster reaps too", async () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 810, url: "https://cl.example/one/a", title: "A" }),
        baseTab({ id: 811, url: "https://cl.example/one/b", title: "B" }),
        baseTab({ id: 812, url: "https://cl.example/two/c", title: "C" }),
      ]),
      context
    );

    // Expand the host so cluster Reap buttons exist.
    await click(document.querySelector<HTMLElement>(".hostHeader")!);
    const clusterReap = document.querySelector<HTMLButtonElement>(".clusterHeader .close");
    await click(clusterReap!);
    await settle();

    expect(document.getElementById("toast")?.hidden).toBe(false);
    expect(document.getElementById("toastText")?.textContent).toBe("Reaped 2");
  });
});

describe("pin awareness on group headers (review A11)", () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mocks.sweepStore.current = null;
    resetCloseGuardForTests();
  });

  it("shows the pin chip and honest Reap tooltip on hosts containing pinned tabs", () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel(
        [
          baseTab({ id: 901, url: "https://mail.example.com/inbox", title: "Inbox", pinned: true }),
          baseTab({ id: 902, url: "https://mail.example.com/list", title: "List" }),
          baseTab({ id: 903, url: "https://mail.example.com/archive/x", title: "Archive", pinned: true }),
        ],
        { excludePinned: false }
      ),
      context
    );

    const pinChip = document.querySelector<HTMLElement>(".hostHeader .pinChip");
    expect(pinChip?.hidden).toBe(false);
    expect(pinChip?.textContent).toBe("📌 2");

    const reap = document.querySelector<HTMLButtonElement>(".hostHeader .close");
    expect(reap?.title).toBe("Closes 1 · pinned survive");
  });

  it("keeps pin chips off hosts without pinned tabs", () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 910, url: "https://plain.example/a", title: "A" }),
        baseTab({ id: 911, url: "https://plain.example/b", title: "B" }),
      ]),
      context
    );

    expect(document.querySelector<HTMLElement>(".hostHeader .pinChip")?.hidden).toBe(true);
  });
});

describe("deterministic ordering (review A8)", () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mocks.sweepStore.current = null;
    resetCloseGuardForTests();
  });

  it("breaks count-sort ties by name ascending", () => {
    const context: RenderContext = {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
    };

    renderTree(
      buildTabModel([
        baseTab({ id: 1001, url: "https://zeta.example/x", title: "Z" }),
        baseTab({ id: 1002, url: "https://alpha.example/x", title: "A" }),
        baseTab({ id: 1003, url: "https://mid.example/x", title: "M" }),
      ]),
      context
    );

    const hosts = [...document.querySelectorAll<HTMLElement>(".soloRow .soloHost")].map(
      (el) => el.textContent
    );
    expect(hosts).toEqual(["alpha.example", "mid.example", "zeta.example"]);
  });
});
