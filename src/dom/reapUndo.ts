import { reopenTab } from "../browser/tabs.js";
import { restoreTabGroups } from "../browser/tabGroups.js";
import { clearLastSweep, loadLastSweep, saveLastSweep, type ReapedTab } from "../browser/storage.js";
import { UNDO_TOAST_MS } from "../shared/constants.js";
import { requireElement } from "./query.js";

let toastHideTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Records a finished bulk reap as the undoable "last sweep" in session storage
 * and surfaces the toast: "Reaped N · Undo" (review F1). The toast auto-dismisses
 * after UNDO_TOAST_MS; a newer reap replaces the stored sweep and restarts the
 * timer. Undo restores tabs via browser.tabs.create — best-effort, original
 * positions are not recoverable (see reopenTab).
 */
export async function recordReap(
  tabs: readonly ReapedTab[],
  onUndo?: () => Promise<void>
): Promise<void> {
  if (tabs.length === 0) {
    return;
  }
  await saveLastSweep({ tabs: [...tabs], savedAt: Date.now() });
  showReapToast(tabs.length, onUndo);
}

/** Shows (or refreshes) the undo toast; undo runs the full restore + refresh. */
export function showReapToast(count: number, onUndo?: () => Promise<void>): void {
  const toast = requireElement<HTMLElement>("#toast");
  const text = requireElement<HTMLElement>("#toastText");
  const action = requireElement<HTMLButtonElement>("#toastAction");
  text.textContent = `Reaped ${count}`;
  action.onclick = () => {
    void (onUndo ? onUndo() : undoLastReap());
  };
  toast.hidden = false;
  if (toastHideTimer) {
    clearTimeout(toastHideTimer);
  }
  toastHideTimer = setTimeout(() => {
    hideReapToast();
  }, UNDO_TOAST_MS);
}

export function hideReapToast(): void {
  if (toastHideTimer) {
    clearTimeout(toastHideTimer);
    toastHideTimer = undefined;
  }
  const toast = document.getElementById("toast");
  if (toast) {
    toast.hidden = true;
  }
}

/**
 * Restores the stored sweep (if any), clears it, hides the toast. The caller's
 * onRefresh rehydrates the tree once the tabs are back. Safe to call with no
 * stored sweep (no-op).
 */
export async function undoLastReap(onRefresh?: () => Promise<void> | void): Promise<void> {
  const sweep = await loadLastSweep();
  if (!sweep) {
    hideReapToast();
    return;
  }
  // Best-effort regrouping (tabGroups API, FF 138+): puts reopened tabs back
  // into their groups when those groups still exist. Swallowed failures leave
  // tabs ungrouped — groupIds may have been reassigned by session restore.
  const regroups = new Map<number, number[]>();
  for (const tab of sweep.tabs) {
    const newId = await reopenTab(tab);
    if (typeof tab.groupId === "number" && newId != null) {
      const ids = regroups.get(tab.groupId) ?? [];
      ids.push(newId);
      regroups.set(tab.groupId, ids);
    }
  }
  if (regroups.size > 0) {
    await restoreTabGroups(
      [...regroups.entries()].map(([groupId, tabIds]) => ({ groupId, tabIds }))
    );
  }
  await clearLastSweep();
  hideReapToast();
  await onRefresh?.();
}

/** Whether an undoable sweep is stored — used on popup open to resurrect the toast. */
export async function hasStoredSweep(): Promise<boolean> {
  return (await loadLastSweep()) !== null;
}