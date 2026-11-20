/**
 * Firefox containers (contextual identities) support.
 *
 * Unlike tab groups, `tabs.Tab.cookieStoreId` exists on every tab on any
 * remotely modern Firefox (default container = "firefox-default"), so scoping
 * and chips need no feature detection; only the *names/colors* come from the
 * `contextualIdentities` API (requires the silent "ContextualIdentities"
 * permission, and returns [] when the user has no containers defined).
 */
import type { ContainerInfo } from "../model/types.js";

interface ContextualIdentitiesApi {
  query(query?: { name?: string }): Promise<
    Array<{ cookieStoreId: string; name: string; color: string; colorCode: string }>
  >;
}

interface BrowserWithContainers {
  contextualIdentities?: ContextualIdentitiesApi;
}

const DEFAULT_CONTAINER = "firefox-default";

function api(): ContextualIdentitiesApi | null {
  const candidate = browser as unknown as BrowserWithContainers;
  return typeof candidate?.contextualIdentities?.query === "function"
    ? candidate.contextualIdentities
    : null;
}

/** Whether container identities can be resolved (API + permission present). */
export function containersSupported(): boolean {
  return api() !== null;
}

/**
 * Custom containers keyed by cookieStoreId. The default container is
 * deliberately absent — tabs in it render without a container chip.
 */
export async function queryContainerInfos(): Promise<Map<string, ContainerInfo>> {
  const client = api();
  const map = new Map<string, ContainerInfo>();
  if (!client) {
    return map;
  }
  try {
    const identities = await client.query({});
    for (const identity of identities ?? []) {
      map.set(identity.cookieStoreId, {
        cookieStoreId: identity.cookieStoreId,
        name: identity.name,
        color: identity.colorCode || identity.color || null,
      });
    }
  } catch (error) {
    console.error("Failed to query containers", error);
  }
  return map;
}

/** True when the tab lives in a real container (not the default one). */
export function isInContainer(cookieStoreId: string | null | undefined): boolean {
  return typeof cookieStoreId === "string" && cookieStoreId !== DEFAULT_CONTAINER;
}

export { DEFAULT_CONTAINER };
