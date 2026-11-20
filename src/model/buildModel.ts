import { buildSubpath, deriveClusterKey, normalizeUrl, shouldIgnoreUrl, tryParseUrl } from "../utils/url.js";
import { createClusterNode, createHostNode, createRootNode } from "./nodeFactory.js";
import type { BuildOptions, RootNode, TabSummary } from "./types.js";

/**
 * Consumes the raw tab list, filters out unwanted entries, and aggregates the remainder
 * into a hierarchical Root → Host → Cluster structure that the renderer expects.
 */
export function buildTabModel(
  tabs: readonly TabSummary[],
  { excludePinned = true, filter = "" }: BuildOptions = {}
): RootNode {
  const root = createRootNode();
  const query = filter.trim().toLowerCase();
  const now = Date.now();

  for (const tab of tabs) {
    if (excludePinned && tab.pinned) continue;
    if (!tab.url || shouldIgnoreUrl(tab.url)) continue;

    const normalizedUrl = normalizeUrl(tab.url);
    const parsedUrl = tryParseUrl(normalizedUrl);
    if (!parsedUrl) continue;
    // Host-less schemes (file:, data:, view-source:, javascript:, blob:) all parse with
    // an empty host and would produce an unnamed host card that sorts first in A→Z
    // (audit finding F-4). Skip them, like the other excluded schemes.
    if (!parsedUrl.host) continue;

    const haystack = `${parsedUrl.host} ${parsedUrl.pathname} ${tab.title ?? ""}`.toLowerCase();
    if (query && !haystack.includes(query)) continue;

    const hostNode = getOrCreate(root.children, parsedUrl.host, () => createHostNode(parsedUrl.host));
    const clusterKey = deriveClusterKey(parsedUrl);
    const clusterNode = getOrCreate(hostNode.children, clusterKey.key, () =>
      createClusterNode(clusterKey.key)
    );

    clusterNode.tabs.push({
      id: tab.id,
      title: tab.title || parsedUrl.href,
      url: tab.url,
      favIconUrl: tab.favIconUrl || "",
      subpath: buildSubpath(clusterKey.remainder),
      pinned: tab.pinned,
      windowId: tab.windowId,
      // Missing lastAccessed (stubs/fixtures) reads as "accessed now", never stale.
      lastAccessed: tab.lastAccessed ?? now,
      active: tab.active ?? false,
      groupId: tab.groupId ?? null,
      cookieStoreId: tab.cookieStoreId || "firefox-default",
    });

    clusterNode.ids.add(tab.id);
    hostNode.ids.add(tab.id);
    root.ids.add(tab.id);
  }

  finalizeCounts(root);
  return root;
}

/**
 * Retrieves an entry from a map, creating and storing it with the provided factory when
 * the key is unseen. Keeps the model construction concise while avoiding duplicate nodes.
 */
function getOrCreate<K, V>(collection: Map<K, V>, key: K, factory: () => V): V {
  const existing = collection.get(key);
  if (existing) {
    return existing;
  }
  const created = factory();
  collection.set(key, created);
  return created;
}

/**
 * Computes the aggregate counts for each node after tab assignment so the UI can display
 * accurate badges without repeating the traversal on every render.
 */
function finalizeCounts(root: RootNode): void {
  for (const hostNode of root.children.values()) {
    for (const cluster of hostNode.children.values()) {
      cluster.count = cluster.tabs.length;
    }
    hostNode.count = hostNode.ids.size;
  }
  root.count = root.ids.size;
}

export type { BuildOptions, RootNode };
