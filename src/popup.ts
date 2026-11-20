import { queryFocusedWindowId, queryOpenTabs } from "./browser/tabs.js";
import { queryGroupInfos, tabGroupsSupported } from "./browser/tabGroups.js";
import { containersSupported, queryContainerInfos } from "./browser/containers.js";
import { loadUiPrefs, saveUiPrefs } from "./browser/storage.js";
import { renderTree, notifyTabsChanged } from "./dom/render.js";
import { showReapToast, undoLastReap } from "./dom/reapUndo.js";
import { requireElement } from "./dom/query.js";
import { buildContainerModel, buildGroupModel, buildTabModel, describeEmptyState } from "./model/index.js";
import type { ContainerInfo, GroupInfo, SortMode } from "./model/index.js";
import { debounce } from "./utils/debounce.js";
import { applyThemeFromBrowser } from "./theme/applyTheme.js";

/**
 * Monotonically increasing token: if a newer refresh started while an older one was
 * awaiting `queryOpenTabs`, the older one must not render its stale result over the
 * newer state (audit finding F-9).
 */
let refreshToken = 0;

/** Firefox 138+: tab groups API available (feature-detected once). */
const groupsSupported = tabGroupsSupported();

async function refresh(): Promise<void> {
  const token = ++refreshToken;
  const [excludePinned, filter, sortMode, allWindows] = readUiState();
  const focusedWindowId = await queryFocusedWindowId();
  if (token !== refreshToken) {
    return;
  }
  // Default UX scopes the popup to the window it was opened from (user
  // feedback 2026-11); "All windows" restores the legacy cross-window view.
  const tabs = await queryOpenTabs(allWindows ? undefined : { windowId: focusedWindowId });
  if (token !== refreshToken) {
    return;
  }

  const groupLabels: Map<number, GroupInfo> = groupsSupported
    ? await queryGroupInfos()
    : new Map();
  const containerLabels: Map<string, ContainerInfo> = containersSupported()
    ? await queryContainerInfos()
    : new Map();
  const groupSizes = new Map<number, number>();
  for (const tab of tabs) {
    if (typeof tab.groupId === "number") {
      groupSizes.set(tab.groupId, (groupSizes.get(tab.groupId) ?? 0) + 1);
    }
  }

  const modelOptions = { excludePinned, filter };
  const groupView = sortMode === "group" && groupsSupported;
  const containerView = sortMode === "container" && containersSupported();
  const model = groupView
    ? buildGroupModel(tabs, groupLabels, modelOptions)
    : containerView
      ? buildContainerModel(tabs, containerLabels, modelOptions)
      : buildTabModel(tabs, modelOptions);
  const universeOptions = { excludePinned: false, filter: "" };
  const universeRoot = groupView
    ? buildGroupModel(tabs, groupLabels, universeOptions)
    : containerView
      ? buildContainerModel(tabs, containerLabels, universeOptions)
      : buildTabModel(tabs, universeOptions);

  let emptyState = model.count === 0 ? describeEmptyState(tabs, { excludePinned }) : null;
  let otherWindowsCount: number | undefined;
  if (!allWindows && model.count === 0 && emptyState === "no-tabs") {
    // Scoped and empty: tell the user how much lives in other windows instead
    // of a bare "all clear".
    const everyTab = await queryOpenTabs();
    if (token !== refreshToken) {
      return;
    }
    otherWindowsCount = Math.max(0, everyTab.length - tabs.length);
    if (otherWindowsCount > 0) {
      emptyState = "empty-window";
    }
  }

  const windowIds = new Set(tabs.map((tab) => tab.windowId));
  renderTree(model, {
    sortMode,
    onRefresh: refresh,
    emptyState,
    filter,
    universeRoot,
    focusedWindowId,
    // Cross-window chips only make sense in the all-windows view.
    multiWindow: allWindows && windowIds.size > 1,
    now: Date.now(),
    groupLabels,
    groupSizes,
    containerLabels,
    scope: allWindows ? "all" : "window",
    otherWindowsCount,
  });
}

function readUiState(): [boolean, string, SortMode, boolean] {
  const excludePinned = requireElement<HTMLInputElement>("#excludePinned").checked;
  const filter = requireElement<HTMLInputElement>("#search").value;
  const sortSelect = requireElement<HTMLSelectElement>("#sort");
  const allWindows = requireElement<HTMLInputElement>("#allWindows").checked;
  return [excludePinned, filter, coerceSortMode(sortSelect.value), allWindows];
}

function coerceSortMode(value: string): SortMode {
  return value === "alpha" || value === "stale" || value === "group" || value === "container"
    ? value
    : "count";
}

const SEARCH_DEBOUNCE_MS = 140;

function wireInteractionHandlers(): void {
  const debouncedSearchRefresh = debounce(() => {
    void refresh();
  }, SEARCH_DEBOUNCE_MS);

  requireElement<HTMLButtonElement>("#refresh").addEventListener("click", () => {
    void refresh();
  });

  // The stale-order pill is a button too: clicking it does the obvious thing (A9).
  requireElement<HTMLElement>("#refreshHint").addEventListener("click", () => {
    void refresh();
  });

  requireElement<HTMLInputElement>("#search").addEventListener("input", () => {
    debouncedSearchRefresh();
  });

  requireElement<HTMLInputElement>("#excludePinned").addEventListener("change", () => {
    persistUiPrefs();
    void refresh();
  });

  requireElement<HTMLInputElement>("#allWindows").addEventListener("change", () => {
    persistUiPrefs();
    void refresh();
  });

  requireElement<HTMLSelectElement>("#sort").addEventListener("change", () => {
    persistUiPrefs();
    void refresh();
  });

  // "/" focuses the filter from anywhere in the popup (review A10/A7-hotkey).
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }
    event.preventDefault();
    requireElement<HTMLInputElement>("#search").focus();
  });
}

/**
 * Tabs mutating while the popup is open make the visible order outdated — surface
 * the "Sort outdated" pill (review A9). Full refreshes clear it on re-render.
 */
function wireTabChangeListeners(): void {
  try {
    browser.tabs.onUpdated.addListener(notifyTabsChanged);
    browser.tabs.onRemoved.addListener(notifyTabsChanged);
    browser.tabs.onCreated?.addListener(notifyTabsChanged);
  } catch (error) {
    console.error("Failed to watch tab changes", error);
  }
}

/** Persists sort + pinned filter for the session (audit finding F-11); filter text is
 * intentionally session-only and never stored. */
function persistUiPrefs(): void {
  const sortSelect = requireElement<HTMLSelectElement>("#sort");
  const excludePinned = requireElement<HTMLInputElement>("#excludePinned").checked;
  const allWindows = requireElement<HTMLInputElement>("#allWindows").checked;
  void saveUiPrefs({ sort: coerceSortMode(sortSelect.value), excludePinned, allWindows });
}

/** Applies stored UI choices before the first refresh so the popup opens as left. */
async function restoreUiPrefs(): Promise<void> {
  const prefs = await loadUiPrefs();
  if (prefs.sort) {
    requireElement<HTMLSelectElement>("#sort").value = prefs.sort;
  }
  if (typeof prefs.excludePinned === "boolean") {
    requireElement<HTMLInputElement>("#excludePinned").checked = prefs.excludePinned;
  }
  if (typeof prefs.allWindows === "boolean") {
    requireElement<HTMLInputElement>("#allWindows").checked = prefs.allWindows;
  }
}

/**
 * Adds the "Sort: By tab group" option when this Firefox supports the
 * tabGroups API (138+). Must run BEFORE restoreUiPrefs so a saved "group"
 * sort can apply.
 */
function addGroupSortOption(): void {
  if (!tabGroupsSupported()) {
    return;
  }
  const sortSelect = requireElement<HTMLSelectElement>("#sort");
  const option = document.createElement("option");
  option.value = "group";
  option.textContent = "Sort: By tab group";
  sortSelect.append(option);
}

/** Adds "Sort: By container" when custom containers are defined (FF 53+ API). */
async function addContainerSortOption(): Promise<void> {
  if (!containersSupported()) {
    return;
  }
  const labels = await queryContainerInfos();
  if (labels.size === 0) {
    return;
  }
  const sortSelect = requireElement<HTMLSelectElement>("#sort");
  const option = document.createElement("option");
  option.value = "container";
  option.textContent = "Sort: By container";
  sortSelect.append(option);
}

/**
 * A sweep reaped earlier this session (popup closed before the toast lapsed) still
 * deserves its Undo: resurrect the toast on open (review F1).
 */
async function restoreUndoToast(): Promise<void> {
  const { loadLastSweep } = await import("./browser/storage.js");
  const sweep = await loadLastSweep();
  if (sweep) {
    showReapToast(sweep.tabs.length, () => undoLastReap(refresh));
  }
}

async function init(): Promise<void> {
  await applyThemeFromBrowser();
  addGroupSortOption();
  await addContainerSortOption();
  await restoreUiPrefs();
  wireInteractionHandlers();
  wireTabChangeListeners();
  await refresh();
  await restoreUndoToast();
}

document.addEventListener("DOMContentLoaded", () => {
  void init();
});
