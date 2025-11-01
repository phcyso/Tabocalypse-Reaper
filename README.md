# Tabocalypse Reaper — Design + Research Notes (v0.4.0)

## Approach validation & assumptions
- **Shallow hierarchy (Host → Cluster) is faster** than deep trees for scanning/closing; aligns with Sidebery/Tab Manager patterns. (Refs below)
- **Cluster keys**: first path segment; GitHub = org/repo; AWS = first segment. Good balance of meaning vs. complexity.
- **Counts**: bottom‑up unique IDs; cluster = length; host = union of clusters.
- **Favicons**: enable via CSP `img-src https: data: moz-extension:`; significantly improves scan speed.
- **Theme adaptation**: try `browser.theme.getCurrent()`; fallback `prefers-color-scheme`.
- **Bulk close**: single `tabs.remove([...])` per group.

## Branding
**Name**: Tabocalypse Reaper  
**Tagline**: End your tab chaos with one clean sweep.  
Logo: `logo.svg` (purple gradient, skull+scythe).

## Store listing (draft)
**Short** — Reap your tab chaos. Group by site and path, preview, and close whole clusters in one click.  
**Long** — Groups tabs by **host → cluster** (special GitHub/AWS handling). Shows favicons for quick scanning, accurate counts, purple theme that adapts to your browser. Reap entire groups or pick individual tabs. Works across windows. Options: filter, exclude pinned, normalize tracking params.

**Permissions** — `tabs` (enumerate/close tabs), `storage` (persist options in future), `theme` (adapt to browser theme).

## References
- Tree Style Tab: AMO listing — shows deep hierarchical approach. https://addons.mozilla.org/en-US/firefox/addon/tree-style-tab/
- Sidebery: AMO listing — two‑tier, configurable panels. https://addons.mozilla.org/en-US/firefox/addon/sidebery/
- Tab Manager Plus: Chrome Web Store — flat list with favicons, quick actions. https://chromewebstore.google.com/detail/tab-manager-plus-for-chro/cnkdjjdmfiffagllbiiilooaoofcoeff
- MDN `theme.getCurrent()` — theme adaptation. https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/theme/getCurrent
- MDN `tabs.remove()` — close multiple tabs via array. https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/remove
- MDN `img-src` — CSP directive for favicons. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/img-src

## Install (Temporary)
0) Build the compiled extension assets: `npm run prepare:dist`
1) Open `about:debugging#/runtime/this-firefox`
2) **Load Temporary Add-on…**
3) Select `dist/manifest.json`.

## CI/CD Pipeline

### Overview
This repository uses GitHub Actions to automate testing, building, and releasing the Firefox extension.

### Workflows

#### Pull Request Builds (`.github/workflows/pr-build.yml`)
Triggered on **all pull requests** to the `main` branch:
1. Lints the extension using `web-ext lint`
2. Builds an **unsigned** extension package
3. Uploads the build artifact to the PR

**Retrieving PR artifacts:**
1. Navigate to the pull request page
2. Scroll to the bottom and look for the "Checks" section
3. Click on "PR Build" workflow run
4. Download the `firefox-extension-unsigned` artifact from the "Artifacts" section
5. Extract the `.zip` file and install it temporarily in Firefox (see Install instructions above)

#### Release Builds (`.github/workflows/release.yml`)
Triggered on **pushes to the `main` branch**:
1. Lints the extension using `web-ext lint`
2. Automatically **bumps the patch version** in `manifest.json` (e.g., 0.4.0 → 0.4.1)
3. Commits the version bump back to the repository
4. Builds the extension package
5. Creates a GitHub Release with the version tag and attaches the build artifact

**Note:** Releases are **private** by default (visible only to repository collaborators).

### Version Management

#### Automated Patch Bumps
Patch versions (e.g., 0.4.0 → 0.4.1) are **automatically incremented** on every merge to `main`. This follows semantic versioning conventions where patch versions represent bug fixes and minor changes.

#### Manual Minor/Major Version Bumps
For **minor** (e.g., 0.4.0 → 0.5.0) or **major** (e.g., 0.4.0 → 1.0.0) version bumps:

1. **Update `manifest.json` manually:**
   ```json
   "version": "0.5.0"
   ```

2. **Commit and push:**
   ```bash
   git add manifest.json
   git commit -m "chore: bump version to 0.5.0"
   git push
   ```

3. The next merge to `main` will continue with patch increments from the new base version.

**Versioning Guidelines:**
- **Patch** (0.4.0 → 0.4.1): Bug fixes, minor tweaks, no new features
- **Minor** (0.4.0 → 0.5.0): New features, backwards-compatible changes
- **Major** (0.4.0 → 1.0.0): Breaking changes, significant rewrites

See [Firefox Extension Versioning Guidelines](https://extensionworkshop.com/documentation/publish/updating-your-extension/) for more details.

### Local Development

**Install dependencies:**
```bash
npm install
```

**Type-check + compile once:**
```bash
npm run prepare:dist
```

**Run the live reloading dev loop:**
```bash
npm run dev
```

**Lint the packaged extension:**
```bash
npm run lint
```

**Build the signed zip:**
```bash
npm run build
```

Build artifacts are saved to `web-ext-artifacts/` (excluded from Git), while the compiled extension lives in `dist/`.

