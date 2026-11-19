import { normalizeUrl } from "../utils/url.js";

/** The minimum tab shape duplicate detection needs. */
export interface DuplicateCandidate {
  id: number;
  url: string;
  pinned: boolean;
  lastAccessed: number;
  active: boolean;
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
 * IDs of duplicate tabs a "Close duplicates" action may close: every non-keeper
 * copy that is not pinned (pinned tabs are deliberately-kept state and survive
 * bulk actions, exactly like host/cluster Reap — audit finding F-5).
 */
export function closableDuplicateIds(tabs: readonly DuplicateCandidate[]): number[] {
  const closable: number[] = [];
  for (const group of findDuplicateGroups(tabs)) {
    const keeper = pickDuplicateKeeper(group.tabs);
    for (const tab of group.tabs) {
      if (tab.id !== keeper.id && !tab.pinned) {
        closable.push(tab.id);
      }
    }
  }
  return closable;
}

/**
 * Group size per tab ID (e.g. 3 for "×3" row chips); tabs in no duplicate group
 * are absent from the map.
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
