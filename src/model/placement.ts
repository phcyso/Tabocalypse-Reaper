/**
 * Canonical "placement" of a tab: one tab-group slot + one container.
 *
 * Pure helpers (no browser global) so model/ stays unit-testable
 * (AGENT.md: prefer pure helpers in model/).
 */

export const DEFAULT_COOKIE_STORE = "firefox-default";

export interface Placement {
  /** Real groups have positive numeric ids; sentinels normalize to null. */
  groupId: number | null;
  cookieStoreId: string;
}

/**
 * Normalizes a tab's placement. Fixes a real-world inconsistency: Firefox
 * reports groupId === -1 (TAB_GROUP_ID_NONE) on FF 138+ runtimes while
 * fixtures and older models use null \u2014 without normalization those would
 * land in different placement buckets. Anything that is not a positive
 * number is "ungrouped".
 */
export function tabPlacement(tab: {
  groupId?: number | null;
  cookieStoreId?: string;
}): Placement {
  const gid = tab.groupId;
  return {
    groupId: typeof gid === "number" && gid > 0 ? gid : null,
    cookieStoreId: tab.cookieStoreId || DEFAULT_COOKIE_STORE,
  };
}

/** Stable string key for placement aggregation (breakdown lines, buckets). */
export function placementKey(placement: Placement): string {
  return `${placement.groupId ?? "none"}|${placement.cookieStoreId}`;
}
