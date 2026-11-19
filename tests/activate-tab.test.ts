import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AnyRecord = Record<string, unknown>;

function stubBrowser(): {
  tabsUpdate: ReturnType<typeof vi.fn>;
  tabsGet: ReturnType<typeof vi.fn>;
  windowsUpdate: ReturnType<typeof vi.fn>;
} {
  const tabsUpdate = vi.fn(async () => ({} as AnyRecord));
  const tabsGet = vi.fn(async () => ({ windowId: 42 }) as AnyRecord);
  const windowsUpdate = vi.fn(async () => ({} as AnyRecord));
  (globalThis as AnyRecord).browser = {
    tabs: { update: tabsUpdate, get: tabsGet },
    windows: { update: windowsUpdate },
  };
  return { tabsUpdate, tabsGet, windowsUpdate };
}

describe("activateTab (audit F-3)", () => {
  beforeEach(() => {
    stubBrowser();
  });

  afterEach(() => {
    delete (globalThis as AnyRecord).browser;
    vi.restoreAllMocks();
  });

  it("activates the tab and focuses its owning window", async () => {
    const { tabsUpdate, tabsGet, windowsUpdate } = stubBrowser();
    const { activateTab } = await import("../src/browser/tabs.js");

    await activateTab(7);

    expect(tabsUpdate).toHaveBeenCalledWith(7, { active: true });
    expect(tabsGet).toHaveBeenCalledWith(7);
    expect(windowsUpdate).toHaveBeenCalledWith(42, { focused: true });
  });

  it("still resolves when focusing the window fails", async () => {
    const { windowsUpdate } = stubBrowser();
    windowsUpdate.mockRejectedValue(new Error("no such window"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { activateTab } = await import("../src/browser/tabs.js");

    await expect(activateTab(7)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });

  it("skips the window focus when the tab has no windowId", async () => {
    const { tabsGet, windowsUpdate } = stubBrowser();
    tabsGet.mockResolvedValue({});
    const { activateTab } = await import("../src/browser/tabs.js");

    await activateTab(7);
    expect(windowsUpdate).not.toHaveBeenCalled();
  });
});
