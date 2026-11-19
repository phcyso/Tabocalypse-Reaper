import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AnyRecord = Record<string, unknown>;

function stubSessionStorage(): Map<string, unknown> {
  const data = new Map<string, unknown>();
  (globalThis as AnyRecord).browser = {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: data.get(key) }),
        set: async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) {
            data.set(k, v);
          }
        },
      },
    },
  };
  return data;
}

describe("UI prefs persistence (audit F-11)", () => {
  beforeEach(() => {
    stubSessionStorage();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete (globalThis as AnyRecord).browser;
  });

  it("stores prefs under the uiPrefs key and loads them back", async () => {
    const data = stubSessionStorage();
    const { loadUiPrefs, saveUiPrefs } = await import("../src/browser/storage.js");

    await saveUiPrefs({ sort: "alpha", excludePinned: false });

    expect(data.has("uiPrefs")).toBe(true);
    expect(await loadUiPrefs()).toEqual({ sort: "alpha", excludePinned: false });
  });

  it("round-trips the stale sort mode (review F3)", async () => {
    stubSessionStorage();
    const { loadUiPrefs, saveUiPrefs } = await import("../src/browser/storage.js");

    await saveUiPrefs({ sort: "stale", excludePinned: true });
    expect(await loadUiPrefs()).toEqual({ sort: "stale", excludePinned: true });
  });

  it("ignores stored values of the wrong shape", async () => {
    stubSessionStorage().set("uiPrefs", { sort: "sideways", excludePinned: "yes" });
    const { loadUiPrefs } = await import("../src/browser/storage.js");

    expect(await loadUiPrefs()).toEqual({});
  });

  it("returns empty prefs when storage.session is unavailable", async () => {
    (globalThis as AnyRecord).browser = { storage: {} };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { loadUiPrefs, saveUiPrefs } = await import("../src/browser/storage.js");

    expect(await loadUiPrefs()).toEqual({});
    await expect(saveUiPrefs({ sort: "count", excludePinned: true })).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });
});
