import type { SortMode } from "../model/index.js";

export interface UiPrefs {
  sort: SortMode;
  excludePinned: boolean;
  /** False (default): the popup scopes to its own window; true: every window. */
  allWindows?: boolean;
}

/** One reaped tab as stored for undo (review F1). */
export interface ReapedTab {
  url: string;
  title: string;
  pinned: boolean;
  windowId: number;
  /** Firefox tab-group id at reap time; best-effort regrouping on Undo. */
  groupId?: number | null;
}

/** The last bulk reap, kept in session storage so Undo survives popup round-trips. */
export interface ReapedSweep {
  tabs: ReapedTab[];
  savedAt: number;
}

const UI_PREFS_KEY = "uiPrefs";
const LAST_SWEEP_KEY = "lastSweep";

/**
 * Loads the popup's persisted UI choices for this browsing session. Returns {} when
 * nothing (valid) is stored or storage.session is unavailable (Firefox < 115), so the
 * caller can fall back to the defaults (audit finding F-11).
 */
export async function loadUiPrefs(): Promise<Partial<UiPrefs>> {
  try {
    const stored = await browser.storage.session.get(UI_PREFS_KEY);
    const prefs = stored?.[UI_PREFS_KEY];
    return isUiPrefs(prefs) ? prefs : {};
  } catch (error) {
    console.error("Failed to load UI prefs", error);
    return {};
  }
}

/**
 * Persists the popup's UI choices for the browsing session. The filter text is
 * deliberately NOT persisted (session-only choice, see AGENT.md).
 */
export async function saveUiPrefs(prefs: UiPrefs): Promise<void> {
  try {
    await browser.storage.session.set({ [UI_PREFS_KEY]: prefs });
  } catch (error) {
    console.error("Failed to save UI prefs", error);
  }
}

function isUiPrefs(value: unknown): value is Partial<UiPrefs> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const sortOk =
    candidate.sort === undefined ||
    candidate.sort === "alpha" ||
    candidate.sort === "count" ||
    candidate.sort === "stale" ||
    candidate.sort === "group";
  const pinnedOk =
    candidate.excludePinned === undefined || typeof candidate.excludePinned === "boolean";
  const windowsOk =
    candidate.allWindows === undefined || typeof candidate.allWindows === "boolean";
  return sortOk && pinnedOk && windowsOk;
}

function isReapedTab(value: unknown): value is ReapedTab {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const tab = value as Record<string, unknown>;
  return (
    typeof tab.url === "string" &&
    typeof tab.title === "string" &&
    typeof tab.pinned === "boolean" &&
    typeof tab.windowId === "number"
  );
}

function isReapedSweep(value: unknown): value is ReapedSweep {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const sweep = value as Record<string, unknown>;
  return (
    Array.isArray(sweep.tabs) &&
    sweep.tabs.length > 0 &&
    sweep.tabs.every(isReapedTab) &&
    typeof sweep.savedAt === "number"
  );
}

/**
 * Stores the last bulk reap so the Undo toast can restore it (review F1).
 * Session-only on purpose: a stale sweep from a previous browsing session is
 * worthless (windows are gone) — a same-session one is exactly what users expect.
 */
export async function saveLastSweep(sweep: ReapedSweep): Promise<void> {
  try {
    await browser.storage.session.set({ [LAST_SWEEP_KEY]: sweep });
  } catch (error) {
    console.error("Failed to save last sweep", error);
  }
}

/** Loads the stored sweep, or null when nothing valid is stored. */
export async function loadLastSweep(): Promise<ReapedSweep | null> {
  try {
    const stored = await browser.storage.session.get(LAST_SWEEP_KEY);
    const sweep = stored?.[LAST_SWEEP_KEY];
    return isReapedSweep(sweep) ? sweep : null;
  } catch (error) {
    console.error("Failed to load last sweep", error);
    return null;
  }
}

/** Clears the stored sweep (after Undo, or when the user lets the toast lapse). */
export async function clearLastSweep(): Promise<void> {
  try {
    await browser.storage.session.remove(LAST_SWEEP_KEY);
  } catch (error) {
    console.error("Failed to clear last sweep", error);
  }
}
