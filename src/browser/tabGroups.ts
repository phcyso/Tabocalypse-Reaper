/**
 * Firefox tab-group support (tabGroups WebExtension API, Firefox 138+).
 *
 * Everything here is runtime feature-detected: Reaper's manifest floor is
 * Firefox 115, so on older runtimes `tabGroupsSupported()` returns false and
 * callers degrade to no-op. groupId values are NEVER persisted — Firefox may
 * reassign them when session restore brings groups back (MDN tabGroups docs).
 *
 * The `tabGroups` manifest permission is required for `tabGroups.query/get`,
 * is silent (never shown in permission prompts), and `tabs.group/ungroup`
 * need no permission at all.
 */
import type { GroupInfo } from "../model/types.js";

/** Minimal shape of the FF 138+ APIs we use, absent from the 115-era typings. */
interface TabGroupsApi {
  TAB_GROUP_ID_NONE: number;
  query(query?: { windowId?: number }): Promise<
    Array<{ id: number; title: string; color?: string }>
  >;
  get(groupId: number): Promise<{ id: number; title: string; color?: string }>;
}

interface TabsGroupApi {
  group(options: { tabIds: number[]; groupId?: number }): Promise<number[]>;
  ungroup(tabIds: number[]): Promise<void>;
}

interface BrowserWithGroups {
  tabGroups?: TabGroupsApi;
  tabs?: TabsGroupApi & Record<string, unknown>;
}

function api(): BrowserWithGroups | null {
  const candidate = browser as unknown as BrowserWithGroups;
  if (
    typeof candidate?.tabGroups?.query === "function" &&
    typeof candidate?.tabGroups?.get === "function" &&
    typeof candidate?.tabs?.group === "function"
  ) {
    return candidate;
  }
  return null;
}

/** Whether this Firefox exposes the tab-group APIs (FF 138+). */
export function tabGroupsSupported(): boolean {
  return api() !== null;
}

/**
 * All groups visible to the extension, keyed by id. Names may be empty strings
 * (unnamed group) — callers should fall back to a localized "Group N" label.
 */
export async function queryGroupInfos(): Promise<Map<number, GroupInfo>> {
  const client = api();
  const map = new Map<number, GroupInfo>();
  if (!client) {
    return map;
  }
  try {
    const groups = await client.tabGroups!.query({});
    for (const group of groups ?? []) {
      map.set(group.id, { id: group.id, name: group.title ?? "", color: group.color ?? null });
    }
  } catch (error) {
    console.error("Failed to query tab groups", error);
  }
  return map;
}

/** True when the id refers to a real group (not the ungrouped sentinel). */
export function isInGroup(groupId: number | null | undefined): boolean {
  return typeof groupId === "number" && groupId !== -1 && groupId !== 0;
}

/**
 * Best-effort: puts the given tab ids back into their original groups during
 * Undo. groupIds come from the stored sweep and may be stale (session restore
 * reassigns them) — every failure is swallowed; tabs stay ungrouped then.
 */
export async function restoreTabGroups(
  entries: readonly { groupId: number; tabIds: number[] }[]
): Promise<void> {
  const client = api();
  if (!client) {
    return;
  }
  for (const entry of entries) {
    try {
      await client.tabGroups!.get(entry.groupId); // throws if the group is gone
      await client.tabs!.group({ tabIds: entry.tabIds, groupId: entry.groupId });
    } catch (error) {
      console.warn("Could not restore tab group", entry.groupId, error);
    }
  }
}
