import { buildTabModel } from "./buildModel.js";
import type { BuildOptions, TabSummary } from "./types.js";

/**
 * Why the tree is empty. Rendered as a friendly message instead of a blank void
 * (audit finding F-7).
 */
export type EmptyStateReason = "no-tabs" | "pinned-hidden" | "no-filter-hits";

/**
 * Classifies an empty render so the UI can explain which control is hiding the tabs:
 * everything pinned away, a filter with no hits, or genuinely nothing open.
 */
export function describeEmptyState(
  tabs: readonly TabSummary[],
  { excludePinned = true }: BuildOptions = {}
): EmptyStateReason {
  if (buildTabModel(tabs, { excludePinned: false }).count === 0) {
    return "no-tabs";
  }

  if (excludePinned && buildTabModel(tabs, { excludePinned: true }).count === 0) {
    return "pinned-hidden";
  }

  // Tabs exist and survive the pinned filter, so the search must be the culprit.
  return "no-filter-hits";
}
