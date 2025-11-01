import { activateTab, closeTab, closeTabs } from "../browser/tabs.js";
import { CONFIRM_THRESHOLD } from "../shared/constants.js";
import { requireDescendant, requireElement } from "./query.js";
import type { ClusterNode, HostNode, RootNode, SortMode } from "../model/index.js";

interface RenderState {
  expandedHosts: Set<string>;
  expandedClusters: Map<string, Set<string>>;
  currentRoot: RootNode | null;
  sortMode: SortMode | null;
  sortStale: boolean;
}

const renderState: RenderState = {
  expandedHosts: new Set(),
  expandedClusters: new Map(),
  currentRoot: null,
  sortMode: null,
  sortStale: false,
};

export interface RenderContext {
  sortMode: SortMode;
  onRefresh: () => Promise<void>;
}

interface TabRenderOptions {
  inlineClusterLabel?: string | null;
}

/**
 * Rebuilds the popup tree from scratch by cloning templates for each host and cluster.
 * The function keeps the DOM shallow (host → cluster → tab) and wires refresh callbacks
 * so bulk operations rehydrate the model after browser mutations.
 */
export function renderTree(root: RootNode, context: RenderContext): void {
  renderState.currentRoot = root;
  renderState.sortMode = context.sortMode;
  pruneExpandedState(root);
  clearSortStale();

  const tree = requireElement<HTMLElement>("#tree");
  tree.replaceChildren();

  const stats = requireElement<HTMLElement>("#stats");
  stats.textContent = formatStats(root.count);

  const hostTemplate = requireElement<HTMLTemplateElement>("#hostTemplate");
  const clusterTemplate = requireElement<HTMLTemplateElement>("#clusterTemplate");
  const tabTemplate = requireElement<HTMLTemplateElement>("#tabTemplate");

  const hosts = sortHosts([...root.children.entries()], context.sortMode);
  for (const [hostKey, host] of hosts) {
    const fragment = hostTemplate.content.cloneNode(true) as DocumentFragment;
    decorateHost(fragment, hostKey, host, context, clusterTemplate, tabTemplate);
    tree.append(fragment);
  }
}

/**
 * Populates a host template fragment with counts, expand/collapse behaviour, and
 * bulk-close wiring before rendering the host's clusters.
 */
function decorateHost(
  fragment: DocumentFragment,
  hostKey: string,
  host: HostNode,
  context: RenderContext,
  clusterTemplate: HTMLTemplateElement,
  tabTemplate: HTMLTemplateElement
): void {
  const hostCard = requireDescendant<HTMLElement>(fragment, ".hostCard");
  const header = requireDescendant<HTMLElement>(fragment, ".hostHeader");
  const name = requireDescendant<HTMLElement>(fragment, ".hostName");
  const badge = requireDescendant<HTMLElement>(fragment, ".badge");
  const twisty = requireDescendant<HTMLElement>(fragment, ".twisty");
  const closeButton = requireDescendant<HTMLButtonElement>(fragment, ".close");
  const body = requireDescendant<HTMLElement>(fragment, ".hostBody");
  const icon = requireDescendant<HTMLImageElement>(fragment, ".hostIco");

  hostCard.dataset.hostKey = hostKey;
  name.textContent = host.name;
  badge.textContent = String(host.count);
  iconToggle(icon, findHostFavicon(host));

  const clusterEntries = [...host.children.entries()];
  const hasSingleCluster = clusterEntries.length === 1;
  const hasSingleTab = host.count === 1;
  const shouldCondense = hasSingleCluster;
  const shouldExpand = hasSingleTab ? true : renderState.expandedHosts.has(hostKey);
  setSectionExpanded(body, twisty, header, shouldExpand);

  const toggle = () => {
    const currentExpanded = !body.hidden;
    const nextExpanded = !currentExpanded;
    setSectionExpanded(body, twisty, header, nextExpanded);
    if (nextExpanded) {
      renderState.expandedHosts.add(hostKey);
    } else {
      renderState.expandedHosts.delete(hostKey);
    }
  };

  closeButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!confirmBulkClose(host.count, `Reap ${host.count} tabs under “${host.name}”?`)) {
      return;
    }

    try {
      await closeTabs([...host.ids]);
    } catch (error) {
      console.error(error);
      await context.onRefresh();
      return;
    }

    handleHostRemoval(hostKey, host, hostCard);
  });

  header.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest(".close")) {
      return;
    }
    toggle();
  });

  header.addEventListener("keydown", (event) => {
    if (event.target !== header) {
      return;
    }

    if (isToggleKey(event.key)) {
      event.preventDefault();
      toggle();
    }
  });

  const readyClusters = sortClusters(clusterEntries, context.sortMode);

  if (shouldCondense && readyClusters.length === 1) {
    const [clusterKey, cluster] = readyClusters[0]!;
    const clusterFragment = clusterTemplate.content.cloneNode(true) as DocumentFragment;
    decorateCluster(
      clusterFragment,
      hostKey,
      host,
      clusterKey,
      cluster,
      context,
      badge,
      tabTemplate,
      { condensed: true }
    );
    body.append(clusterFragment);
  } else {
    for (const [clusterKey, cluster] of readyClusters) {
      const clusterFragment = clusterTemplate.content.cloneNode(true) as DocumentFragment;
      decorateCluster(
        clusterFragment,
        hostKey,
        host,
        clusterKey,
        cluster,
        context,
        badge,
        tabTemplate
      );
      body.append(clusterFragment);
    }
  }
}

/**
 * Populates a cluster template fragment, attaching handlers for toggling visibility
 * and closing every tab in the cluster while deferring to the shared refresh hook.
 */
function decorateCluster(
  fragment: DocumentFragment,
  hostKey: string,
  host: HostNode,
  clusterKey: string,
  cluster: ClusterNode,
  context: RenderContext,
  hostBadge: HTMLElement,
  tabTemplate: HTMLTemplateElement,
  options: { condensed?: boolean } = {}
): void {
  const { condensed = false } = options;
  const clusterElement = requireDescendant<HTMLElement>(fragment, ".cluster");
  const header = requireDescendant<HTMLElement>(fragment, ".clusterHeader");
  const name = requireDescendant<HTMLElement>(fragment, ".clusterName");
  const badge = requireDescendant<HTMLElement>(fragment, ".badge");
  const twisty = requireDescendant<HTMLElement>(fragment, ".twisty");
  const closeButton = requireDescendant<HTMLButtonElement>(fragment, ".close");
  const body = requireDescendant<HTMLElement>(fragment, ".clusterBody");
  const icon = requireDescendant<HTMLImageElement>(fragment, ".clusterIco");

  clusterElement.dataset.hostKey = hostKey;
  clusterElement.dataset.clusterKey = clusterKey;
  name.textContent = cluster.name;
  badge.textContent = String(cluster.count);
  iconToggle(icon, cluster.tabs[0]?.favIconUrl ?? "");

  const expandedClusterKeys = renderState.expandedClusters.get(hostKey);
  const shouldExpand = expandedClusterKeys?.has(clusterKey) ?? false;
  if (!condensed) {
    setSectionExpanded(body, twisty, header, shouldExpand);
  } else {
    clusterElement.classList.add("condensedCluster");
    header.classList.add("clusterHeaderHidden");
    closeButton.hidden = true;
    twisty.hidden = true;
    body.hidden = false;
  }

  const toggle = () => {
    const currentExpanded = !body.hidden;
    const nextExpanded = !currentExpanded;
    setSectionExpanded(body, twisty, header, nextExpanded);
    const clusterSet = ensureClusterExpansion(hostKey);
    if (nextExpanded) {
      clusterSet.add(clusterKey);
    } else {
      clusterSet.delete(clusterKey);
      if (clusterSet.size === 0) {
        renderState.expandedClusters.delete(hostKey);
      }
    }
  };

  if (!condensed) {
    closeButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (
        !confirmBulkClose(
          cluster.count,
          `Reap ${cluster.count} tabs under “${host.name} / ${cluster.name}”?`
        )
      ) {
        return;
      }

      try {
        await closeTabs([...cluster.ids]);
      } catch (error) {
        console.error(error);
        await context.onRefresh();
        return;
      }

      handleClusterRemoval(hostKey, host, clusterKey, cluster, clusterElement, hostBadge);
    });

    header.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest(".close")) {
        return;
      }
      toggle();
    });

    header.addEventListener("keydown", (event) => {
      if (event.target !== header) {
        return;
      }

      if (isToggleKey(event.key)) {
        event.preventDefault();
        toggle();
      }
    });
  }

  const tabList = document.createElement("div");
  const tabs = [...cluster.tabs].sort((a, b) => a.title.localeCompare(b.title));

  const hasClusterLabel = Boolean(cluster.name && cluster.name !== "/");
  const inlineClusterLabel = condensed && hasClusterLabel ? cluster.name : null;

  if (condensed && hasClusterLabel && !inlineClusterLabel) {
    const label = document.createElement("div");
    label.classList.add("clusterLabel");
    label.textContent = cluster.name;
    body.append(label);
  }

  for (const tab of tabs) {
    const tabFragment = tabTemplate.content.cloneNode(true) as DocumentFragment;
    decorateTab(
      tabFragment,
      hostKey,
      host,
      clusterKey,
      cluster,
      tab,
      hostBadge,
      badge,
      context,
      { inlineClusterLabel }
    );
    tabList.append(tabFragment);
  }

  body.append(tabList);
}

/**
 * Hydrates the tab template with URL details and wires click handlers that either close
 * the specific tab or activate it in the current window without leaving the popup.
 */
function decorateTab(
  fragment: DocumentFragment,
  hostKey: string,
  host: HostNode,
  clusterKey: string,
  cluster: ClusterNode,
  tab: ClusterNode["tabs"][number],
  hostBadge: HTMLElement,
  clusterBadge: HTMLElement | null,
  context: RenderContext,
  options: TabRenderOptions = {}
): void {
  const tabElement = requireDescendant<HTMLElement>(fragment, ".tab");
  const closeButton = requireDescendant<HTMLButtonElement>(fragment, ".x");
  const anchor = requireDescendant<HTMLAnchorElement>(fragment, ".title");
  const icon = requireDescendant<HTMLImageElement>(fragment, ".ico");
  const path = requireDescendant<HTMLSpanElement>(fragment, ".path");
  const clusterTag = requireDescendant<HTMLSpanElement>(fragment, ".clusterTag");

  anchor.textContent = tab.title;
  anchor.href = tab.url;
  path.textContent = tab.subpath;
  iconToggle(icon, tab.favIconUrl);

  const { inlineClusterLabel = null } = options;
  if (inlineClusterLabel) {
    clusterTag.hidden = false;
    clusterTag.textContent = inlineClusterLabel;
  } else {
    clusterTag.hidden = true;
    clusterTag.textContent = "";
  }

  closeButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await closeTab(tab.id);
    } catch (error) {
      console.error(error);
      await context.onRefresh();
      return;
    }

    handleTabRemoval(
      hostKey,
      host,
      clusterKey,
      cluster,
      tab,
      tabElement,
      hostBadge,
      clusterBadge
    );
  });

  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    void activateTab(tab.id);
  });
}

function handleHostRemoval(hostKey: string, host: HostNode, hostElement: HTMLElement): void {
  hostElement.remove();
  renderState.expandedHosts.delete(hostKey);
  renderState.expandedClusters.delete(hostKey);

  const root = renderState.currentRoot;
  if (!root) {
    return;
  }

  root.children.delete(hostKey);

  const removedIds = [...host.ids];
  for (const id of removedIds) {
    root.ids.delete(id);
  }

  const removedCount = removedIds.length;
  if (removedCount > 0) {
    root.count = Math.max(0, root.count - removedCount);
  }

  host.count = 0;
  host.ids.clear();
  host.children.clear();

  updateStatsDisplay();
  markSortStale();
}

function handleClusterRemoval(
  hostKey: string,
  host: HostNode,
  clusterKey: string,
  cluster: ClusterNode,
  clusterElement: HTMLElement,
  hostBadge: HTMLElement
): void {
  clusterElement.remove();

  const root = renderState.currentRoot;
  const removedIds = [...cluster.ids];

  for (const id of removedIds) {
    host.ids.delete(id);
    root?.ids.delete(id);
  }

  if (removedIds.length > 0) {
    host.count = Math.max(0, host.count - removedIds.length);
    if (root) {
      root.count = Math.max(0, root.count - removedIds.length);
    }
  }

  cluster.count = 0;
  cluster.ids.clear();
  cluster.tabs.length = 0;

  host.children.delete(clusterKey);

  const clusterSet = renderState.expandedClusters.get(hostKey);
  if (clusterSet) {
    clusterSet.delete(clusterKey);
    if (clusterSet.size === 0) {
      renderState.expandedClusters.delete(hostKey);
    }
  }

  if (root) {
    updateStatsDisplay();
  }

  const hostCard = hostBadge.closest<HTMLElement>(".hostCard");
  if (host.count === 0 && hostCard) {
    handleHostRemoval(hostKey, host, hostCard);
    return;
  }

  hostBadge.textContent = String(host.count);

  if (renderState.expandedHosts.has(hostKey) && hostCard) {
    const hostHeader = hostCard.querySelector<HTMLElement>(".hostHeader");
    const hostBody = hostCard.querySelector<HTMLElement>(".hostBody");
    const hostTwisty = hostHeader?.querySelector<HTMLElement>(".twisty");
    if (hostHeader && hostBody && hostTwisty) {
      setSectionExpanded(hostBody, hostTwisty, hostHeader, true);
    }
  }

  markSortStale();
}

function handleTabRemoval(
  hostKey: string,
  host: HostNode,
  clusterKey: string,
  cluster: ClusterNode,
  tab: ClusterNode["tabs"][number],
  tabElement: HTMLElement,
  hostBadge: HTMLElement,
  clusterBadge: HTMLElement | null
): void {
  tabElement.remove();

  const root = renderState.currentRoot;
  const clusterElement = tabElement.closest<HTMLElement>(".cluster");

  const tabIndex = cluster.tabs.findIndex((candidate) => candidate.id === tab.id);
  if (tabIndex !== -1) {
    cluster.tabs.splice(tabIndex, 1);
  }

  if (cluster.ids.has(tab.id)) {
    cluster.ids.delete(tab.id);
  }
  if (cluster.count > 0) {
    cluster.count -= 1;
  }

  if (host.ids.has(tab.id)) {
    host.ids.delete(tab.id);
  }
  if (host.count > 0) {
    host.count -= 1;
  }

  if (root) {
    if (root.ids.has(tab.id)) {
      root.ids.delete(tab.id);
    }
    if (root.count > 0) {
      root.count -= 1;
    }
    updateStatsDisplay();
  }

  if (clusterBadge) {
    clusterBadge.textContent = String(cluster.count);
  }
  hostBadge.textContent = String(host.count);

  if (
    clusterElement &&
    renderState.expandedClusters.get(hostKey)?.has(clusterKey)
  ) {
    const clusterHeader = clusterElement.querySelector<HTMLElement>(".clusterHeader");
    const clusterBody = clusterElement.querySelector<HTMLElement>(".clusterBody");
    const clusterTwisty = clusterHeader?.querySelector<HTMLElement>(".twisty");
    if (clusterHeader && clusterBody && clusterTwisty) {
      setSectionExpanded(clusterBody, clusterTwisty, clusterHeader, true);
    }
  }

  if (renderState.expandedHosts.has(hostKey)) {
    const hostCard = hostBadge.closest<HTMLElement>(".hostCard");
    const hostHeader = hostCard?.querySelector<HTMLElement>(".hostHeader");
    const hostBody = hostCard?.querySelector<HTMLElement>(".hostBody");
    const hostTwisty = hostHeader?.querySelector<HTMLElement>(".twisty");
    if (hostHeader && hostBody && hostTwisty) {
      setSectionExpanded(hostBody, hostTwisty, hostHeader, true);
    }
  }

  if (cluster.count === 0) {
    if (clusterElement) {
      handleClusterRemoval(hostKey, host, clusterKey, cluster, clusterElement, hostBadge);
    }
    return;
  }

  markSortStale();
}

function iconToggle(element: HTMLImageElement, url: string): void {
  if (url) {
    element.src = url;
  } else {
    element.removeAttribute("src");
  }
}

function setSectionExpanded(
  target: HTMLElement,
  twisty: HTMLElement,
  header: HTMLElement,
  expanded: boolean
): void {
  target.hidden = !expanded;
  twisty.textContent = expanded ? "▾" : "▸";
  header.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function ensureClusterExpansion(hostKey: string): Set<string> {
  let clusterSet = renderState.expandedClusters.get(hostKey);
  if (!clusterSet) {
    clusterSet = new Set<string>();
    renderState.expandedClusters.set(hostKey, clusterSet);
  }
  return clusterSet;
}

function pruneExpandedState(root: RootNode): void {
  for (const hostKey of [...renderState.expandedHosts]) {
    if (!root.children.has(hostKey)) {
      renderState.expandedHosts.delete(hostKey);
    }
  }

  for (const [hostKey, clusterSet] of [...renderState.expandedClusters.entries()]) {
    const host = root.children.get(hostKey);
    if (!host) {
      renderState.expandedClusters.delete(hostKey);
      continue;
    }

    for (const clusterKey of [...clusterSet]) {
      if (!host.children.has(clusterKey)) {
        clusterSet.delete(clusterKey);
      }
    }

    if (clusterSet.size === 0) {
      renderState.expandedClusters.delete(hostKey);
    }
  }
}

function markSortStale(): void {
  if (renderState.sortStale) {
    return;
  }
  renderState.sortStale = true;
  const hint = document.getElementById("refreshHint");
  if (hint) {
    hint.hidden = false;
  }
}

function clearSortStale(): void {
  renderState.sortStale = false;
  const hint = document.getElementById("refreshHint");
  if (hint) {
    hint.hidden = true;
  }
}

function updateStatsDisplay(): void {
  const root = renderState.currentRoot;
  if (!root) {
    return;
  }
  const stats = requireElement<HTMLElement>("#stats");
  stats.textContent = formatStats(root.count);
}

function isToggleKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar" || key === "Space";
}

function formatStats(count: number): string {
  return `${count} tab${count === 1 ? "" : "s"} matched`;
}

/**
 * Guard potentially destructive actions with a confirmation dialog whenever the close
 * request exceeds the user-visible threshold.
 */
function confirmBulkClose(count: number, message: string): boolean {
  if (count < CONFIRM_THRESHOLD) {
    return true;
  }
  return confirm(message);
}

/**
 * Returns the first favicon found within a host by checking each cluster until one
 * yields an icon URL. Falls back to an empty string so the caller clears the <img>.
 */
function findHostFavicon(host: HostNode): string {
  for (const cluster of host.children.values()) {
    const favicon = cluster.tabs[0]?.favIconUrl;
    if (favicon) {
      return favicon;
    }
  }
  return "";
}

function sortHosts(hosts: [string, HostNode][], sortMode: SortMode): [string, HostNode][] {
  return hosts.sort((a, b) =>
    sortMode === "alpha"
      ? a[1].name.localeCompare(b[1].name)
      : b[1].count - a[1].count
  );
}

function sortClusters(
  clusters: [string, ClusterNode][],
  sortMode: SortMode
): [string, ClusterNode][] {
  return clusters.sort((a, b) =>
    sortMode === "alpha"
      ? a[1].name.localeCompare(b[1].name)
      : b[1].count - a[1].count
  );
}
