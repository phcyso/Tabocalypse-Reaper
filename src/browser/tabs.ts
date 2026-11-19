import type { TabSummary } from "../model/index.js";

/** Fallback timestamp when the browser/stub omits lastAccessed: "accessed now",
 * so a missing value can never make a tab look stale. */
function accessTime(tab: browser.tabs.Tab): number {
  return typeof tab.lastAccessed === "number" ? tab.lastAccessed : Date.now();
}

/**
 * Fetches every open tab and normalises the subset of fields the model consumes so the
 * rest of the pipeline can operate on a consistent, typed structure.
 */
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
      lastAccessed: accessTime(tab),
      active: Boolean(tab.active),
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
  // The tab may live in a background window: raise it too, otherwise activation looks
  // like a no-op from the user's perspective (audit findings F-3/F-8). Best-effort —
  // a failed focus must not mask the successful activation.
  try {
    const tab = await browser.tabs.get(id);
    if (typeof tab.windowId === "number") {
      await browser.windows.update(tab.windowId, { focused: true });
    }
  } catch (error) {
    console.error("Failed to focus the tab's window", error);
  }
}

/**
 * Window the popup is docked to (the currently focused one). Falls back to the active
 * tab's window, then to the first tab, so window chips still work in stripped-down
 * test harnesses. Returns -1 when nothing can be determined.
 */
export async function queryFocusedWindowId(): Promise<number> {
  try {
    const win = await browser.windows?.getLastFocused?.();
    if (typeof win?.id === "number") {
      return win.id;
    }
  } catch (error) {
    console.error("Failed to query focused window", error);
  }
  try {
    const tabs = await browser.tabs.query({ active: true });
    const withWindow = tabs.find((tab) => typeof tab.windowId === "number");
    if (withWindow) {
      return withWindow.windowId as number;
    }
    const all = await browser.tabs.query({});
    const first = all.find((tab) => typeof tab.windowId === "number");
    return typeof first?.windowId === "number" ? first.windowId : -1;
  } catch (error) {
    console.error("Failed to infer focused window from tabs", error);
    return -1;
  }
}

/** A tab as stored in an undoable reap sweep: just enough to recreate it. */
export interface ReopenedTab {
  url: string;
  title: string;
  pinned: boolean;
  windowId: number;
}

/**
 * Recreates one reaped tab via browser.tabs.create (undo, review F1).
 *
 * Best-effort by design: original tab positions are NOT recoverable with
 * tabs.create (it appends at the end of the target window), so this restores
 * the essentials — URL, pin state, owning window — and nothing more. If the
 * original window is gone, the tab is recreated in the current window.
 */
export async function reopenTab(tab: ReopenedTab): Promise<void> {
  try {
    await browser.tabs.create({
      url: tab.url,
      active: false,
      pinned: tab.pinned,
      windowId: tab.windowId,
    });
  } catch {
    // Window (or pin state) no longer valid — fall back to a plain create.
    try {
      await browser.tabs.create({ url: tab.url, active: false });
    } catch (error) {
      console.error("Failed to reopen reaped tab", tab.url, error);
    }
  }
}
