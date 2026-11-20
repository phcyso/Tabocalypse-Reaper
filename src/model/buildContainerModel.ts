import { createClusterNode, createHostNode, createRootNode } from "./nodeFactory.js";
import type { BuildOptions, ContainerInfo, RootNode, TabSummary } from "./types.js";
import { DEFAULT_CONTAINER } from "../browser/containers.js";

/** Pseudo-host grouping tabs that live in the default container. */
export const NO_CONTAINER_HOST_NAME = "(no container)";

/**
 * Builds a container-first tree (mirror of buildGroupModel): each Firefox
 * container becomes one top-level card, tabs in the default container collect
 * under a "(no container)" card. Container membership is explicit user intent
 * (privacy isolation), so host-less schemes (file:/about:) are NOT dropped —
 * what matters is where the user put the tab, not what the URL looks like.
 */
export function buildContainerModel(
  tabs: readonly TabSummary[],
  containers: ReadonlyMap<string, ContainerInfo>,
  { excludePinned = true, filter = "" }: BuildOptions = {}
): RootNode {
  const root = createRootNode();
  const query = filter.trim().toLowerCase();
  const now = Date.now();

  for (const tab of tabs) {
    if (excludePinned && tab.pinned) continue;
    if (!tab.url) continue;

    const cookieStoreId = tab.cookieStoreId || DEFAULT_CONTAINER;
    const container = containers.get(cookieStoreId);
    const isCustom = Boolean(container) && cookieStoreId !== DEFAULT_CONTAINER;
    const hostKey = isCustom ? `container:${cookieStoreId}` : "default";
    const hostName = isCustom ? container!.name : NO_CONTAINER_HOST_NAME;

    const haystack = `${hostName} ${tab.title ?? ""}`.toLowerCase();
    if (query && !haystack.includes(query)) continue;

    const hostNode = getOrCreate(root.children, hostKey, () => createHostNode(hostName));
    // One cluster per container host; "/" hides the condensed cluster label.
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
      groupId: tab.groupId ?? null,
      cookieStoreId,
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
