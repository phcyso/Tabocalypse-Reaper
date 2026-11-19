export enum NodeKind {
  Root = "root",
  Host = "host",
  Cluster = "cluster",
}

export type SortMode = "alpha" | "count" | "stale";

export interface TabSummary {
  id: number;
  url: string;
  title: string;
  pinned: boolean;
  windowId: number;
  favIconUrl: string;
  /** Epoch ms of last access; omitted by older stubs/fixtures, defaults to "now". */
  lastAccessed?: number;
  /** Whether the tab is the active tab of its window. */
  active?: boolean;
}

export interface ClusterTab {
  id: number;
  title: string;
  url: string;
  favIconUrl: string;
  subpath: string;
  pinned: boolean;
  windowId: number;
  lastAccessed: number;
  active: boolean;
}

export interface BuildOptions {
  excludePinned?: boolean;
  filter?: string;
}

interface BaseNode<K extends NodeKind> {
  readonly name: string;
  readonly kind: K;
  count: number;
  ids: Set<number>;
}

export interface RootNode extends BaseNode<NodeKind.Root> {
  children: Map<string, HostNode>;
  tabs: never[];
}

export interface HostNode extends BaseNode<NodeKind.Host> {
  children: Map<string, ClusterNode>;
  tabs: never[];
}

export interface ClusterNode extends BaseNode<NodeKind.Cluster> {
  children: Map<string, never>;
  tabs: ClusterTab[];
}

export type TabTreeNode = RootNode | HostNode | ClusterNode;

export interface ClusterKey {
  readonly key: string;
  readonly remainder: readonly string[];
}
