import { buildSubpath, deriveClusterKey, normalizeUrl, shouldIgnoreUrl, tryParseUrl } from "../utils/url.js";
import { createClusterNode, createHostNode, createRootNode } from "./nodeFactory.js";
import type { BuildOptions, RootNode, TabSummary } from "./types.js";

export function buildTabModel(
  tabs: readonly TabSummary[],
  { excludePinned = true, normalize = true, filter = "" }: BuildOptions = {}
): RootNode {
  const root = createRootNode();
  const query = filter.trim().toLowerCase();

  for (const tab of tabs) {
    if (excludePinned && tab.pinned) continue;
    if (!tab.url || shouldIgnoreUrl(tab.url)) continue;

    const candidateUrl = normalize ? normalizeUrl(tab.url) : tab.url;
    const parsedUrl = tryParseUrl(candidateUrl);
    if (!parsedUrl) continue;

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

export type { BuildOptions, RootNode };
