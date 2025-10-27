// Type definitions for core.js

export const CONFIRM_THRESHOLD: number;

export interface Tab {
  id: number;
  url: string;
  title: string;
  pinned: boolean;
  windowId: number;
  favIconUrl: string;
}

export interface TreeNode {
  name: string;
  kind: string;
  children: Map<string, TreeNode>;
  tabs: Array<{
    id: number;
    title: string;
    url: string;
    favIconUrl: string;
    subpath: string;
  }>;
  ids: Set<number>;
  count: number;
}

export interface ClusterResult {
  key: string;
  remainder: string[];
}

export function normalizeURL(url: string): string;

export function createNode(name: string, kind?: string): TreeNode;

export function clusterFor(u: URL): ClusterResult;

export function buildModel(
  tabs: Tab[],
  options?: {
    excludePinned?: boolean;
    normalize?: boolean;
    filter?: string;
  }
): TreeNode;
