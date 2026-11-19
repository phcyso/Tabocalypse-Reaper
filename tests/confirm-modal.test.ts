import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderTree, resetCloseGuardForTests, type RenderContext } from "../src/dom/render";
import { closeTab, closeTabs } from "../src/browser/tabs.js";
import { buildTabModel, type TabSummary } from "../src/model/index.js";
import { CONFIRM_THRESHOLD } from "../src/shared/constants.js";

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
    <div class="treeFade" aria-hidden="true"></div>
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
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("confirm modal (in-popup, replaces native confirm)", () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mocks.sweepStore.current = null;
    resetCloseGuardForTests();
  });

  function renderHostWithTabs(tabCount: number, context: Partial<RenderContext> = {}): void {
    const tabs: TabSummary[] = [];
    for (let i = 0; i < tabCount; i += 1) {
      tabs.push(baseTab({ id: 100 + i, url: `https://huge.test/page/${i}`, title: `Huge page ${i}` }));
    }
    const root = buildTabModel(tabs, { excludePinned: true, filter: "" });
    renderTree(root, {
      sortMode: "count",
      onRefresh: vi.fn(async () => {}),
      ...context,
    });
  }

  it("shows the themed modal with a tab preview when the threshold is exceeded", async () => {
    renderHostWithTabs(CONFIRM_THRESHOLD + 2);
    const reap = document.querySelector<HTMLElement>(".hostCard .reapButton")!;
    await click(reap);
    await settle();

    const overlay = document.querySelector(".confirmOverlay");
    expect(overlay).not.toBeNull();
    const expected = CONFIRM_THRESHOLD + 2;
    expect(document.getElementById("confirmTitle")?.textContent).toContain(`${expected} tabs`);
    const items = document.querySelectorAll(".confirmList li");
    expect(items.length).toBe(Math.min(expected, 8) + 1); // preview + "… and N more"
    expect(document.querySelector(".confirmList li")?.textContent).toContain("Huge page");
    expect(document.activeElement?.classList.contains("confirmOk")).toBe(true);
  });

  it("does not show the modal below the threshold", async () => {
    renderHostWithTabs(CONFIRM_THRESHOLD - 1);
    const reap = document.querySelector<HTMLElement>(".hostCard .reapButton")!;
    await click(reap);
    await settle();

    expect(document.querySelector(".confirmOverlay")).toBeNull();
    expect(closeTabs).toHaveBeenCalledTimes(1);
  });

  it("closes nothing on Cancel, everything on OK", async () => {
    renderHostWithTabs(CONFIRM_THRESHOLD + 1);
    const reap = document.querySelector<HTMLElement>(".hostCard .reapButton")!;

    await click(reap);
    await settle();
    await click(document.querySelector<HTMLElement>(".confirmCancel")!);
    await settle();
    expect(document.querySelector(".confirmOverlay")).toBeNull();
    expect(closeTabs).not.toHaveBeenCalled();

    // second click 200px away: the same-position double-click suppressor must
    // not eat it (jsdom reports every click at 0,0)
    reap.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 200, clientY: 200 }));
    await Promise.resolve();
    await settle();
    await click(document.querySelector<HTMLElement>(".confirmOk")!);
    await settle();
    expect(closeTabs).toHaveBeenCalledTimes(1);
    expect(vi.mocked(closeTabs).mock.calls[0]?.[0].length).toBe(CONFIRM_THRESHOLD + 1);
  });

  it("confirms on Enter and cancels on Escape", async () => {
    renderHostWithTabs(CONFIRM_THRESHOLD + 1);
    const reap = document.querySelector<HTMLElement>(".hostCard .reapButton")!;

    await click(reap);
    await settle();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle();
    expect(document.querySelector(".confirmOverlay")).toBeNull();
    expect(closeTabs).not.toHaveBeenCalled();

    reap.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 200, clientY: 200 }));
    await Promise.resolve();
    await settle();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await settle();
    expect(closeTabs).toHaveBeenCalledTimes(1);
  });
});

describe("optimistic single-tab close", () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mocks.sweepStore.current = null;
    resetCloseGuardForTests();
  });

  function renderSolo(): { id: number } {
    const tab = baseTab({ id: 7, url: "https://lonely.test/only", title: "Lonely tab" });
    const root = buildTabModel([tab], { excludePinned: true, filter: "" });
    renderTree(root, { sortMode: "count", onRefresh: vi.fn(async () => {}) });
    return { id: tab.id };
  }

  it("removes the solo row before the close API resolves", async () => {
    const { id } = renderSolo();
    let releaseClose!: () => void;
    vi.mocked(closeTab).mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseClose = resolve; })
    );

    const x = document.querySelector<HTMLElement>(".soloRow .x")!;
    await click(x);
    await Promise.resolve();

    // The row is gone from the DOM immediately, before closeTab settles.
    expect(document.querySelector(".soloRow")).toBeNull();
    releaseClose();
    await settle();
    expect(closeTab).toHaveBeenCalledWith(id);
  });

  it("removes the tab row inside a cluster immediately, then cascades", async () => {
    const tabs = [
      baseTab({ id: 1, url: "https://group.test/a/1", title: "A1" }),
      baseTab({ id: 2, url: "https://group.test/a/2", title: "A2" }),
    ];
    const root = buildTabModel(tabs, { excludePinned: true, filter: "" });
    renderTree(root, { sortMode: "count", onRefresh: vi.fn(async () => {}) });

    let releaseClose!: () => void;
    vi.mocked(closeTab).mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseClose = resolve; })
    );

    const x = document.querySelector<HTMLElement>(".tab .x")!;
    await click(x);
    await Promise.resolve();

    expect(document.querySelectorAll(".tab").length).toBe(1); // optimistic: clicked row gone
    releaseClose();
    await settle();
    expect(document.querySelectorAll(".tab").length).toBe(1); // second row remains
    expect(document.querySelector(".hostCard .badge")?.textContent).toBe("1");
  });
});
