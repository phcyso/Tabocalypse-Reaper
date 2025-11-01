import { activateTab, closeTab, closeTabs } from "../browser/tabs.js";
import { CONFIRM_THRESHOLD } from "../shared/constants.js";
import { requireDescendant, requireElement } from "./query.js";
import type { ClusterNode, HostNode, RootNode } from "../model/index.js";

export interface RenderContext {
  onRefresh: () => Promise<void>;
}

/**
 * Rebuilds the popup tree from scratch by cloning templates for each host and cluster.
 * The function keeps the DOM shallow (host → cluster → tab) and wires refresh callbacks
 * so bulk operations rehydrate the model after browser mutations.
 */
export function renderTree(root: RootNode, context: RenderContext): void {
  const tree = requireElement<HTMLElement>("#tree");
  tree.replaceChildren();

  const stats = requireElement<HTMLElement>("#stats");
  stats.textContent = formatStats(root.count);

  const hostTemplate = requireElement<HTMLTemplateElement>("#hostTemplate");
  const clusterTemplate = requireElement<HTMLTemplateElement>("#clusterTemplate");
  const tabTemplate = requireElement<HTMLTemplateElement>("#tabTemplate");

  const hosts = sortHostsByCount(root.children.values());
  for (const host of hosts) {
    const fragment = hostTemplate.content.cloneNode(true) as DocumentFragment;
    decorateHost(fragment, host, context, clusterTemplate, tabTemplate);
    tree.append(fragment);
  }
}

/**
 * Populates a host template fragment with counts, expand/collapse behaviour, and
 * bulk-close wiring before rendering the host's clusters.
 */
function decorateHost(
  fragment: DocumentFragment,
  host: HostNode,
  context: RenderContext,
  clusterTemplate: HTMLTemplateElement,
  tabTemplate: HTMLTemplateElement
): void {
  const header = requireDescendant<HTMLElement>(fragment, ".hostHeader");
  const name = requireDescendant<HTMLElement>(fragment, ".hostName");
  const badge = requireDescendant<HTMLElement>(fragment, ".badge");
  const twisty = requireDescendant<HTMLElement>(fragment, ".twisty");
  const closeButton = requireDescendant<HTMLButtonElement>(fragment, ".close");
  const body = requireDescendant<HTMLElement>(fragment, ".hostBody");
  const icon = requireDescendant<HTMLImageElement>(fragment, ".hostIco");

  name.textContent = host.name;
  badge.textContent = String(host.count);
  body.hidden = true;
  header.setAttribute("aria-expanded", "false");
  iconToggle(icon, findHostFavicon(host));

  const toggle = () => toggleSection(body, twisty, header);

  closeButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!confirmBulkClose(host.count, `Reap ${host.count} tabs under “${host.name}”?`)) {
      return;
    }

    try {
      await closeTabs([...host.ids]);
    } catch (error) {
      console.error(error);
    }
    await context.onRefresh();
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

  const clusters = sortClustersByCount(host.children.values());
  const bodyContainer = body;
  for (const cluster of clusters) {
    const clusterFragment = clusterTemplate.content.cloneNode(true) as DocumentFragment;
    decorateCluster(clusterFragment, host, cluster, context, tabTemplate);
    bodyContainer.append(clusterFragment);
  }
}

/**
 * Populates a cluster template fragment, attaching handlers for toggling visibility
 * and closing every tab in the cluster while deferring to the shared refresh hook.
 */
function decorateCluster(
  fragment: DocumentFragment,
  host: HostNode,
  cluster: ClusterNode,
  context: RenderContext,
  tabTemplate: HTMLTemplateElement
): void {
  const header = requireDescendant<HTMLElement>(fragment, ".clusterHeader");
  const name = requireDescendant<HTMLElement>(fragment, ".clusterName");
  const badge = requireDescendant<HTMLElement>(fragment, ".badge");
  const twisty = requireDescendant<HTMLElement>(fragment, ".twisty");
  const closeButton = requireDescendant<HTMLButtonElement>(fragment, ".close");
  const body = requireDescendant<HTMLElement>(fragment, ".clusterBody");
  const icon = requireDescendant<HTMLImageElement>(fragment, ".clusterIco");

  name.textContent = cluster.name;
  badge.textContent = String(cluster.count);
  body.hidden = true;
  header.setAttribute("aria-expanded", "false");
  iconToggle(icon, cluster.tabs[0]?.favIconUrl ?? "");

  const toggle = () => toggleSection(body, twisty, header);

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
    }
    await context.onRefresh();
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

  const tabList = document.createElement("div");
  const tabs = [...cluster.tabs].sort((a, b) => a.title.localeCompare(b.title));

  for (const tab of tabs) {
    const tabFragment = tabTemplate.content.cloneNode(true) as DocumentFragment;
    decorateTab(tabFragment, tab, context);
    tabList.append(tabFragment);
  }

  body.append(tabList);
}

/**
 * Hydrates the tab template with URL details and wires click handlers that either close
 * the specific tab or activate it in the current window without leaving the popup.
 */
function decorateTab(fragment: DocumentFragment, tab: ClusterNode["tabs"][number], context: RenderContext): void {
  const closeButton = requireDescendant<HTMLButtonElement>(fragment, ".x");
  const anchor = requireDescendant<HTMLAnchorElement>(fragment, ".title");
  const icon = requireDescendant<HTMLImageElement>(fragment, ".ico");
  const path = requireDescendant<HTMLSpanElement>(fragment, ".path");

  anchor.textContent = tab.title;
  anchor.href = tab.url;
  path.textContent = tab.subpath;
  iconToggle(icon, tab.favIconUrl);

  closeButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await closeTab(tab.id);
    } catch (error) {
      console.error(error);
    }
    await context.onRefresh();
  });

  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    void activateTab(tab.id);
  });
}

function iconToggle(element: HTMLImageElement, url: string): void {
  if (url) {
    element.src = url;
  } else {
    element.removeAttribute("src");
  }
}

/**
 * Toggles a collapsible section and keeps the twisty glyph and ARIA attributes in sync
 * so both keyboard and assistive technologies perceive the expansion state.
 */
function toggleSection(target: HTMLElement, twisty: HTMLElement, header: HTMLElement): void {
  target.hidden = !target.hidden;
  twisty.textContent = target.hidden ? "▸" : "▾";
  header.setAttribute("aria-expanded", target.hidden ? "false" : "true");
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

function sortHostsByCount(hosts: Iterable<HostNode>): HostNode[] {
  return [...hosts].sort(compareByCountDesc);
}

function sortClustersByCount(clusters: Iterable<ClusterNode>): ClusterNode[] {
  return [...clusters].sort(compareByCountDesc);
}

function compareByCountDesc<A extends Countable>(a: A, b: A): number {
  return b.count - a.count;
}

interface Countable {
  readonly count: number;
}
