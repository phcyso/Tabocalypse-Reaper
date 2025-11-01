const $$ = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Expected element matching selector "${selector}"`);
  }
  return element;
};

const CONFIRM_THRESHOLD = 10;

interface TabSummary {
  id: number;
  url: string;
  title: string;
  favIconUrl: string;
  subpath: string;
}

interface ClusterNode {
  name: string;
  kind: "cluster";
  children: Map<string, never>;
  tabs: TabSummary[];
  ids: Set<number>;
  count: number;
}

interface HostNode {
  name: string;
  kind: "host";
  children: Map<string, ClusterNode>;
  tabs: never[];
  ids: Set<number>;
  count: number;
}

interface RootNode {
  name: string;
  kind: "root";
  children: Map<string, HostNode>;
  tabs: never[];
  ids: Set<number>;
  count: number;
}

interface BuildOptions {
  excludePinned?: boolean;
  normalize?: boolean;
  filter?: string;
}

interface NormalizedTab {
  id: number;
  url: string;
  title: string;
  pinned: boolean;
  windowId: number;
  favIconUrl: string;
}

type ThemeColorValue = string | [number, number, number] | [number, number, number, number];

const createClusterNode = (name: string): ClusterNode => ({
  name,
  kind: "cluster",
  children: new Map<string, never>(),
  tabs: [] as TabSummary[],
  ids: new Set<number>(),
  count: 0,
});

const createHostNode = (name: string): HostNode => ({
  name,
  kind: "host",
  children: new Map<string, ClusterNode>(),
  tabs: [] as never[],
  ids: new Set<number>(),
  count: 0,
});

const createRootNode = (): RootNode => ({
  name: "root",
  kind: "root",
  children: new Map<string, HostNode>(),
  tabs: [] as never[],
  ids: new Set<number>(),
  count: 0,
});

const normalizeURL = (url: string): string => {
  try {
    const u = new URL(url);
    const params = new URLSearchParams(u.search);
    for (const key of params.keys()) {
      if (/(utm_|fbclid|gclid|yclid|mc_cid|mc_eid|ref)/i.test(key)) {
        params.delete(key);
      }
    }
    const cleanedSearch = params.toString();
    u.search = cleanedSearch ? `?${cleanedSearch}` : "";
    u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch (error) {
    console.error("Failed to normalize URL", error);
    return url;
  }
};

const clusterFor = (
  url: URL,
): { key: string; remainder: string[] } => {
  const segments = url.pathname.split("/").filter(Boolean);
  if (url.host.endsWith("github.com") && segments.length >= 2) {
    return { key: `${segments[0]}/${segments[1]}`, remainder: segments.slice(2) };
  }
  if (url.host.includes("aws.amazon.com") || url.host.includes("docs.aws.amazon.com")) {
    return { key: segments[0] || "/", remainder: segments.slice(1) };
  }
  return { key: segments[0] || "/", remainder: segments.slice(1) };
};

function buildModel(
  tabs: NormalizedTab[],
  { excludePinned = true, normalize = true, filter = "" }: BuildOptions = {},
): RootNode {
  const root = createRootNode();
  const query = filter.trim().toLowerCase();

  for (const tab of tabs) {
    if (excludePinned && tab.pinned) {
      continue;
    }
    if (!tab.url || /^about:|^moz-extension:|^chrome:/.test(tab.url)) {
      continue;
    }
    const urlStr = normalize ? normalizeURL(tab.url) : tab.url;
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch (error) {
      console.error("Skipping invalid URL", error);
      continue;
    }

    const haystack = `${parsed.host} ${parsed.pathname} ${tab.title ?? ""}`.toLowerCase();
    if (query && !haystack.includes(query)) {
      continue;
    }

    const host = parsed.host;
    if (!root.children.has(host)) {
      root.children.set(host, createHostNode(host));
    }
    const hostNode = root.children.get(host)!;

    const { key, remainder } = clusterFor(parsed);
    if (!hostNode.children.has(key)) {
      hostNode.children.set(key, createClusterNode(key));
    }
    const clusterNode = hostNode.children.get(key)!;

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
    const collectedIds = Array.from(hostNode.children.values()).flatMap((cluster) =>
      Array.from(cluster.ids),
    );
    hostNode.ids = new Set(collectedIds);
    hostNode.count = hostNode.ids.size;
  }

  return root;
}

function render(root: RootNode): void {
  const tree = $$<HTMLDivElement>("#tree");
  tree.innerHTML = "";

  const stats = $$<HTMLSpanElement>("#stats");
  const total = Array.from(root.children.values()).reduce((sum, host) => sum + host.count, 0);
  stats.textContent = `${total} tab(s) matched`;

  const hostTpl = $$<HTMLTemplateElement>("#hostTemplate");
  const clusterTpl = $$<HTMLTemplateElement>("#clusterTemplate");
  const tabTpl = $$<HTMLTemplateElement>("#tabTemplate");
  const sortSelect = $$<HTMLSelectElement>("#sort");
  const sortMode = sortSelect.value;

  const hosts = Array.from(root.children.values());
  hosts.sort((a, b) => (sortMode === "alpha" ? a.name.localeCompare(b.name) : b.count - a.count));

  for (const host of hosts) {
    const fragment = hostTpl.content.cloneNode(true) as DocumentFragment;
    const header = fragment.querySelector<HTMLElement>(".hostHeader");
    const name = fragment.querySelector<HTMLElement>(".hostName");
    const badge = fragment.querySelector<HTMLElement>(".badge");
    const twisty = fragment.querySelector<HTMLElement>(".twisty");
    const closeBtn = fragment.querySelector<HTMLButtonElement>(".close");
    const body = fragment.querySelector<HTMLDivElement>(".hostBody");
    const icon = fragment.querySelector<HTMLImageElement>(".hostIco");

    if (!header || !name || !badge || !twisty || !closeBtn || !body || !icon) {
      continue;
    }

    name.textContent = host.name;
    badge.textContent = String(host.count);
    body.hidden = true;
    header.setAttribute("aria-expanded", "false");

    let hostFavicon = "";
    for (const cluster of host.children.values()) {
      if (cluster.tabs.length > 0 && cluster.tabs[0].favIconUrl) {
        hostFavicon = cluster.tabs[0].favIconUrl;
        break;
      }
    }
    if (hostFavicon) {
      icon.src = hostFavicon;
    }

    const toggleHost = () => {
      body.hidden = !body.hidden;
      twisty.textContent = body.hidden ? "▸" : "▾";
      header.setAttribute("aria-expanded", body.hidden ? "false" : "true");
    };

    closeBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const ids = Array.from(host.ids);
      if (ids.length >= CONFIRM_THRESHOLD) {
        const confirmed = confirm(`Reap ${ids.length} tabs under “${host.name}”?`);
        if (!confirmed) {
          return;
        }
      }
      try {
        await browser.tabs.remove(ids);
      } catch (error) {
        console.error("Failed to remove tabs", error);
      }
      await refresh();
    });

    header.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest(".close")) {
        return;
      }
      toggleHost();
    });

    header.addEventListener("keydown", (event) => {
      if (event.target !== header) {
        return;
      }
      if (["Enter", " ", "Spacebar", "Space"].includes(event.key)) {
        event.preventDefault();
        toggleHost();
      }
    });

    const clusters = Array.from(host.children.values());
    clusters.sort((a, b) => (sortMode === "alpha" ? a.name.localeCompare(b.name) : b.count - a.count));

    for (const cluster of clusters) {
      const clusterFragment = clusterTpl.content.cloneNode(true) as DocumentFragment;
      const clusterHeader = clusterFragment.querySelector<HTMLElement>(".clusterHeader");
      const clusterName = clusterFragment.querySelector<HTMLElement>(".clusterName");
      const clusterBadge = clusterFragment.querySelector<HTMLElement>(".badge");
      const clusterTwisty = clusterFragment.querySelector<HTMLElement>(".twisty");
      const clusterClose = clusterFragment.querySelector<HTMLButtonElement>(".close");
      const clusterBody = clusterFragment.querySelector<HTMLDivElement>(".clusterBody");
      const clusterIcon = clusterFragment.querySelector<HTMLImageElement>(".clusterIco");

      if (!clusterHeader || !clusterName || !clusterBadge || !clusterTwisty || !clusterClose || !clusterBody || !clusterIcon) {
        continue;
      }

      clusterName.textContent = cluster.name;
      clusterBadge.textContent = String(cluster.count);
      clusterBody.hidden = true;
      clusterHeader.setAttribute("aria-expanded", "false");

      if (cluster.tabs.length > 0 && cluster.tabs[0].favIconUrl) {
        clusterIcon.src = cluster.tabs[0].favIconUrl;
      }

      const toggleCluster = () => {
        clusterBody.hidden = !clusterBody.hidden;
        clusterTwisty.textContent = clusterBody.hidden ? "▸" : "▾";
        clusterHeader.setAttribute("aria-expanded", clusterBody.hidden ? "false" : "true");
      };

      clusterClose.addEventListener("click", async (event) => {
        event.stopPropagation();
        const ids = Array.from(cluster.ids);
        if (ids.length >= CONFIRM_THRESHOLD) {
          const confirmed = confirm(`Reap ${ids.length} tabs under “${host.name} / ${cluster.name}”?`);
          if (!confirmed) {
            return;
          }
        }
        try {
          await browser.tabs.remove(ids);
        } catch (error) {
          console.error("Failed to remove cluster tabs", error);
        }
        await refresh();
      });

      clusterHeader.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest(".close")) {
          return;
        }
        toggleCluster();
      });

      clusterHeader.addEventListener("keydown", (event) => {
        if (event.target !== clusterHeader) {
          return;
        }
        if (["Enter", " ", "Spacebar", "Space"].includes(event.key)) {
          event.preventDefault();
          toggleCluster();
        }
      });

      const tabList = document.createElement("div");
      const tabs = cluster.tabs
        .slice()
        .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      for (const tab of tabs) {
        const tabFragment = tabTpl.content.cloneNode(true) as DocumentFragment;
        const closeTabButton = tabFragment.querySelector<HTMLButtonElement>(".x");
        const titleLink = tabFragment.querySelector<HTMLAnchorElement>(".title");
        const iconEl = tabFragment.querySelector<HTMLImageElement>(".ico");
        const pathEl = tabFragment.querySelector<HTMLElement>(".path");
        if (!closeTabButton || !titleLink || !iconEl || !pathEl) {
          continue;
        }

        titleLink.textContent = tab.title;
        titleLink.href = tab.url;
        pathEl.textContent = tab.subpath || "";
        if (tab.favIconUrl) {
          iconEl.src = tab.favIconUrl;
        }

        closeTabButton.addEventListener("click", async (event) => {
          event.stopPropagation();
          try {
            await browser.tabs.remove(tab.id);
          } catch (error) {
            console.error("Failed to remove tab", error);
          }
          await refresh();
        });

        titleLink.addEventListener("click", (event) => {
          event.preventDefault();
          void browser.tabs.update(tab.id, { active: true });
        });

        tabList.appendChild(tabFragment);
      }

      clusterBody.appendChild(tabList);
      body.appendChild(clusterFragment);
    }

    tree.appendChild(fragment);
  }
}

async function pullTabs(): Promise<NormalizedTab[]> {
  const tabs = await browser.tabs.query({});
  return tabs
    .filter((tab): tab is browser.tabs.Tab & { id: number; url: string } =>
      typeof tab.id === "number" && typeof tab.url === "string",
    )
    .map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: tab.title ?? tab.url,
      pinned: Boolean(tab.pinned),
      windowId: tab.windowId ?? -1,
      favIconUrl: tab.favIconUrl ?? "",
    }));
}

async function refresh(): Promise<void> {
  const excludePinned = $$<HTMLInputElement>("#excludePinned").checked;
  const normalize = $$<HTMLInputElement>("#normalize").checked;
  const filter = $$<HTMLInputElement>("#search").value;
  const tabs = await pullTabs();
  const model = buildModel(tabs, { excludePinned, normalize, filter });
  render(model);
}

document.addEventListener("DOMContentLoaded", async () => {
  await applyThemeFromBrowser();

  $$<HTMLButtonElement>("#refresh").addEventListener("click", () => {
    void refresh();
  });
  $$<HTMLInputElement>("#search").addEventListener("input", () => {
    void refresh();
  });
  $$<HTMLInputElement>("#excludePinned").addEventListener("change", () => {
    void refresh();
  });
  $$<HTMLInputElement>("#normalize").addEventListener("change", () => {
    void refresh();
  });
  $$<HTMLSelectElement>("#sort").addEventListener("change", () => {
    void refresh();
  });

  await refresh();
});

async function applyThemeFromBrowser(): Promise<void> {
  try {
    if (!browser.theme?.getCurrent) {
      return;
    }
    const theme = await browser.theme.getCurrent();
    if (!theme?.colors) {
      return;
    }
    const colors = theme.colors;
    const root = document.documentElement;
    const toCssColor = (value: ThemeColorValue | undefined): string | undefined => {
      if (!value) {
        return undefined;
      }
      if (Array.isArray(value)) {
        return `rgb(${value.join(",")})`;
      }
      return value;
    };
    const setColor = (name: string, value: ThemeColorValue | undefined) => {
      const cssValue = toCssColor(value);
      if (cssValue) {
        root.style.setProperty(name, cssValue);
      }
    };

    setColor("--card", colors.popup);
    setColor("--text", colors.popup_text ?? colors.toolbar_field_text ?? colors.textcolor);
    setColor("--bg", colors.toolbar_field);
    setColor("--accent", colors.accentcolor);
    setColor("--line", colors.toolbar ? "rgba(128,128,128,0.25)" : undefined);
  } catch (error) {
    console.error("Failed to apply theme", error);
  }
}
