import { queryFocusedWindowId, queryOpenTabs } from "./browser/tabs.js";
import { loadUiPrefs, saveUiPrefs } from "./browser/storage.js";
import { renderTree, notifyTabsChanged } from "./dom/render.js";
import { showReapToast, undoLastReap } from "./dom/reapUndo.js";
import { requireElement } from "./dom/query.js";
import { buildTabModel, describeEmptyState } from "./model/index.js";
import type { SortMode } from "./model/index.js";
import { debounce } from "./utils/debounce.js";
import { applyThemeFromBrowser } from "./theme/applyTheme.js";

/**
 * Monotonically increasing token: if a newer refresh started while an older one was
 * awaiting `queryOpenTabs`, the older one must not render its stale result over the
 * newer state (audit finding F-9).
 */
let refreshToken = 0;

async function refresh(): Promise<void> {
  const token = ++refreshToken;
  const [excludePinned, filter, sortMode] = readUiState();
  const [tabs, focusedWindowId] = await Promise.all([queryOpenTabs(), queryFocusedWindowId()]);
  if (token !== refreshToken) {
    return;
  }
  const model = buildTabModel(tabs, { excludePinned, filter });
  const universeRoot = buildTabModel(tabs, { excludePinned: false });
  const windowIds = new Set(tabs.map((tab) => tab.windowId));
  renderTree(model, {
    sortMode,
    onRefresh: refresh,
    emptyState:
      model.count === 0 ? describeEmptyState(tabs, { excludePinned }) : null,
    filter,
    universeRoot,
    focusedWindowId,
    multiWindow: windowIds.size > 1,
    now: Date.now(),
  });
}

function readUiState(): [boolean, string, SortMode] {
  const excludePinned = requireElement<HTMLInputElement>("#excludePinned").checked;
  const filter = requireElement<HTMLInputElement>("#search").value;
  const sortSelect = requireElement<HTMLSelectElement>("#sort");
  return [excludePinned, filter, coerceSortMode(sortSelect.value)];
}

function coerceSortMode(value: string): SortMode {
  return value === "alpha" || value === "stale" ? value : "count";
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
  void saveUiPrefs({ sort: coerceSortMode(sortSelect.value), excludePinned });
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
  await restoreUiPrefs();
  wireInteractionHandlers();
  wireTabChangeListeners();
  await refresh();
  await restoreUndoToast();
}

document.addEventListener("DOMContentLoaded", () => {
  void init();
});
