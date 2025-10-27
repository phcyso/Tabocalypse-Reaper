// Core logic shared between popup and e2e test environments
// Can be used in both browser extension context and test environment

const CONFIRM_THRESHOLD = 10;

const normalizeURL = (url) => {
  try {
    const u = new URL(url);
    const params = new URLSearchParams(u.search);
    for (const k of [...params.keys()]) {
      if (/(utm_|fbclid|gclid|yclid|mc_cid|mc_eid|ref)/i.test(k)) params.delete(k);
    }
    u.search = params.toString() ? `?${params.toString()}` : "";
    u.pathname = u.pathname.replace(/\/+$/,"");
    return u.toString();
  } catch { return url; }
};

function createNode(name, kind="node") {
  return { name, kind, children: new Map(), tabs: [], ids: new Set(), count: 0 };
}

function clusterFor(u) {
  const segs = u.pathname.split("/").filter(Boolean);
  // Check hostname exactly, not substring match
  if (u.hostname === 'github.com' && segs.length >= 2) {
    return { key: `${segs[0]}/${segs[1]}`, remainder: segs.slice(2) };
  }
  // Check hostname exactly for AWS services, including subdomains
  if (u.hostname.endsWith('.aws.amazon.com') || u.hostname === 'aws.amazon.com') {
    return { key: segs[0] || "/", remainder: segs.slice(1) };
  }
  return { key: segs[0] || "/", remainder: segs.slice(1) };
}

function buildModel(tabs, {excludePinned=true, normalize=true, filter=""}={}) {
  const root = createNode("root","root");
  const f = filter.trim().toLowerCase();

  for (const t of tabs) {
    if (excludePinned && t.pinned) continue;
    if (!t.url || /^about:|^moz-extension:|^chrome:/.test(t.url)) continue;
    const urlStr = normalize ? normalizeURL(t.url) : t.url;
    let u; try { u = new URL(urlStr); } catch { continue; }
    const hay = `${u.host} ${u.pathname} ${t.title||""}`.toLowerCase();
    if (f && !hay.includes(f)) continue;

    const host = u.host;
    if (!root.children.has(host)) root.children.set(host, createNode(host,"host"));
    const hostNode = root.children.get(host);

    const { key, remainder } = clusterFor(u);
    if (!hostNode.children.has(key)) hostNode.children.set(key, createNode(key,"cluster"));
    const clusterNode = hostNode.children.get(key);

    const subpath = remainder.join("/");
    clusterNode.tabs.push({
      id: t.id, title: t.title || u.href, url: t.url,
      favIconUrl: t.favIconUrl || "", subpath
    });
    clusterNode.ids.add(t.id);
  }

  for (const [, hostNode] of root.children) {
    for (const [, c] of hostNode.children) c.count = c.tabs.length;
    hostNode.ids = new Set([].concat(...[...hostNode.children.values()].map(c => [...c.ids])));
    hostNode.count = hostNode.ids.size;
  }
  return root;
}

// Export for both extension and test environments
if (typeof module !== 'undefined' && module.exports) {
  // Node.js/test environment
  module.exports = {
    CONFIRM_THRESHOLD,
    normalizeURL,
    createNode,
    clusterFor,
    buildModel
  };
}
