import type { TabSummary } from "../model/index.js";

export async function queryOpenTabs(): Promise<TabSummary[]> {
  const tabs = await browser.tabs.query({});
  return tabs
    .filter((tab): tab is browser.tabs.Tab & { id: number; url: string } =>
      typeof tab.id === "number" && typeof tab.url === "string"
    )
    .map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: tab.title ?? tab.url,
      pinned: Boolean(tab.pinned),
      windowId: tab.windowId ?? 0,
      favIconUrl: tab.favIconUrl ?? "",
    }));
}

export async function closeTabs(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await browser.tabs.remove([...ids]);
}

export async function closeTab(id: number): Promise<void> {
  await browser.tabs.remove(id);
}

export async function activateTab(id: number): Promise<void> {
  await browser.tabs.update(id, { active: true });
}
