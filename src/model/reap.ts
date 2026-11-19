import { NodeKind } from "./types.js";
import type { ClusterNode, HostNode } from "./types.js";

/**
 * Composes the tab IDs a bulk Reap may close: every tab in the group except pinned
 * ones. Pinned tabs are deliberately-kept state, so a single bulk action must never
 * destroy them regardless of the current pinned filter (audit finding F-5). Per-tab
 * ✕ is unaffected — that is an explicit, single-tab decision.
 */
export function bulkReapIds(group: HostNode | ClusterNode): number[] {
  const tabs =
    group.kind === NodeKind.Host
      ? [...group.children.values()].flatMap((cluster) => cluster.tabs)
      : group.tabs;
  return tabs.filter((tab) => !tab.pinned).map((tab) => tab.id);
}
