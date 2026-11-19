import { describe, expect, it } from "vitest";

import { buildTabModel, bulkReapIds, describeEmptyState, type TabSummary } from "../src/model";

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

  it("never creates an unnamed host for host-less schemes (audit F-4)", () => {
    const hostLessUrls = [
      "file:///home/example/notes.txt",
      "data:text/html,hello",
      "view-source:https://example.com/page",
      "javascript:void 0",
      "blob:https://example.com/9f8b1e2a",
    ];

    for (const url of hostLessUrls) {
      const model = buildTabModel([baseTab({ id: 1, url })], { excludePinned: false });
      expect(model.count, url).toBe(0);
      expect(model.children.has(""), url).toBe(false);
      expect(model.children.size, url).toBe(0);
    }
  });

  it("keeps ordinary hosts alongside skipped host-less tabs", () => {
    const tabs: TabSummary[] = [
      baseTab({ id: 1, url: "file:///tmp/fixture.html" }),
      baseTab({ id: 2, url: "https://example.com/real" }),
    ];

    const model = buildTabModel(tabs, { excludePinned: false });
    expect([...model.children.keys()]).toEqual(["example.com"]);
    expect(model.count).toBe(1);
  });

  it("carries pinned into ClusterTab and excludes pins from bulk-reap IDs (audit F-5)", () => {
    const tabs: TabSummary[] = [
      baseTab({ id: 1, url: "https://example.com/one/a", pinned: true }),
      baseTab({ id: 2, url: "https://example.com/one/b" }),
      baseTab({ id: 3, url: "https://example.com/two/c", pinned: true }),
      baseTab({ id: 4, url: "https://example.com/two/d" }),
    ];

    const model = buildTabModel(tabs, { excludePinned: false });
    const host = model.children.get("example.com");
    expect(host).toBeDefined();

    const one = host!.children.get("one");
    expect(one?.tabs.find((tab) => tab.id === 1)?.pinned).toBe(true);
    expect(one?.tabs.find((tab) => tab.id === 2)?.pinned).toBe(false);

    expect(bulkReapIds(one!)).toEqual([2]);
    expect([...bulkReapIds(host!)].sort()).toEqual([2, 4]);
  });

  it("composes an empty reap list when every tab in the group is pinned", () => {
    const tabs: TabSummary[] = [
      baseTab({ id: 1, url: "https://example.com/one/a", pinned: true }),
      baseTab({ id: 2, url: "https://example.com/one/b", pinned: true }),
    ];

    const model = buildTabModel(tabs, { excludePinned: false });
    const host = model.children.get("example.com");
    expect(host?.count).toBe(2);
    expect(bulkReapIds(host!)).toEqual([]);
  });
});

describe("describeEmptyState (audit F-7)", () => {
  const baseTab = (overrides: Partial<TabSummary> = {}): TabSummary => ({
    id: overrides.id ?? Math.floor(Math.random() * 10_000),
    url: overrides.url ?? "https://example.com/alpha",
    title: overrides.title ?? "Example",
    pinned: overrides.pinned ?? false,
    windowId: overrides.windowId ?? 1,
    favIconUrl: overrides.favIconUrl ?? "",
  });

  it("reports pinned-hidden when the pinned filter hides every tab", () => {
    const tabs: TabSummary[] = [baseTab({ id: 1, pinned: true })];
    expect(describeEmptyState(tabs, { excludePinned: true })).toBe("pinned-hidden");
    expect(describeEmptyState(tabs, { excludePinned: false })).toBe("no-filter-hits");
  });

  it("reports no-filter-hits when tabs exist but the filter matches none", () => {
    const tabs: TabSummary[] = [baseTab({ id: 1 })];
    expect(describeEmptyState(tabs, { excludePinned: true, filter: "*" })).toBe(
      "no-filter-hits"
    );
  });

  it("reports no-tabs when nothing relevant is open", () => {
    expect(describeEmptyState([], { excludePinned: true })).toBe("no-tabs");
  });
});
