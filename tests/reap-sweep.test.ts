import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AnyRecord = Record<string, unknown>;

function stubSessionStorage(): Map<string, unknown> {
  const data = new Map<string, unknown>();
  (globalThis as AnyRecord).browser = {
    storage: {
      session: {
        get: async (key: string) => (data.has(key) ? { [key]: data.get(key) } : {}),
        set: async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) {
            data.set(k, v);
          }
        },
        remove: async (key: string) => {
          data.delete(key);
        },
      },
    },
  };
  return data;
}

describe("last-sweep persistence (review F1 undo store)", () => {
  beforeEach(() => {
    stubSessionStorage();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete (globalThis as AnyRecord).browser;
  });

  it("stores the sweep under lastSweep and loads it back verbatim", async () => {
    const data = stubSessionStorage();
    const { saveLastSweep, loadLastSweep } = await import("../src/browser/storage.js");

    const sweep = {
      tabs: [
        { url: "https://a.example/x", title: "A", pinned: false, windowId: 1 },
        { url: "https://b.example/y", title: "B", pinned: true, windowId: 2 },
      ],
      savedAt: 1234,
    };
    await saveLastSweep(sweep);

    expect(data.has("lastSweep")).toBe(true);
    expect(await loadLastSweep()).toEqual(sweep);
  });

  it("clears the stored sweep", async () => {
    stubSessionStorage();
    const { saveLastSweep, loadLastSweep, clearLastSweep } = await import("../src/browser/storage.js");

    await saveLastSweep({ tabs: [{ url: "https://a.example/x", title: "A", pinned: false, windowId: 1 }], savedAt: 1 });
    await clearLastSweep();

    expect(await loadLastSweep()).toBeNull();
  });

  it("rejects stored values of the wrong shape", async () => {
    const data = stubSessionStorage();
    const { loadLastSweep } = await import("../src/browser/storage.js");

    data.set("lastSweep", { tabs: [{ url: "https://a.example/x" }], savedAt: "nope" });
    expect(await loadLastSweep()).toBeNull();

    data.set("lastSweep", { tabs: [], savedAt: 5 });
    expect(await loadLastSweep()).toBeNull();

    data.set("lastSweep", "nonsense");
    expect(await loadLastSweep()).toBeNull();
  });

  it("returns null when storage.session is unavailable", async () => {
    (globalThis as AnyRecord).browser = { storage: {} };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { loadLastSweep, saveLastSweep, clearLastSweep } = await import("../src/browser/storage.js");

    expect(await loadLastSweep()).toBeNull();
    await expect(
      saveLastSweep({ tabs: [{ url: "https://a.example/x", title: "A", pinned: false, windowId: 1 }], savedAt: 1 })
    ).resolves.toBeUndefined();
    await expect(clearLastSweep()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });
});
