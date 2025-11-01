import { describe, expect, it } from "vitest";

import { buildTabModel, type TabSummary } from "../src/model";

describe("buildTabModel", () => {
  const baseTab = (overrides: Partial<TabSummary> = {}): TabSummary => ({
    id: overrides.id ?? Math.floor(Math.random() * 10_000),
    url: overrides.url ?? "https://example.com/alpha",
    title: overrides.title ?? "Example",
    pinned: overrides.pinned ?? false,
    windowId: overrides.windowId ?? 1,
    favIconUrl: overrides.favIconUrl ?? "https://example.com/favicon.ico",
  });

  it("groups tabs by host and cluster", () => {
    const tabs: TabSummary[] = [
      baseTab({ id: 1, url: "https://example.com/foo" }),
      baseTab({ id: 2, url: "https://example.com/foo/bar" }),
      baseTab({ id: 3, url: "https://example.com/beta" }),
    ];

    const model = buildTabModel(tabs);
    const host = model.children.get("example.com");
    expect(host).toBeDefined();
    expect(host?.count).toBe(3);

    const fooCluster = host?.children.get("foo");
    expect(fooCluster?.tabs.map((tab) => tab.id)).toEqual([1, 2]);
    expect(fooCluster?.count).toBe(2);

    const betaCluster = host?.children.get("beta");
    expect(betaCluster?.tabs.map((tab) => tab.id)).toEqual([3]);
  });

  it("excludes pinned tabs when requested", () => {
    const tabs: TabSummary[] = [
      baseTab({ id: 1, pinned: true }),
      baseTab({ id: 2, pinned: false }),
    ];

    const model = buildTabModel(tabs, { excludePinned: true });
    expect(model.count).toBe(1);
    expect([...model.ids]).toEqual([2]);
  });

  it("applies search filtering", () => {
    const tabs: TabSummary[] = [
      baseTab({ id: 1, url: "https://example.com/project/alpha", title: "Alpha" }),
      baseTab({ id: 2, url: "https://example.com/project/beta", title: "Beta" }),
    ];

    const model = buildTabModel(tabs, { filter: "beta" });
    expect(model.count).toBe(1);
    const host = model.children.get("example.com");
    expect(host?.count).toBe(1);
    expect(host?.children.get("project")?.count).toBe(1);
  });

  it("normalizes URLs by default", () => {
    const tabs: TabSummary[] = [
      baseTab({
        id: 1,
        url: "https://example.com/path/?utm_source=newsletter",
      }),
      baseTab({
        id: 2,
        url: "https://example.com/path/",
      }),
    ];

    const model = buildTabModel(tabs);
    const host = model.children.get("example.com");
    expect(host?.count).toBe(2);
    expect(host?.children.size).toBe(1);
    expect(host?.children.get("path")?.count).toBe(2);
  });
});
