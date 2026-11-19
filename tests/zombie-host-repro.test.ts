import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderTree, resetCloseGuardForTests, type RenderContext } from "../src/dom/render";
import { buildTabModel, type TabSummary } from "../src/model/index.js";

vi.mock("../src/browser/tabs.js", () => ({
  closeTabs: vi.fn(async () => {}),
  closeTab: vi.fn(async () => {}),
  activateTab: vi.fn(async () => {}),
  reopenTab: vi.fn(async () => {}),
}));

const mocks = vi.hoisted(() => ({ sweepStore: { current: null as unknown } }));
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
      <button id="refreshHint" class="refreshHint" hidden></button>
    </section>
    <div id="stats"></div>
    <div id="tree"></div>
    <div id="toast" class="toast" hidden><span id="toastText"></span><button id="toastAction" class="toastAction">Undo</button></div>
    <template id="hostTemplate"><section class="hostCard"><header class="hostHeader" tabindex="0" role="button" aria-expanded="false"><span class="twisty">▸</span><img class="ico hostIco"/><span class="icoFallback hostIcoFallback" hidden></span><span class="hostName"></span><span class="badge"></span><span class="pinChip" hidden></span><span class="winChip" hidden></span><div class="spacer"></div><button class="staleButton" hidden>Reap stale</button><button class="dupButton" hidden>Close dups</button><button class="close reapButton">Reap</button></header><div class="hostBody"></div></section></template>
    <template id="clusterTemplate"><div class="cluster"><header class="clusterHeader" tabindex="0" role="button" aria-expanded="false"><span class="twisty">▸</span><img class="ico clusterIco"/><span class="icoFallback clusterIcoFallback" hidden></span><span class="clusterName"></span><span class="badge small"></span><span class="pinChip" hidden></span><span class="dupChip" hidden></span><div class="spacer"></div><button class="close reapButton">Reap</button></header><div class="clusterBody"></div></div></template>
    <template id="tabTemplate"><div class="tab"><img class="ico"/><span class="icoFallback tabIcoFallback" hidden></span><a class="title" target="_self"></a><span class="path small"></span><span class="ageChip" hidden></span><span class="winChip" hidden></span><span class="dupChip" hidden></span><button class="x">✕</button></div></template>
    <template id="soloTemplate"><div class="soloRow"><img class="ico soloIco"/><span class="icoFallback soloIcoFallback" hidden></span><span class="soloHost small"></span><a class="title soloTitle" target="_self"></a><span class="path small"></span><span class="ageChip" hidden></span><span class="winChip" hidden></span><button class="x">✕</button></div></template>`;
}

function baseTab(o: Partial<TabSummary> = {}): TabSummary {
  return { id: o.id ?? Math.floor(Math.random()*100000), url: o.url ?? "https://example.com/", title: o.title ?? "Example", pinned: o.pinned ?? false, windowId: o.windowId ?? 1, favIconUrl: o.favIconUrl ?? "" };
}

async function click(el: Element): Promise<void> {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await Promise.resolve(); await Promise.resolve(); await new Promise(r => setTimeout(r, 0));
}

describe("zombie host/cluster cards after last-tab close (audit F-2)", () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    mocks.sweepStore.current = null;
    resetCloseGuardForTests();
  });

  it("closing the ONLY tab of a single-tab host removes its row (solo row, review A1)", async () => {
    const ctx: RenderContext = { sortMode: "count", onRefresh: vi.fn(async () => {}) };
    const tabs = [baseTab({ id: 1, url: "https://mail.example.com/inbox", title: "Webmail" })];
    renderTree(buildTabModel(tabs, { excludePinned: false }), ctx);

    expect(document.querySelectorAll(".soloRow").length).toBe(1);
    const x = document.querySelector(".soloRow .x")!;
    await click(x);

    expect(document.querySelectorAll(".soloRow")).toHaveLength(0);
    expect(document.querySelectorAll(".hostCard")).toHaveLength(0);
    expect(document.querySelectorAll(".tab")).toHaveLength(0);
    expect(document.getElementById("stats")?.textContent).toBe("0 tabs matched");
  });

  it("emptying cluster A of a multi-cluster host removes its row and keeps the host badge correct", async () => {
    const ctx: RenderContext = { sortMode: "count", onRefresh: vi.fn(async () => {}) };
    const tabs = [
      baseTab({ id: 1, url: "https://example.com/one/a", title: "A1" }),
      baseTab({ id: 2, url: "https://example.com/one/b", title: "A2" }),
      baseTab({ id: 3, url: "https://example.com/two/c", title: "B1" }),
    ];
    renderTree(buildTabModel(tabs, { excludePinned: false }), ctx);

    expect(document.querySelectorAll(".hostCard")).toHaveLength(1);
    expect(document.querySelectorAll(".cluster")).toHaveLength(2);

    // Drain cluster "one" tab by tab via its ✕ buttons.
    const oneCluster = document.querySelector<HTMLElement>('.cluster[data-cluster-key="one"]')!;
    expect(oneCluster).toBeDefined();
    for (const x of [...oneCluster.querySelectorAll<HTMLButtonElement>(".tab .x")]) {
      await click(x);
    }

    expect(document.querySelector('.cluster[data-cluster-key="one"]')).toBeNull();
    expect(document.querySelectorAll(".cluster")).toHaveLength(1);
    expect(document.querySelectorAll(".hostCard")).toHaveLength(1);

    const hostBadge = document.querySelector<HTMLElement>(".hostHeader .badge");
    expect(hostBadge?.textContent).toBe("1");
    expect(document.querySelectorAll(".tab")).toHaveLength(1);
    expect(document.getElementById("stats")?.textContent).toBe("1 tab matched");
  });
});
