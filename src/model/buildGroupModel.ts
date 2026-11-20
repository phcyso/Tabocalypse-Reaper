import { createClusterNode, createHostNode, createRootNode } from "./nodeFactory.js";
import type { BuildOptions, GroupInfo, RootNode, TabSummary } from "./types.js";

/** Pseudo-host grouping tabs that live in no Firefox tab group. */
export const UNGROUPED_HOST_NAME = "(no group)";

/**
 * Builds a group-first tree: each Firefox tab group becomes one top-level card
 * (its tabs inside as rows), with tabs that live in no group collected under a
 * "(no group)" card so nothing becomes unmanageable (design note §4d).
 *
 * Unlike buildTabModel this intentionally does NOT drop host-less schemes
 * (file:/about:) or run URL clustering — group membership is explicit user
 * organization, so it wins over host heuristics. Filter + pinned handling match
 * buildTabModel.
 */
export function buildGroupModel(
  tabs: readonly TabSummary[],
  groups: ReadonlyMap<number, GroupInfo>,
  { excludePinned = true, filter = "" }: BuildOptions = {}
): RootNode {
  const root = createRootNode();
  const query = filter.trim().toLowerCase();
  const now = Date.now();

  for (const tab of tabs) {
    if (excludePinned && tab.pinned) continue;
    if (!tab.url) continue;

    const grouped = typeof tab.groupId === "number" && groups.has(tab.groupId);
    const group = grouped ? groups.get(tab.groupId!) : undefined;
    const hostKey = grouped ? `group:${tab.groupId}` : "ungrouped";
    const hostName = grouped ? group!.name || `Group ${tab.groupId}` : UNGROUPED_HOST_NAME;

    const haystack = `${hostName} ${tab.title ?? ""}`.toLowerCase();
    if (query && !haystack.includes(query)) continue;

    const hostNode = getOrCreate(root.children, hostKey, () => createHostNode(hostName));
    // One cluster per group host; name "/" hides the condensed cluster label.
    const clusterKey = "/";
    const clusterNode = getOrCreate(hostNode.children, clusterKey, () =>
      createClusterNode(clusterKey)
    );

    let subpath = "";
    try {
      subpath = new URL(tab.url).host || "";
    } catch {
      subpath = "";
    }

    clusterNode.tabs.push({
      id: tab.id,
      title: tab.title || tab.url,
      url: tab.url,
      favIconUrl: tab.favIconUrl || "",
      subpath,
      pinned: tab.pinned,
      windowId: tab.windowId,
      lastAccessed: tab.lastAccessed ?? now,
      active: tab.active ?? false,
      groupId: grouped ? tab.groupId! : null,
    });

    clusterNode.ids.add(tab.id);
    hostNode.ids.add(tab.id);
    root.ids.add(tab.id);
  }

  finalizeCounts(root);
  return root;
}

function getOrCreate<K, V>(collection: Map<K, V>, key: K, factory: () => V): V {
  const existing = collection.get(key);
  if (existing) {
    return existing;
  }
  const created = factory();
  collection.set(key, created);
  return created;
}

function finalizeCounts(root: RootNode): void {
  for (const hostNode of root.children.values()) {
    for (const cluster of hostNode.children.values()) {
      cluster.count = cluster.tabs.length;
    }
    hostNode.count = hostNode.ids.size;
  }
  root.count = root.ids.size;
}
