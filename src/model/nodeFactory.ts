import { ClusterNode, HostNode, NodeKind, RootNode } from "./types.js";

export function createRootNode(name = "root"): RootNode {
  return {
    name,
    kind: NodeKind.Root,
    children: new Map<string, HostNode>(),
    tabs: [],
    ids: new Set<number>(),
    count: 0,
  };
}

export function createHostNode(name: string): HostNode {
  return {
    name,
    kind: NodeKind.Host,
    children: new Map<string, ClusterNode>(),
    tabs: [],
    ids: new Set<number>(),
    count: 0,
  };
}

export function createClusterNode(name: string): ClusterNode {
  return {
    name,
    kind: NodeKind.Cluster,
    children: new Map<string, never>(),
    tabs: [],
    ids: new Set<number>(),
    count: 0,
  };
}
