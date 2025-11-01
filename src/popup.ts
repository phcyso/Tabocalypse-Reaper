
type QueryRoot = Document | DocumentFragment | Element;

type SortMode = "alpha" | "count";

type NodeKind = "root" | "host" | "cluster";

interface ClusterTab {
  id: number;
  title: string;
  url: string;
  favIconUrl: string;
  subpath: string;
}

interface BaseNode<K extends NodeKind> {
  name: string;
  kind: K;
  count: number;
  ids: Set<number>;
}

interface RootNode extends BaseNode<"root"> {
  children: Map<string, HostNode>;
  tabs: never[];
}

interface HostNode extends BaseNode<"host"> {
  children: Map<string, ClusterNode>;
  tabs: never[];
}

interface ClusterNode extends BaseNode<"cluster"> {
  children: Map<string, never>;
  tabs: ClusterTab[];
}

type AnyNode = RootNode | HostNode | ClusterNode;

interface TabSummary {
  id: number;
  url: string;
  title: string;
  pinned: boolean;
  windowId: number;
  favIconUrl: string;
}

interface BuildOptions {
  excludePinned?: boolean;
  normalize?: boolean;
  filter?: string;
}

const $$ = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element for selector: ${selector}`);
  }
  return element;
};

const queryWithin = <T extends Element>(root: QueryRoot, selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing descendant for selector: ${selector}`);
  }
  return element;
};

const $on = (el: Document | Element, ev: string, fn: EventListener): void => {
  el.addEventListener(ev, fn);
};

const CONFIRM_THRESHOLD = 10;

type ThemeColorValue = string | [number, number, number] | [number, number, number, number];

const toCSSColor = (color?: ThemeColorValue | null): string | undefined => {
  if (!color) return undefined;
  if (typeof color === "string") return color;
  if (Array.isArray(color)) {
    const [r, g, b, a] = color;
    if (typeof a === "number") {
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    return `rgb(${r}, ${g}, ${b})`;
  }
  return undefined;
};

async function applyThemeFromBrowser(): Promise<void> {
  try {
    if (!browser.theme || !browser.theme.getCurrent) return;
    const theme = await browser.theme.getCurrent();
    if (!theme || !theme.colors) return;
    const c = theme.colors;
    const root = document.documentElement;
    const setColor = (cssVar: string, color?: ThemeColorValue | null) => {
      const resolved = toCSSColor(color);
      if (resolved) {
        root.style.setProperty(cssVar, resolved);
      }
    };

    setColor("--card", c.popup);
    setColor("--text", c.popup_text);
    setColor("--bg", c.toolbar_field);
    setColor("--text", c.toolbar_field_text);
    setColor("--accent", c.accentcolor);
    setColor("--text", c.textcolor);
    if (c.toolbar) root.style.setProperty("--line", "rgba(128,128,128,0.25)");
  } catch (error) {
    console.error("Failed to apply browser theme", error);
  }
}

const normalizeURL = (url: string): string => {
  try {
    const u = new URL(url);
    const params = new URLSearchParams(u.search);
    for (const key of [...params.keys()]) {
      if (/(utm_|fbclid|gclid|yclid|mc_cid|mc_eid|ref)/i.test(key)) params.delete(key);
    }
    const sanitizedSearch = params.toString();
    u.search = sanitizedSearch ? `?${sanitizedSearch}` : "";
    u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return url;
  }
};

function createNode(name: string, kind: "root"): RootNode;
function createNode(name: string, kind: "host"): HostNode;
function createNode(name: string, kind: "cluster"): ClusterNode;
function createNode(name: string, kind: NodeKind): AnyNode {
  if (kind === "root") {
    return {
      name,
      kind,
      children: new Map<string, HostNode>(),
      tabs: [],
      ids: new Set<number>(),
      count: 0,
    };
  }
  if (kind === "host") {
    return {
      name,
      kind,
      children: new Map<string, ClusterNode>(),
      tabs: [],
      ids: new Set<number>(),
      count: 0,
    };
  }
  return {
    name,
    kind,
    children: new Map<string, never>(),
    tabs: [],
    ids: new Set<number>(),
    count: 0,
  };
}

interface ClusterKey {
  key: string;
  remainder: string[];
}

const clusterFor = (url: URL): ClusterKey => {
  const segs = url.pathname.split("/").filter(Boolean);
  if (url.host.endsWith("github.com") && segs.length >= 2) {
    return { key: `${segs[0]}/${segs[1]}`, remainder: segs.slice(2) };
  }
  if (url.host.includes("aws.amazon.com") || url.host.includes("docs.aws.amazon.com")) {
    return { key: segs[0] || "/", remainder: segs.slice(1) };
  }
  return { key: segs[0] || "/", remainder: segs.slice(1) };
};

const buildModel = (
  tabs: TabSummary[],
  { excludePinned = true, normalize = true, filter = "" }: BuildOptions = {}
): RootNode => {
  const root = createNode("root", "root");
  const query = filter.trim().toLowerCase();

  for (const tab of tabs) {
    if (excludePinned && tab.pinned) continue;
    if (!tab.url || /^about:|^moz-extension:|^chrome:/.test(tab.url)) continue;
    const urlStr = normalize ? normalizeURL(tab.url) : tab.url;
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      continue;
    }
    const haystack = `${parsed.host} ${parsed.pathname} ${tab.title ?? ""}`.toLowerCase();
    if (query && !haystack.includes(query)) continue;

    const host = parsed.host;
    let hostNode = root.children.get(host);
    if (!hostNode) {
      hostNode = createNode(host, "host");
      root.children.set(host, hostNode);
    }

    const { key, remainder } = clusterFor(parsed);
    let clusterNode = hostNode.children.get(key);
    if (!clusterNode) {
      clusterNode = createNode(key, "cluster");
      hostNode.children.set(key, clusterNode);
    }

    const subpath = remainder.join("/");
    clusterNode.tabs.push({
      id: tab.id,
      title: tab.title || parsed.href,
      url: tab.url,
      favIconUrl: tab.favIconUrl || "",
      subpath,
    });
    clusterNode.ids.add(tab.id);
  }

  for (const hostNode of root.children.values()) {
    for (const cluster of hostNode.children.values()) {
      cluster.count = cluster.tabs.length;
    }
    hostNode.ids = new Set<number>(
      Array.from(hostNode.children.values()).flatMap((cluster) => Array.from(cluster.ids))
    );
    hostNode.count = hostNode.ids.size;
  }

  root.ids = new Set<number>(
    Array.from(root.children.values()).flatMap((hostNode) => Array.from(hostNode.ids))
  );
  root.count = root.ids.size;

  return root;
};

const render = (root: RootNode): void => {
  const tree = $$<HTMLElement>("#tree");
  tree.innerHTML = "";
  const total = Array.from(root.children.values()).reduce((sum, host) => sum + host.count, 0);
  $$<HTMLElement>("#stats").textContent = `${total} tab(s) matched`;

  const hostTpl = $$<HTMLTemplateElement>("#hostTemplate");
  const clusterTpl = $$<HTMLTemplateElement>("#clusterTemplate");
  const tabTpl = $$<HTMLTemplateElement>("#tabTemplate");
  const sortMode = $$<HTMLSelectElement>("#sort").value as SortMode;

  const hosts = Array.from(root.children.values());
  hosts.sort((a, b) =>
    sortMode === "alpha" ? a.name.localeCompare(b.name) : b.count - a.count
  );

  for (const hostNode of hosts) {
    const frag = hostTpl.content.cloneNode(true) as DocumentFragment;
    const header = queryWithin<HTMLElement>(frag, ".hostHeader");
    const name = queryWithin<HTMLElement>(frag, ".hostName");
    const badge = queryWithin<HTMLElement>(frag, ".badge");
    const twisty = queryWithin<HTMLElement>(frag, ".twisty");
    const closeBtn = queryWithin<HTMLButtonElement>(frag, ".close");
    const body = queryWithin<HTMLElement>(frag, ".hostBody");
    const ico = queryWithin<HTMLImageElement>(frag, ".hostIco");

    name.textContent = hostNode.name;
    badge.textContent = String(hostNode.count);
    body.hidden = true;
    header.setAttribute("aria-expanded", "false");

    // Set host icon: use first available favicon from any tab in the host
    let hostFavicon = "";
    for (const cluster of hostNode.children.values()) {
      if (cluster.tabs.length > 0 && cluster.tabs[0].favIconUrl) {
        hostFavicon = cluster.tabs[0].favIconUrl;
        break;
      }
    }
    if (hostFavicon) {
      ico.src = hostFavicon;
    }

    const toggleHost = () => {
      body.hidden = !body.hidden;
      twisty.textContent = body.hidden ? "▸" : "▾";
      header.setAttribute("aria-expanded", body.hidden ? "false" : "true");
    };

    closeBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const idsArr = Array.from(hostNode.ids);
      if (idsArr.length >= CONFIRM_THRESHOLD) {
        if (!confirm(`Reap ${idsArr.length} tabs under “${hostNode.name}”?`)) return;
      }
      try {
        await browser.tabs.remove(idsArr);
      } catch (error) {
        console.error(error);
      }
      await refresh();
    });

    header.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest(".close")) return;
      toggleHost();
    });

    header.addEventListener("keydown", (event) => {
      if (event.target !== header) return;
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "Spacebar" ||
        event.key === "Space"
      ) {
        event.preventDefault();
        toggleHost();
      }
    });

    const clusters = Array.from(hostNode.children.values());
    clusters.sort((a, b) =>
      sortMode === "alpha" ? a.name.localeCompare(b.name) : b.count - a.count
    );

    for (const cluster of clusters) {
      const cfrag = clusterTpl.content.cloneNode(true) as DocumentFragment;
      const cheader = queryWithin<HTMLElement>(cfrag, ".clusterHeader");
      const cname = queryWithin<HTMLElement>(cfrag, ".clusterName");
      const cbadge = queryWithin<HTMLElement>(cfrag, ".badge");
      const ctwisty = queryWithin<HTMLElement>(cfrag, ".twisty");
      const cclose = queryWithin<HTMLButtonElement>(cfrag, ".close");
      const cbody = queryWithin<HTMLElement>(cfrag, ".clusterBody");
      const cico = queryWithin<HTMLImageElement>(cfrag, ".clusterIco");
      cname.textContent = cluster.name;
      cbadge.textContent = String(cluster.count);
      cbody.hidden = true;
      cheader.setAttribute("aria-expanded", "false");

      // Set cluster icon: use first tab favicon from cluster
      if (cluster.tabs.length > 0 && cluster.tabs[0].favIconUrl) {
        cico.src = cluster.tabs[0].favIconUrl;
      }

      const toggleCluster = () => {
        cbody.hidden = !cbody.hidden;
        ctwisty.textContent = cbody.hidden ? "▸" : "▾";
        cheader.setAttribute("aria-expanded", cbody.hidden ? "false" : "true");
      };

      cclose.addEventListener("click", async (event) => {
        event.stopPropagation();
        const idsArr = Array.from(cluster.ids);
        if (idsArr.length >= CONFIRM_THRESHOLD) {
          if (!confirm(`Reap ${idsArr.length} tabs under “${hostNode.name} / ${cluster.name}”?`)) return;
        }
        try {
          await browser.tabs.remove(idsArr);
        } catch (error) {
          console.error(error);
        }
        await refresh();
      });

      cheader.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest(".close")) return;
        toggleCluster();
      });

      cheader.addEventListener("keydown", (event) => {
        if (event.target !== cheader) return;
        if (
          event.key === "Enter" ||
          event.key === " " ||
          event.key === "Spacebar" ||
          event.key === "Space"
        ) {
          event.preventDefault();
          toggleCluster();
        }
      });

      const list = document.createElement("div");
      const sortedTabs = cluster.tabs
        .slice()
        .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      for (const tab of sortedTabs) {
        const tfrag = tabTpl.content.cloneNode(true) as DocumentFragment;
        const closeButton = queryWithin<HTMLButtonElement>(tfrag, ".x");
        const anchor = queryWithin<HTMLAnchorElement>(tfrag, ".title");
        const icon = queryWithin<HTMLImageElement>(tfrag, ".ico");
        const path = queryWithin<HTMLSpanElement>(tfrag, ".path");
        anchor.textContent = tab.title;
        anchor.href = tab.url;
        path.textContent = tab.subpath || "";
        if (tab.favIconUrl) icon.src = tab.favIconUrl;
        closeButton.addEventListener("click", async (event) => {
          event.stopPropagation();
          try {
            await browser.tabs.remove(tab.id);
          } catch (error) {
            console.error(error);
          }
          await refresh();
        });
        anchor.addEventListener("click", (event) => {
          event.preventDefault();
          void browser.tabs.update(tab.id, { active: true });
        });
        list.appendChild(tfrag);
      }
      cbody.appendChild(list);
      body.appendChild(cfrag);
    }

    tree.appendChild(frag);
  }
};

const pullTabs = async (): Promise<TabSummary[]> => {
  const tabs = await browser.tabs.query({});
  return tabs
    .filter((tab): tab is browser.tabs.Tab & { id: number; url: string } =>
      typeof tab.id === "number" && typeof tab.url === "string"
    )
    .map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: tab.title ?? tab.url,
      pinned: Boolean(tab.pinned),
      windowId: tab.windowId ?? 0,
      favIconUrl: tab.favIconUrl ?? "",
    }));
};

const refresh = async (): Promise<void> => {
  const excludePinned = $$<HTMLInputElement>("#excludePinned").checked;
  const normalize = $$<HTMLInputElement>("#normalize").checked;
  const filter = $$<HTMLInputElement>("#search").value;
  const tabs = await pullTabs();
  const model = buildModel(tabs, { excludePinned, normalize, filter });
  render(model);
};

document.addEventListener("DOMContentLoaded", async () => {
  await applyThemeFromBrowser();
  $on($$<HTMLButtonElement>("#refresh"), "click", () => {
    void refresh();
  });
  $on($$<HTMLInputElement>("#search"), "input", () => {
    void refresh();
  });
  $on($$<HTMLInputElement>("#excludePinned"), "change", () => {
    void refresh();
  });
  $on($$<HTMLInputElement>("#normalize"), "change", () => {
    void refresh();
  });
  $on($$<HTMLSelectElement>("#sort"), "change", () => {
    void refresh();
  });
  await refresh();
});
