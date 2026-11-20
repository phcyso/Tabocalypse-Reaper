import { activateTab, closeTab, closeTabs } from "../browser/tabs.js";
import type { ReapedTab } from "../browser/storage.js";
import { AUTO_COLLAPSE_HOST_COUNT, CONFIRM_THRESHOLD, STALE_MS } from "../shared/constants.js";
import { bulkReapIds, closableDuplicateIds, crossGroupDuplicateIds, duplicateGroupSizes } from "../model/index.js";
import type { ClusterNode, ClusterTab, EmptyStateReason, GroupInfo, HostNode, RootNode, SortMode } from "../model/index.js";
import { recordReap, undoLastReap } from "./reapUndo.js";
import { requireDescendant, requireElement } from "./query.js";
import { avatarHue, avatarLetter } from "../utils/avatar.js";
import { formatAge, isStale } from "../utils/age.js";
import { naturalCompare } from "../utils/naturalCompare.js";

interface RenderState {
  expandedHosts: Set<string>;
  expandedClusters: Map<string, Set<string>>;
  currentRoot: RootNode | null;
  sortMode: SortMode | null;
  sortStale: boolean;
  /** Filter text from the last renderTree, reused by the incremental empty state. */
  lastFilter: string | null;
}

const renderState: RenderState = {
  expandedHosts: new Set(),
  expandedClusters: new Map(),
  currentRoot: null,
  sortMode: null,
  sortStale: false,
  lastFilter: null,
};

export interface RenderContext {
  sortMode: SortMode;
  onRefresh: () => Promise<void>;
  /** Why the tree is empty (when root.count === 0); defaults to the generic message. */
  emptyState?: EmptyStateReason | null;
  /** Current filter text, quoted in the no-hits message. */
  filter?: string;
  /**
   * Model built from the same tab list without any filtering, so pruneExpandedState
   * can tell "absent because of the current filter" from "really closed" and keep the
   * user's expansion through filter round-trips (audit finding F-10).
   */
  universeRoot?: RootNode | null;
  /** Window the popup is docked to; rows from other windows get a "W2" chip (review F2). */
  focusedWindowId?: number;
  /** Whether the tab set spans multiple windows; defaults to "more than one window seen". */
  multiWindow?: boolean;
  /** Reference time for age chips/staleness (review F3); defaults to Date.now(). */
  now?: number;
  /** Firefox tab groups (FF 138+), keyed by groupId — powers group chips. */
  groupLabels?: Map<number, GroupInfo>;
  /** Total open tabs per groupId (unfiltered universe) — drives the
   * "last tab of group" warning in the confirm modal. */
  groupSizes?: Map<number, number>;
  /** "window" (default) or "all" — affects stats + empty-state copy. */
  scope?: "window" | "all";
  /** Tabs open in OTHER windows (empty-window state hint); scoped runs only. */
  otherWindowsCount?: number;
}

/** Per-render decorations shared by every level of the tree. */
interface TreeDecor {
  now: number;
  focusedWindowId: number;
  multiWindow: boolean;
  /** Stable W1/W2… labels per windowId, ordered by id. */
  windowLabels: Map<number, string>;
  /** Firefox tab groups (FF 138+), keyed by groupId — empty when unsupported. */
  groupLabels: Map<number, GroupInfo>;
}

/** Per-host precomputation: flat tab list, lookup by id, duplicate badges. */
interface HostKit {
  tabs: ClusterTab[];
  tabsById: Map<number, ClusterTab>;
  dupSizes: Map<number, number>;
  /** Duplicate copies that live in a different tab group: informational only. */
  crossGroupDupIds: Set<number>;
  closableDups: number[];
}

/** Human label for the staleness threshold, e.g. "24h". */
const STALE_LABEL = `${Math.round(STALE_MS / 3_600_000)}h`;

/**
 * Rebuilds the popup tree from scratch by cloning templates for each host and cluster.
 * The function keeps the DOM shallow (host → cluster → tab) and wires refresh callbacks
 * so bulk operations rehydrate the model after browser mutations.
 *
 * Single-tab hosts render as one compact row (no card chrome) — review A1; hosts with
 * several tabs keep their cards, collapsed by default.
 */
export function renderTree(root: RootNode, context: RenderContext): void {
  const firstRender = renderState.currentRoot === null;
  // At scale the list must open compact: auto-collapse everything when there are more
  // hosts than the threshold (review A1/F9). Only on open — mid-session expansions the
  // user made on purpose are kept afterwards.
  if (firstRender && root.children.size > AUTO_COLLAPSE_HOST_COUNT) {
    renderState.expandedHosts.clear();
    renderState.expandedClusters.clear();
  }

  renderState.currentRoot = root;
  renderState.sortMode = context.sortMode;
  renderState.lastFilter = context.filter ?? "";
  pruneExpandedState(context.universeRoot ?? root);
  clearSortStale();

  const windowLabels = buildWindowLabels(root);
  const decor: TreeDecor = {
    now: context.now ?? Date.now(),
    focusedWindowId: context.focusedWindowId ?? -1,
    multiWindow: context.multiWindow ?? windowLabels.size > 1,
    windowLabels,
    groupLabels: context.groupLabels ?? new Map(),
  };

  const tree = requireElement<HTMLElement>("#tree");
  tree.replaceChildren();

  const stats = requireElement<HTMLElement>("#stats");
  stats.textContent = formatStats(root.count);

  if (root.count === 0) {
    tree.append(
      buildEmptyStateNode(context.emptyState ?? "no-tabs", context.filter ?? "", context)
    );
    return;
  }

  const hostTemplate = requireElement<HTMLTemplateElement>("#hostTemplate");
  const clusterTemplate = requireElement<HTMLTemplateElement>("#clusterTemplate");
  const tabTemplate = requireElement<HTMLTemplateElement>("#tabTemplate");
  const soloTemplate = requireElement<HTMLTemplateElement>("#soloTemplate");

  const hosts = sortHosts([...root.children.entries()], context.sortMode);
  for (const [hostKey, host] of hosts) {
    if (host.count === 1) {
      // Compact single-tab host: one row, favicon + host + title + ✕ (review A1).
      const fragment = soloTemplate.content.cloneNode(true) as DocumentFragment;
      decorateSolo(fragment, hostKey, host, context, decor);
      tree.append(fragment);
      continue;
    }
    const fragment = hostTemplate.content.cloneNode(true) as DocumentFragment;
    decorateHost(fragment, hostKey, host, context, decor, clusterTemplate, tabTemplate);
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
  decor: TreeDecor,
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
  const iconFallback = requireDescendant<HTMLElement>(fragment, ".hostIcoFallback");
  const pinChip = requireDescendant<HTMLElement>(fragment, ".pinChip");
  const winChip = requireDescendant<HTMLElement>(fragment, ".winChip");
  const staleButton = requireDescendant<HTMLButtonElement>(fragment, ".staleButton");
  const dupButton = requireDescendant<HTMLButtonElement>(fragment, ".dupButton");

  const kit = buildHostKit(host);

  hostCard.dataset.hostKey = hostKey;
  name.textContent = host.name;
  name.title = host.name;
  badge.textContent = String(host.count);
  applyFavicon(icon, iconFallback, findHostFavicon(host), host.name);
  decoratePinChip(pinChip, kit.tabs);
  decorateGroupWindowChip(winChip, kit.tabs, decor);

  const clusterEntries = [...host.children.entries()];
  const hasSingleCluster = clusterEntries.length === 1;
  const shouldExpand = renderState.expandedHosts.has(hostKey);
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

  const reapIds = bulkReapIds(host);
  const pinnedCount = kit.tabs.filter((tab) => tab.pinned).length;
  if (reapIds.length === 0) {
    closeButton.disabled = true;
    closeButton.title = "All pinned — nothing to reap";
  } else if (pinnedCount > 0) {
    closeButton.title = `Closes ${reapIds.length} · pinned survive`;
  }

  guardCloseButton(
    closeButton,
    async () => {
      if (reapIds.length === 0) {
        closeButton.disabled = false;
        return;
      }
      if (
        !(await confirmBulkClose({
          count: reapIds.length,
          title: `Reap ${reapIds.length} tabs under “${host.name}”?`,
          meta: pinnedCount > 0 ? `${pinnedCount} pinned tab${pinnedCount === 1 ? "" : "s"} survive.` : undefined,
          tabs: reapIds
            .map((id) => kit.tabsById.get(id))
            .filter((tab): tab is ClusterTab => Boolean(tab)),
          warnings: groupRemovalWarnings(reapIds, kit, context),
        }))
      ) {
        closeButton.disabled = false;
        return;
      }

      try {
        await closeTabs(reapIds);
      } catch (error) {
        console.error(error);
        closeButton.disabled = false;
        await context.onRefresh();
        return;
      }

      await recordReap(toSweepTabs(reapIds, kit), () => undoLastReap(context.onRefresh));

      if (reapIds.length === host.ids.size) {
        handleHostRemoval(hostKey, host, hostCard);
      } else {
        // Pinned tabs survive the reap: rebuild from live state instead of ripping the
        // card out incrementally.
        await context.onRefresh();
      }
    },
    { suppressDoubleClicks: true }
  );

  // "Reap stale": closes only tabs untouched for longer than STALE_MS, pinned ones
  // survive exactly like the plain Reap (review F3). Partial by nature → full refresh.
  const staleTabs = kit.tabs.filter((tab) => !tab.pinned && isStale(tab.lastAccessed, decor.now));
  if (staleTabs.length > 0) {
    staleButton.hidden = false;
    staleButton.title = `Close ${staleTabs.length} tabs older than ${STALE_LABEL} · pinned survive`;
    guardCloseButton(
      staleButton,
      async () => {
        const staleIds = staleTabs.map((tab) => tab.id);
        if (
          !(await confirmBulkClose({
            count: staleIds.length,
            title: `Reap ${staleIds.length} stale tabs under “${host.name}”?`,
            meta: `Older than ${STALE_LABEL} · pinned survive.`,
            listLabel: `Stale tabs (older than ${STALE_LABEL})`,
            tabs: staleTabs,
          }))
        ) {
          staleButton.disabled = false;
          return;
        }
        try {
          await closeTabs(staleIds);
        } catch (error) {
          console.error(error);
          staleButton.disabled = false;
          await context.onRefresh();
          return;
        }
        await recordReap(toSweepTabs(staleIds, kit), () => undoLastReap(context.onRefresh));
        await context.onRefresh();
      },
      { suppressDoubleClicks: true }
    );
  }

  // "Close dups": keeps the newest (or active) copy of every duplicate group in the
  // host and closes the rest; pinned copies always survive (review F8).
  if (kit.closableDups.length > 0) {
    dupButton.hidden = false;
    dupButton.title = `Close ${kit.closableDups.length} duplicate tabs — keeps newest copy · pinned survive`;
    guardCloseButton(
      dupButton,
      async () => {
        const dupIds = kit.closableDups;
        if (
          !(await confirmBulkClose({
            count: dupIds.length,
            title: `Close ${dupIds.length} duplicate tabs under “${host.name}”?`,
            meta: "Newest copies stay.",
            listLabel: "Duplicate tabs being closed",
            tabs: dupIds
              .map((id) => kit.tabsById.get(id))
              .filter((tab): tab is ClusterTab => Boolean(tab)),
          }))
        ) {
          dupButton.disabled = false;
          return;
        }
        try {
          await closeTabs(dupIds);
        } catch (error) {
          console.error(error);
          dupButton.disabled = false;
          await context.onRefresh();
          return;
        }
        await recordReap(toSweepTabs(dupIds, kit), () => undoLastReap(context.onRefresh));
        await context.onRefresh();
      },
      { suppressDoubleClicks: true }
    );
  }

  header.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest(".close, .staleButton, .dupButton")) {
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

  if (hasSingleCluster && readyClusters.length === 1) {
    const [clusterKey, cluster] = readyClusters[0]!;
    const clusterFragment = clusterTemplate.content.cloneNode(true) as DocumentFragment;
    decorateCluster(
      clusterFragment,
      hostKey,
      host,
      clusterKey,
      cluster,
      context,
      decor,
      kit,
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
        decor,
        kit,
        badge,
        tabTemplate
      );
      body.append(clusterFragment);
    }
  }
}

/**
 * Renders a single-tab host as ONE compact row: favicon + host + title inline + ✕,
 * no card chrome (review A1). Clicking the title activates the tab; ✕ closes it
 * (explicit single action — allowed even when pinned, like every per-tab ✕).
 */
function decorateSolo(
  fragment: DocumentFragment,
  hostKey: string,
  host: HostNode,
  context: RenderContext,
  decor: TreeDecor
): void {
  const row = requireDescendant<HTMLElement>(fragment, ".soloRow");
  const icon = requireDescendant<HTMLImageElement>(fragment, ".soloIco");
  const iconFallback = requireDescendant<HTMLElement>(fragment, ".soloIcoFallback");
  const hostName = requireDescendant<HTMLElement>(fragment, ".soloHost");
  const anchor = requireDescendant<HTMLAnchorElement>(fragment, ".soloTitle");
  const path = requireDescendant<HTMLSpanElement>(fragment, ".path");
  const ageChip = requireDescendant<HTMLElement>(fragment, ".ageChip");
  const winChip = requireDescendant<HTMLElement>(fragment, ".winChip");
  const closeButton = requireDescendant<HTMLButtonElement>(fragment, ".x");
  // Optional decoration: older fixtures may not carry a groupChip span.
  const groupChip = fragment.querySelector<HTMLElement>(".groupChip");

  const tab = firstHostTab(host);
  if (!tab) {
    row.remove();
    return;
  }

  row.dataset.hostKey = hostKey;
  hostName.textContent = host.name;
  hostName.title = host.name;
  anchor.textContent = tab.title;
  anchor.href = tab.url;
  anchor.title = tab.title;
  path.textContent = tab.subpath;
  applyFavicon(icon, iconFallback, tab.favIconUrl, host.name);

  if (tab.pinned) {
    row.classList.add("pinnedTab");
    anchor.title = "Pinned tab";
  }

  applyAgeChip(ageChip, tab, decor);
  applyRowWindowChip(winChip, tab, decor);
  applyGroupChip(groupChip, tab.groupId, decor);

  guardCloseButton(closeButton, async () => {
    // Optimistic close, same rationale as the per-tab ✕ above: the whole host
    // row disappears instantly, and a failed close resyncs via onRefresh.
    handleHostRemoval(hostKey, host, row);
    try {
      await closeTab(tab.id);
    } catch (error) {
      console.error(error);
      await context.onRefresh();
      return;
    }
  });

  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    void activateTab(tab.id)
      .then(() => window.close())
      .catch((error) => console.error("Failed to activate tab", error));
  });
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
  decor: TreeDecor,
  kit: HostKit,
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
  const iconFallback = requireDescendant<HTMLElement>(fragment, ".clusterIcoFallback");
  const pinChip = requireDescendant<HTMLElement>(fragment, ".pinChip");
  const dupChip = requireDescendant<HTMLElement>(fragment, ".dupChip");

  clusterElement.dataset.hostKey = hostKey;
  clusterElement.dataset.clusterKey = clusterKey;
  name.textContent = cluster.name;
  name.title = cluster.name;
  badge.textContent = String(cluster.count);
  applyFavicon(icon, iconFallback, cluster.tabs[0]?.favIconUrl ?? "", host.name);
  decoratePinChip(pinChip, cluster.tabs);

  // Duplicate groups live inside one cluster (same normalized URL ⇒ same cluster
  // key), so cluster-level dup badges are exact (review F8).
  const clusterClosableDups = closableDuplicateIds(cluster.tabs);
  if (clusterClosableDups.length > 0) {
    dupChip.hidden = false;
    dupChip.textContent = `⧉ ${clusterClosableDups.length}`;
    dupChip.title = `${clusterClosableDups.length} duplicate tabs closable — newest copy stays`;
  }

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
    const reapIds = bulkReapIds(cluster);
    const pinnedCount = cluster.tabs.filter((tab) => tab.pinned).length;
    if (reapIds.length === 0) {
      closeButton.disabled = true;
      closeButton.title = "All pinned — nothing to reap";
    } else if (pinnedCount > 0) {
      closeButton.title = `Closes ${reapIds.length} · pinned survive`;
    }

    guardCloseButton(
      closeButton,
      async () => {
        if (reapIds.length === 0) {
          closeButton.disabled = false;
          return;
        }
        if (
          !(await confirmBulkClose({
            count: reapIds.length,
            title: `Reap ${reapIds.length} tabs under “${host.name} / ${cluster.name}”?`,
            meta: pinnedCount > 0 ? `${pinnedCount} pinned tab${pinnedCount === 1 ? "" : "s"} survive.` : undefined,
            tabs: reapIds
              .map((id) => kit.tabsById.get(id))
              .filter((tab): tab is ClusterTab => Boolean(tab)),
            warnings: groupRemovalWarnings(reapIds, kit, context),
          }))
        ) {
          closeButton.disabled = false;
          return;
        }

        try {
          await closeTabs(reapIds);
        } catch (error) {
          console.error(error);
          closeButton.disabled = false;
          await context.onRefresh();
          return;
        }

        await recordReap(toSweepTabs(reapIds, kit), () => undoLastReap(context.onRefresh));

        if (reapIds.length === cluster.ids.size) {
          handleClusterRemoval(hostKey, host, clusterKey, cluster, clusterElement, hostBadge);
        } else {
          await context.onRefresh();
        }
      },
      { suppressDoubleClicks: true }
    );

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
  const tabs = [...cluster.tabs].sort((a, b) => naturalCompare(a.title, b.title));

  // Condensed single-cluster hosts show their one cluster's label once above the rows
  // instead of repeating it as a tag on every row (audit finding F-16).
  if (condensed && cluster.name && cluster.name !== "/") {
    const label = document.createElement("div");
    label.classList.add("clusterLabel");
    label.textContent = cluster.name;
    body.append(label);
  }

  for (const tab of tabs) {
    const tabFragment = tabTemplate.content.cloneNode(true) as DocumentFragment;
    decorateTab(tabFragment, hostKey, host, clusterKey, cluster, tab, hostBadge, badge, context, decor, kit);
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
  tab: ClusterTab,
  hostBadge: HTMLElement,
  clusterBadge: HTMLElement | null,
  context: RenderContext,
  decor: TreeDecor,
  kit: HostKit
): void {
  const tabElement = requireDescendant<HTMLElement>(fragment, ".tab");
  const closeButton = requireDescendant<HTMLButtonElement>(fragment, ".x");
  const anchor = requireDescendant<HTMLAnchorElement>(fragment, ".title");
  const icon = requireDescendant<HTMLImageElement>(fragment, ".ico");
  const iconFallback = requireDescendant<HTMLElement>(fragment, ".tabIcoFallback");
  const path = requireDescendant<HTMLSpanElement>(fragment, ".path");
  const ageChip = requireDescendant<HTMLElement>(fragment, ".ageChip");
  const winChip = requireDescendant<HTMLElement>(fragment, ".winChip");
  const dupChip = requireDescendant<HTMLElement>(fragment, ".dupChip");
  // Optional decoration: older fixtures may not carry a groupChip span.
  const groupChip = fragment.querySelector<HTMLElement>(".groupChip");

  anchor.textContent = tab.title;
  anchor.href = tab.url;
  path.textContent = tab.subpath;
  applyFavicon(icon, iconFallback, tab.favIconUrl, host.name);

  if (tab.pinned) {
    tabElement.classList.add("pinnedTab");
    anchor.title = "Pinned tab";
  }

  applyAgeChip(ageChip, tab, decor);
  applyRowWindowChip(winChip, tab, decor);

  const dupSize = kit.dupSizes.get(tab.id);
  if (dupSize && dupSize > 1 && kit.crossGroupDupIds.has(tab.id)) {
    // Same page deliberately open in another tab group: inform, never suggest.
    dupChip.hidden = false;
    dupChip.textContent = `∑${dupSize}`;
    dupChip.title = "Copies of this page are open in different tab groups — kept intentionally";
    dupChip.classList.add("crossGroupDup");
  } else if (dupSize && dupSize > 1) {
    dupChip.hidden = false;
    dupChip.textContent = `×${dupSize}`;
    dupChip.title = `${dupSize} open copies of this page`;
    dupChip.classList.remove("crossGroupDup");
  }

  applyGroupChip(groupChip, tab.groupId, decor);

  guardCloseButton(closeButton, async () => {
    // Optimistic close (user feedback 2026-11: the API roundtrip + full refresh
    // made ✕ feel laggy at 100+ tabs): drop the row and cascade the model NOW,
    // then persist. On failure the full refresh resyncs the visible state.
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
    try {
      await closeTab(tab.id);
    } catch (error) {
      console.error(error);
      await context.onRefresh();
      return;
    }
  });

  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    void activateTab(tab.id)
      .then(() => window.close())
      .catch((error) => console.error("Failed to activate tab", error));
  });
}

/**
 * Guards destructive close buttons against rapid double-clicks (audit finding F-1).
 *
 * Three layers:
 * 1. The clicked button is disabled from click until its close settles (re-enabled on
 *    failure/cancel).
 * 2. A module-level flag suppresses ALL close clicks while one is in flight.
 * 3. Reap buttons additionally get a short position/time window that suppresses a click
 *    arriving right after a settled close at (nearly) the same pointer position — the
 *    double-click's second press lands after the DOM has re-flowed, i.e. on whatever row
 *    shifted up under the cursor, and must be swallowed even though it targets a
 *    different, enabled button. Per-tab ✕ opts out of this gate on purpose: draining a
 *    cluster means rapid same-position ✕ clicks, and a shifted mis-click there costs a
 *    single tab, not a whole group (documented in the F-1 annotation).
 */
const DOUBLE_CLICK_SUPPRESS_MS = 400;
const DOUBLE_CLICK_SUPPRESS_RADIUS_PX = 8;

let closeInFlight = false;
let lastAcceptedCloseClick: { x: number; y: number; time: number } | null = null;

export function resetCloseGuardForTests(): void {
  closeInFlight = false;
  lastAcceptedCloseClick = null;
}

function isSuppressedAsDoubleClick(event: MouseEvent): boolean {
  const last = lastAcceptedCloseClick;
  if (!last) {
    return false;
  }
  if (performance.now() - last.time >= DOUBLE_CLICK_SUPPRESS_MS) {
    return false;
  }
  const distance = Math.hypot(event.clientX - last.x, event.clientY - last.y);
  return distance <= DOUBLE_CLICK_SUPPRESS_RADIUS_PX;
}

function guardCloseButton(
  button: HTMLButtonElement,
  action: () => Promise<void>,
  options: { suppressDoubleClicks?: boolean } = {}
): void {
  const { suppressDoubleClicks = false } = options;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (
      button.disabled ||
      closeInFlight ||
      (suppressDoubleClicks && isSuppressedAsDoubleClick(event))
    ) {
      return;
    }
    lastAcceptedCloseClick = { x: event.clientX, y: event.clientY, time: performance.now() };
    button.disabled = true;
    closeInFlight = true;
    void action().finally(() => {
      closeInFlight = false;
    });
  });
}

/**
 * Builds the friendly message shown instead of a blank tree when nothing matches,
 * pointing at the control that hides the tabs (audit finding F-7).
 */
function buildEmptyStateNode(
  reason: EmptyStateReason,
  filter: string,
  context?: Pick<RenderContext, "otherWindowsCount">
): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "emptyState";

  const headline = document.createElement("div");
  headline.className = "emptyStateHeadline";
  const hint = document.createElement("div");
  hint.className = "small";

  switch (reason) {
    case "pinned-hidden":
      headline.textContent = "Everything is pinned";
      hint.textContent =
        "All open tabs are pinned and hidden by “Exclude pinned”. Uncheck it above to show them.";
      break;
    case "no-filter-hits":
      headline.textContent = "No tabs match";
      hint.textContent = `Nothing matches “${filter}”. Clear the filter to see every tab.`;
      break;
    case "empty-window": {
      const others = context?.otherWindowsCount ?? 0;
      headline.textContent = "Nothing in this window";
      hint.textContent =
        others > 0
          ? `${others} tab${others === 1 ? "" : "s"} ${others === 1 ? "is" : "are"} open in other windows — tick “All windows” above to include them.`
          : "There are no tabs to manage right now.";
      break;
    }
    default:
      headline.textContent = "All clear";
      hint.textContent = "There are no tabs to manage right now.";
  }

  empty.append(headline, hint);
  return empty;
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

  if (root.count === 0) {
    // The last card went away through incremental updates; renderTree never runs in
    // that path, so show the empty state here instead of leaving a blank void
    // (audit finding F-7). Nothing is left to re-sort either, so skip the stale hint.
    const tree = requireElement<HTMLElement>("#tree");
    tree.replaceChildren();
    tree.append(buildEmptyStateNode("no-tabs", renderState.lastFilter ?? ""));
    return;
  }

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
  // Locate the ancestor cluster BEFORE detaching the tab row: a removed element has
  // no ancestors, so closest() would return null and the cascade below would never
  // run, leaving zombie host/cluster cards behind (audit finding F-2).
  const root = renderState.currentRoot;
  const clusterElement = tabElement.closest<HTMLElement>(".cluster");
  tabElement.remove();

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

/** Approximations of Firefox's tabGroups.Color palette for group chips. */
const GROUP_COLORS: Record<string, string> = {
  blue: "#31a5e7",
  cyan: "#3bb8c9",
  green: "#54a437",
  purple: "#a858e0",
  red: "#e05a68",
  yellow: "#d9a207",
  orange: "#ec7f2d",
  pink: "#e56ba5",
};

function groupColorHex(color: string | null | undefined): string {
  return GROUP_COLORS[color ?? ""] ?? "var(--accent)";
}

/** Chip naming the Firefox tab group a row belongs to (colored dot + name). */
function applyGroupChip(
  chip: HTMLElement | null,
  groupId: number | null | undefined,
  decor: TreeDecor
): void {
  if (!chip) {
    return;
  }
  if (groupId == null || !decor.groupLabels.has(groupId)) {
    chip.hidden = true;
    chip.textContent = "";
    return;
  }
  const info = decor.groupLabels.get(groupId)!;
  chip.hidden = false;
  chip.textContent = info.name || `Group ${groupId}`;
  chip.title = `In tab group ${info.name || `#${groupId}`}`;
  chip.style.setProperty("--group-color", groupColorHex(info.color));
}

/** Favicon with themed letter-avatar fallback: tinted tile in a deterministic hue
 * derived from the hostname (review A3) — no more glaring white squares in dark
 * themes. Pure hue/letter helpers live in utils/avatar.ts. */
function applyFavicon(
  icon: HTMLImageElement,
  fallback: HTMLElement,
  url: string,
  seedHost: string
): void {
  if (url) {
    icon.src = url;
    icon.hidden = false;
    fallback.hidden = true;
    return;
  }
  icon.removeAttribute("src");
  icon.hidden = true;
  fallback.hidden = false;
  fallback.textContent = avatarLetter(seedHost);
  fallback.style.setProperty("--avatar-hue", String(avatarHue(seedHost)));
}

/** "📌 N" chip on host/cluster headers when the group contains pinned tabs (review A11). */
function decoratePinChip(pinChip: HTMLElement, tabs: readonly ClusterTab[]): void {
  const pinnedCount = tabs.filter((tab) => tab.pinned).length;
  if (pinnedCount === 0) {
    return;
  }
  pinChip.hidden = false;
  pinChip.textContent = `📌 ${pinnedCount}`;
  pinChip.title = `${pinnedCount} pinned tab${pinnedCount === 1 ? "" : "s"} — pinned tabs survive Reap`;
}

/** "⧉ N" chip on host headers whose tabs span several windows (review F2). */
function decorateGroupWindowChip(
  winChip: HTMLElement,
  tabs: readonly ClusterTab[],
  decor: TreeDecor
): void {
  if (!decor.multiWindow) {
    return;
  }
  const windows = new Set(tabs.map((tab) => tab.windowId));
  if (windows.size <= 1) {
    return;
  }
  winChip.hidden = false;
  winChip.textContent = `⧉ ${windows.size}`;
  winChip.title = `Tabs across ${windows.size} windows`;
}

/** Relative-age chip on tab rows, e.g. "3h" / "2d" (review F3). */
function applyAgeChip(ageChip: HTMLElement, tab: ClusterTab, decor: TreeDecor): void {
  const label = formatAge(decor.now - tab.lastAccessed);
  if (!label) {
    return;
  }
  ageChip.hidden = false;
  ageChip.textContent = label;
  ageChip.title = `Last visited ${label} ago`;
}

/** "W2" chip on rows living in a non-focused window (review F2). */
function applyRowWindowChip(winChip: HTMLElement, tab: ClusterTab, decor: TreeDecor): void {
  if (!decor.multiWindow || tab.windowId === decor.focusedWindowId) {
    return;
  }
  const label = decor.windowLabels.get(tab.windowId);
  if (!label) {
    return;
  }
  winChip.hidden = false;
  winChip.textContent = label;
  winChip.title = `Tab in window ${label.replace("W", "#")}`;
}

/** Flattens a host's tabs and precomputes duplicate metadata for the render. */
function buildHostKit(host: HostNode): HostKit {
  const tabs = [...host.children.values()].flatMap((cluster) => cluster.tabs);
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  return {
    tabs,
    tabsById,
    dupSizes: duplicateGroupSizes(tabs),
    crossGroupDupIds: new Set(crossGroupDuplicateIds(tabs)),
    closableDups: closableDuplicateIds(tabs),
  };
}

/** Undo sweep metadata for the given IDs, looked up from the host's tabs. */
function toSweepTabs(ids: readonly number[], kit: HostKit): ReapedTab[] {
  const sweep: ReapedTab[] = [];
  for (const id of ids) {
    const tab = kit.tabsById.get(id);
    if (tab) {
      sweep.push({
        url: tab.url,
        title: tab.title,
        pinned: tab.pinned,
        windowId: tab.windowId,
        groupId: tab.groupId,
      });
    }
  }
  return sweep;
}

function firstHostTab(host: HostNode): ClusterTab | null {
  for (const cluster of host.children.values()) {
    const tab = cluster.tabs[0];
    if (tab) {
      return tab;
    }
  }
  return null;
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
  // The pill IS a refresh button — swapping it for the plain Refresh keeps the
  // toolbar from overflowing when both would show (review A9).
  const refresh = document.getElementById("refresh");
  if (refresh) {
    refresh.hidden = true;
  }
}

/**
 * Flags the visible order as outdated when tabs change while the popup is open
 * (review A9) — wired to tabs.onUpdated/onRemoved by popup.ts. The next render
 * (Refresh or any full refresh path) clears it again.
 */
export function notifyTabsChanged(): void {
  markSortStale();
}

function clearSortStale(): void {
  renderState.sortStale = false;
  const hint = document.getElementById("refreshHint");
  if (hint) {
    hint.hidden = true;
  }
  const refresh = document.getElementById("refresh");
  if (refresh) {
    refresh.hidden = false;
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

/** Danger notes for the confirm modal: warns when a reap would close a tab
 * group's last member (Firefox removes the group in that case). */
function groupRemovalWarnings(
  closingIds: readonly number[],
  kit: HostKit,
  context: RenderContext
): string[] {
  const sizes = context.groupSizes;
  if (!sizes || sizes.size === 0) {
    return [];
  }
  const closing = new Map<number, number>();
  for (const id of closingIds) {
    const gid = kit.tabsById.get(id)?.groupId ?? null;
    if (typeof gid === "number") {
      closing.set(gid, (closing.get(gid) ?? 0) + 1);
    }
  }
  const warnings: string[] = [];
  for (const [gid, count] of closing) {
    if (sizes.get(gid) === count) {
      const info = context.groupLabels?.get(gid);
      const name = info?.name || `#${gid}`;
      warnings.push(`Includes the last tab of group \u201c${name}\u201d \u2014 the group will be removed.`);
    }
  }
  return warnings;
}

function isToggleKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar" || key === "Space";
}

function formatStats(count: number): string {
  return `${count} tab${count === 1 ? "" : "s"} matched`;
}

/**
 * Guard potentially destructive actions with a confirmation dialog whenever the
 * close request exceeds the user-visible threshold. The dialog is an in-popup
 * themed modal (not native confirm()) so it can show WHICH tabs are about to
 * close — user feedback 2026-11.
 */
interface ConfirmCloseOptions {
  count: number;
  title: string;
  /** Secondary line, e.g. "Pinned tabs survive." */
  meta?: string;
  /** The tabs being closed — the dialog previews up to PREVIEW_LIMIT titles. */
  tabs?: ClusterTab[];
  /** Override for the list heading; defaults to "Tabs being closed". */
  listLabel?: string;
  /** Danger notes shown under the meta line, e.g. group-removal warnings. */
  warnings?: string[];
}

const PREVIEW_LIMIT = 8;

async function confirmBulkClose(options: ConfirmCloseOptions): Promise<boolean> {
  if (options.count < CONFIRM_THRESHOLD) {
    return true;
  }
  return showConfirmDialog(options);
}

function showConfirmDialog(options: ConfirmCloseOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirmOverlay";

    const card = document.createElement("div");
    card.className = "confirmCard";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "confirmTitle");

    const title = document.createElement("div");
    title.id = "confirmTitle";
    title.className = "confirmTitle";
    title.textContent = options.title;

    const meta = document.createElement("div");
    meta.className = "confirmMeta small";
    meta.textContent =
      options.meta ?? `${options.count} tab${options.count === 1 ? "" : "s"} will be closed.`;

    card.append(title, meta);
    for (const warning of options.warnings ?? []) {
      const line = document.createElement("div");
      line.className = "confirmWarning small";
      line.textContent = `\u26a0 ${warning}`;
      card.append(line);
    }

    const tabs = options.tabs ?? [];
    if (tabs.length > 0) {
      const label = document.createElement("div");
      label.className = "confirmListLabel small";
      label.textContent = options.listLabel ?? "Tabs being closed";
      card.append(label);

      const list = document.createElement("ul");
      list.className = "confirmList";
      const preview = tabs.slice(0, PREVIEW_LIMIT);
      for (const tab of preview) {
        const item = document.createElement("li");
        item.textContent = (tab.pinned ? "📌 " : "") + tab.title;
        item.title = tab.url;
        list.append(item);
      }
      if (tabs.length > preview.length) {
        const more = document.createElement("li");
        more.className = "small";
        more.textContent = `… and ${tabs.length - preview.length} more`;
        list.append(more);
      }
      card.append(list);
    }

    const actions = document.createElement("div");
    actions.className = "confirmActions";
    const cancel = document.createElement("button");
    cancel.className = "confirmCancel";
    cancel.textContent = "Cancel";
    const ok = document.createElement("button");
    ok.className = "confirmOk";
    ok.textContent = `Reap ${options.count}`;
    actions.append(cancel, ok);
    card.append(actions);

    const finish = (result: boolean) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(result);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      }
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        finish(false);
      }
    });
    cancel.addEventListener("click", () => finish(false));
    ok.addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKey, true);

    overlay.append(card);
    document.body.append(overlay);
    ok.focus();
  });
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

/** Stable W1/W2… labels for every window seen in the model, ordered by window id. */
function buildWindowLabels(root: RootNode): Map<number, string> {
  const windowIds = new Set<number>();
  for (const host of root.children.values()) {
    for (const cluster of host.children.values()) {
      for (const tab of cluster.tabs) {
        windowIds.add(tab.windowId);
      }
    }
  }
  return new Map(
    [...windowIds].sort((a, b) => a - b).map((id, index) => [id, `W${index + 1}`])
  );
}

/** Oldest last access in a group; drives the "Recently stale first" sort (review F3). */
function oldestAccess(tabs: readonly ClusterTab[]): number {
  return tabs.reduce((oldest, tab) => Math.min(oldest, tab.lastAccessed), Number.MAX_SAFE_INTEGER);
}

function sortHosts(hosts: [string, HostNode][], sortMode: SortMode): [string, HostNode][] {
  return hosts.sort((a, b) => {
    if (sortMode === "alpha") {
      return a[1].name.localeCompare(b[1].name);
    }
    if (sortMode === "stale") {
      const diff = oldestAccess(collectTabs(a[1])) - oldestAccess(collectTabs(b[1]));
      if (diff !== 0) {
        return diff;
      }
    } else {
      const diff = b[1].count - a[1].count;
      if (diff !== 0) {
        return diff;
      }
    }
    // Equal counts (or equal staleness): deterministic A→Z tie-break (review A8).
    return a[1].name.localeCompare(b[1].name);
  });
}

function sortClusters(
  clusters: [string, ClusterNode][],
  sortMode: SortMode
): [string, ClusterNode][] {
  return clusters.sort((a, b) => {
    if (sortMode === "alpha") {
      return a[1].name.localeCompare(b[1].name);
    }
    if (sortMode === "stale") {
      const diff = oldestAccess(a[1].tabs) - oldestAccess(b[1].tabs);
      if (diff !== 0) {
        return diff;
      }
    } else {
      const diff = b[1].count - a[1].count;
      if (diff !== 0) {
        return diff;
      }
    }
    return a[1].name.localeCompare(b[1].name);
  });
}

function collectTabs(host: HostNode): ClusterTab[] {
  return [...host.children.values()].flatMap((cluster) => cluster.tabs);
}
