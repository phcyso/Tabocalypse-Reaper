
const $$ = sel => document.querySelector(sel);
const $on = (el, ev, fn) => el.addEventListener(ev, fn);
const CONFIRM_THRESHOLD = 10;

async function applyThemeFromBrowser() {
  try {
    if (!browser.theme || !browser.theme.getCurrent) return;
    const theme = await browser.theme.getCurrent();
    if (!theme || !theme.colors) return;
    const c = theme.colors;
    const root = document.documentElement;
    if (c.popup) root.style.setProperty('--card', c.popup);
    if (c.popup_text) root.style.setProperty('--text', c.popup_text);
    if (c.toolbar_field) root.style.setProperty('--bg', c.toolbar_field);
    if (c.toolbar_field_text) root.style.setProperty('--text', c.toolbar_field_text);
    if (c.accentcolor) root.style.setProperty('--accent', c.accentcolor);
    if (c.textcolor) root.style.setProperty('--text', c.textcolor);
    if (c.toolbar) root.style.setProperty('--line', 'rgba(128,128,128,0.25)');
  } catch {}
}

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

function render(root) {
  const tree = $$("#tree");
  tree.innerHTML = "";
  const total = [...root.children.values()].reduce((s,h)=>s+h.count,0);
  $$("#stats").textContent = `${total} tab(s) matched`;

  const hostTpl = /** @type {HTMLTemplateElement} */ ($$("#hostTemplate"));
  const clusterTpl = /** @type {HTMLTemplateElement} */ ($$("#clusterTemplate"));
  const tabTpl = /** @type {HTMLTemplateElement} */ ($$("#tabTemplate"));
  const sortMode = $$("#sort").value;

  let hosts = [...root.children.values()];
  hosts.sort((a,b)=> sortMode==="alpha" ? a.name.localeCompare(b.name) : b.count-a.count);

  for (const h of hosts) {
    const frag = hostTpl.content.cloneNode(true);
    const name = frag.querySelector(".hostName");
    const badge = frag.querySelector(".badge");
    const twisty = frag.querySelector(".twisty");
    const closeBtn = frag.querySelector(".close");
    const body = frag.querySelector(".hostBody");

    name.textContent = h.name;
    badge.textContent = h.count;
    body.hidden = true;

    closeBtn.addEventListener("click", async (e)=>{
      e.stopPropagation();
      const idsArr = Array.from(h.ids);
      if (idsArr.length >= CONFIRM_THRESHOLD) {
        if (!confirm(`Reap ${idsArr.length} tabs under “${h.name}”?`)) return;
      }
      try { await browser.tabs.remove(idsArr); } catch(e){ console.error(e); }
      await refresh();
    });

    twisty.addEventListener("click", ()=>{
      body.hidden = !body.hidden;
      twisty.textContent = body.hidden ? "▸" : "▾";
    });

    let clusters = [...h.children.values()];
    clusters.sort((a,b)=> sortMode==="alpha" ? a.name.localeCompare(b.name) : b.count-a.count);
    for (const c of clusters) {
      const cfrag = clusterTpl.content.cloneNode(true);
      const cname = cfrag.querySelector(".clusterName");
      const cbadge = cfrag.querySelector(".badge");
      const ctwisty = cfrag.querySelector(".twisty");
      const cclose = cfrag.querySelector(".close");
      const cbody = cfrag.querySelector(".clusterBody");
      cname.textContent = c.name;
      cbadge.textContent = c.count;
      cbody.hidden = true;

      cclose.addEventListener("click", async (e)=>{
        e.stopPropagation();
        const idsArr = Array.from(c.ids);
        if (idsArr.length >= CONFIRM_THRESHOLD) {
          if (!confirm(`Reap ${idsArr.length} tabs under “${h.name} / ${c.name}”?`)) return;
        }
        try { await browser.tabs.remove(idsArr); } catch(e){ console.error(e); }
        await refresh();
      });

      ctwisty.addEventListener("click", ()=>{
        cbody.hidden = !cbody.hidden;
        ctwisty.textContent = cbody.hidden ? "▸" : "▾";
      });

      const list = document.createElement("div");
      for (const t of c.tabs.slice().sort((a,b)=> (a.title||"").localeCompare(b.title||""))) {
        const tfrag = tabTpl.content.cloneNode(true);
        const x = tfrag.querySelector(".x");
        const a = tfrag.querySelector(".title");
        const ico = tfrag.querySelector(".ico");
        const path = tfrag.querySelector(".path");
        a.textContent = t.title;
        a.href = t.url;
        path.textContent = t.subpath || "";
        if (t.favIconUrl) ico.src = t.favIconUrl;
        x.addEventListener("click", async (e)=>{
          e.stopPropagation();
          try { await browser.tabs.remove(t.id); } catch {}
          await refresh();
        });
        a.addEventListener("click", (e)=>{
          e.preventDefault();
          browser.tabs.update(t.id, { active: true });
        });
        list.appendChild(tfrag);
      }
      cbody.appendChild(list);
      body.appendChild(cfrag);
    }

    tree.appendChild(frag);
  }
}

async function pullTabs() {
  const tabs = await browser.tabs.query({});
  return tabs.map(t => ({
    id: t.id,
    url: t.url,
    title: t.title,
    pinned: t.pinned || false,
    windowId: t.windowId,
    favIconUrl: t.favIconUrl || ""
  }));
}

async function refresh() {
  const excludePinned = $$("#excludePinned").checked;
  const normalize = $$("#normalize").checked;
  const filter = $$("#search").value;
  const tabs = await pullTabs();
  const model = buildModel(tabs, { excludePinned, normalize, filter });
  render(model);
}

document.addEventListener("DOMContentLoaded", async () => {
  await applyThemeFromBrowser();
  $on($$("#refresh"), "click", refresh);
  $on($$("#search"), "input", () => { refresh(); });
  $on($$("#excludePinned"), "change", refresh);
  $on($$("#normalize"), "change", refresh);
  $on($$("#sort"), "change", refresh);
  await refresh();
});
