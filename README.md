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
1) Open `about:debugging#/runtime/this-firefox`  
2) **Load Temporary Add-on…**  
3) Select `manifest.json`.

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

**Lint the extension:**
```bash
npm run lint
```

**Build the extension:**
```bash
npm run build
```

Build artifacts are saved to `web-ext-artifacts/` (excluded from Git).

## Testing

This extension includes comprehensive automated testing:

### Unit Tests

Unit tests verify the core tab grouping and clustering logic:

```bash
npm run test:unit
```

Tests cover:
- URL normalization (tracking parameter removal)
- Cluster key generation (GitHub org/repo, AWS service, generic paths)
- Tab model building with filtering and sorting
- Pinned tab exclusion

### End-to-End (E2E) Tests

⚠️ **Status: DISABLED IN CI** - E2E tests are currently disabled in GitHub Actions to save Actions minutes pending investigation. The E2E workflow code is preserved in `.github/workflows/e2e-tests-disabled.yml` and can be re-enabled by changing the trigger from `workflow_dispatch` to `pull_request` or `push`.

E2E tests use Selenium WebDriver to test the extension UI in a real Firefox browser and can be run locally:

```bash
npm run test:e2e
```

**Prerequisites for E2E tests:**
- Firefox browser installed
- geckodriver installed and in PATH
- For headless testing: `xvfb` (Linux) or set `HEADLESS=true`
- DISPLAY environment variable set (for X11/Xvfb)

**Note:** E2E tests are automatically skipped if the Selenium environment is not properly configured. Unit tests provide comprehensive coverage of core functionality. To force running E2E tests locally:

```bash
FORCE_E2E=true npm run test:e2e
```

E2E tests cover (when they run successfully):
- Tab scenario setup (multi-window, pinned tabs, various URL types)
- UI interactions (search, sorting, bulk close operations)
- Cluster expansion and tab list rendering
- Visual regression testing with screenshot comparison

**Running E2E tests in headless mode:**
```bash
HEADLESS=true FORCE_E2E=true npm run test:e2e
```

**Running E2E tests with xvfb (Linux):**
```bash
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 &
sleep 2
FORCE_E2E=true npm run test:e2e
```

**Re-enabling E2E tests in CI:**
To re-enable E2E tests in GitHub Actions, edit `.github/workflows/e2e-tests-disabled.yml` and change:
```yaml
on:
  workflow_dispatch:  # Manual trigger only
```
to:
```yaml
on:
  pull_request:
    branches:
      - main
  push:
    branches:
      - main
```

### Test Architecture

The testing strategy addresses the limitation that **browser_action popup UI cannot be tested in headless mode**:

1. **Core Logic Module (`core.js`)**: Shared logic between popup and E2E test page
2. **E2E Test Page (`e2e.html` + `e2e.js`)**: Replica of popup UI that can be loaded as a normal tab
3. **Background Script (`background.js`)**: Opens e2e.html when needed for tests
4. **Selenium Tests**: Drive Firefox with extension loaded, interact with e2e page, capture screenshots

### CI/CD Integration

Tests run automatically in GitHub Actions on every pull request:

- **Unit tests** (required): Always run and must pass for PR to be approved
- **E2E tests**: Currently **DISABLED in CI** to save Actions minutes (available for local development only)
- Test artifacts (coverage) are uploaded when available
- PR comments show test results summary

**Build passes when:** Unit tests pass (25/25 required)  
**E2E tests:** Disabled in CI, can be run locally

### Test Screenshots

E2E tests can generate screenshots when run locally with proper Selenium setup. Screenshots are saved to `test-screenshots/` (excluded from Git).

### Limitations and Known Issues

- **Popup UI testing**: The extension's browser_action popup cannot be directly tested in headless mode. The E2E approach uses a separate `e2e.html` page as a workaround.
- **Extension permissions**: Tests require Firefox to load the unsigned extension, which is configured automatically.
- **E2E test environment**: E2E tests require full Selenium + Firefox + geckodriver setup and are currently **disabled in CI**. They can be run locally with `FORCE_E2E=true npm run test:e2e`.
- **Timing sensitivity**: E2E tests include sleep delays to handle async operations; timing may vary on slower systems.
- **Visual regression**: Screenshot-based visual regression tests may have minor pixel differences across environments.


