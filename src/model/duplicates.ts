import { normalizeUrl } from "../utils/url.js";
import { placementKey, tabPlacement } from "./placement.js";

/** The minimum tab shape duplicate detection needs. */
export interface DuplicateCandidate {
  id: number;
  url: string;
  pinned: boolean;
  lastAccessed: number;
  active: boolean;
  /** Firefox tab-group id; null when ungrouped or runtime lacks the API. */
  groupId?: number | null;
  /** Container cookie store id; "firefox-default" when uncontained. */
  cookieStoreId?: string;
}

export interface DuplicateGroup {
  /** Normalized URL shared by every tab in the group. */
  key: string;
  tabs: DuplicateCandidate[];
}

/**
 * Groups tabs by normalized URL (tracking params already stripped by
 * normalizeUrl — review F8). Returns only groups with 2+ members, in first-seen
 * order with tabs in input order. Pure: callers pass ClusterTab[] or fixtures.
 */
export function findDuplicateGroups(tabs: readonly DuplicateCandidate[]): DuplicateGroup[] {
  const groups = new Map<string, DuplicateCandidate[]>();
  for (const tab of tabs) {
    const key = normalizeUrl(tab.url);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(tab);
    } else {
      groups.set(key, [tab]);
    }
  }
  return [...groups.entries()]
    .filter(([, bucket]) => bucket.length > 1)
    .map(([key, tabs]) => ({ key, tabs }));
}

/** One (normalizedUrl, placement) bucket: same page, same place. */
export interface DuplicateBucket {
  /** Normalized URL shared by every tab in the bucket. */
  key: string;
  groupId: number | null;
  cookieStoreId: string;
  /** Members in input order; always length >= 2 in returned buckets. */
  tabs: DuplicateCandidate[];
}

/**
 * Partitions tabs by (normalizeUrl(url), placement) and returns buckets with
 * 2+ members, in first-seen URL order with tabs in input order. Pure.
 *
 * Replaces the former all-or-nothing placement guard: redundancy is a
 * WITHIN-place property, so each placement bucket is independently
 * dedupeable while cross-bucket copies stay protected (user feedback
 * 2026-11-19: same URL deliberately open in multiple groups/containers).
 */
export function findDuplicateBuckets(tabs: readonly DuplicateCandidate[]): DuplicateBucket[] {
  const buckets = new Map<string, DuplicateBucket>();
  for (const tab of tabs) {
    const key = normalizeUrl(tab.url);
    const placement = tabPlacement(tab);
    const bucketKey = `${key}|${placementKey(placement)}`;
    const bucket = buckets.get(bucketKey);
    if (bucket) {
      bucket.tabs.push(tab);
    } else {
      buckets.set(bucketKey, {
        key,
        groupId: placement.groupId,
        cookieStoreId: placement.cookieStoreId,
        tabs: [tab],
      });
    }
  }
  return [...buckets.values()].filter((bucket) => bucket.tabs.length > 1);
}

/**
 * Per-tab count of copies sharing the tab's EXACT placement. Tabs whose
 * bucket holds only themselves are ABSENT (mirrors duplicateGroupSizes).
 */
export function duplicateBucketSizes(tabs: readonly DuplicateCandidate[]): Map<number, number> {
  const sizes = new Map<number, number>();
  for (const bucket of findDuplicateBuckets(tabs)) {
    for (const tab of bucket.tabs) {
      sizes.set(tab.id, bucket.tabs.length);
    }
  }
  return sizes;
}

/**
 * Picks the copy to keep for a duplicate group: the active tab if exactly one
 * is active, else the most recently accessed. Pinned copies always survive the
 * keeper cut only if they win it — being pinned does NOT force keeper status,
 * because the keeper is about "the copy you were last reading".
 */
export function pickDuplicateKeeper(tabs: readonly DuplicateCandidate[]): DuplicateCandidate {
  const activeTabs = tabs.filter((tab) => tab.active);
  if (activeTabs.length > 0) {
    return activeTabs.reduce((newest, tab) => (tab.lastAccessed > newest.lastAccessed ? tab : newest));
  }
  return tabs.reduce((newest, tab) => (tab.lastAccessed >= newest.lastAccessed ? tab : newest));
}

/**
 * True when every copy of a duplicate group shares one tab-group id (all null
 * = all ungrouped, which counts as "same place"). Copies spread across
 * DIFFERENT groups are intentional organization — never auto-suggest closing
 * them (user feedback 2026-11: the same page may deliberately be open in
 * multiple tab groups).
 */
function sameGroupPlacement(tabs: readonly DuplicateCandidate[]): boolean {
  const first = tabs[0]?.groupId ?? null;
  return tabs.every((tab) => (tab.groupId ?? null) === (first ?? null));
}

/**
 * Same idea for containers: copies in DIFFERENT containers are deliberate
 * isolation (e.g. banking inside the Banking container) — never auto-suggest
 * closing them. Copies that are all uncontained count as "same place".
 */
function sameContainerPlacement(tabs: readonly DuplicateCandidate[]): boolean {
  const first = tabs[0]?.cookieStoreId ?? "firefox-default";
  return tabs.every((tab) => (tab.cookieStoreId ?? "firefox-default") === first);
}

/**
 * IDs of duplicate tabs a "Close duplicates" action may close: every non-keeper
 * copy that is not pinned (pinned tabs are deliberately-kept state and survive
 * bulk actions, exactly like host/cluster Reap — audit finding F-5) and that
 * does NOT live in a different tab group than the keeper (cross-group copies
 * are protected — see sameGroupPlacement).
 */
export function closableDuplicateIds(tabs: readonly DuplicateCandidate[]): number[] {
  const closable: number[] = [];
  for (const bucket of findDuplicateBuckets(tabs)) {
    const keeper = pickDuplicateKeeper(bucket.tabs);
    for (const tab of bucket.tabs) {
      // Never close the keeper, a pinned copy, or an ACTIVE tab (closing
      // another window's focused tab via a popup docked elsewhere is the
      // worst possible outcome — adversarial review B2, 2026-11-19).
      if (tab.id !== keeper.id && !tab.pinned && !tab.active) {
        closable.push(tab.id);
      }
    }
  }
  return closable;
}

/**
 * Group size per tab ID (e.g. 3 for "×3" row chips); tabs in no duplicate group
 * are absent from the map. Cross-group duplicates are INCLUDED here (the chip
 * is informational for them — see crossGroupDuplicateIds for the destructive
 * set, which excludes them).
 */
export function duplicateGroupSizes(tabs: readonly DuplicateCandidate[]): Map<number, number> {
  const sizes = new Map<number, number>();
  for (const group of findDuplicateGroups(tabs)) {
    for (const tab of group.tabs) {
      sizes.set(tab.id, group.tabs.length);
    }
  }
  return sizes;
}

/**
 * Tab IDs whose duplicate copies live in a DIFFERENT tab group than the keeper
 * (or spread across several groups): informationally flagged but never
 * auto-closable — the copies are deliberate state (user feedback 2026-11).
 */
export function crossGroupDuplicateIds(tabs: readonly DuplicateCandidate[]): number[] {
  const ids: number[] = [];
  for (const group of findDuplicateGroups(tabs)) {
    if (sameGroupPlacement(group.tabs)) {
      continue;
    }
    for (const tab of group.tabs) {
      ids.push(tab.id);
    }
  }
  return ids;
}

/**
 * Tab IDs whose duplicate copies live in a DIFFERENT container than the rest
 * of the group: informational chip, never auto-closable (mirror of
 * crossGroupDuplicateIds for containers).
 */
export function crossContainerDuplicateIds(tabs: readonly DuplicateCandidate[]): number[] {
  const ids: number[] = [];
  for (const group of findDuplicateGroups(tabs)) {
    if (sameContainerPlacement(group.tabs)) {
      continue;
    }
    for (const tab of group.tabs) {
      ids.push(tab.id);
    }
  }
  return ids;
}
