# Tabocalypse Reaper - AI Development Guide

## Project Overview
A Firefox browser extension that organizes tabs using a **Host → Cluster** hierarchy for efficient tab management. Built with manifest v2, vanilla JavaScript, and focuses on performance and theme adaptability.

## Tech Stack
- **Browser Extension Platform**: Firefox WebExtension (Manifest v2)
- **Language**: Vanilla JavaScript (ES6+, async/await)
- **UI**: HTML5 + CSS3 with CSS Custom Properties
- **APIs**: Firefox WebExtensions API (`browser.tabs`, `browser.storage`, `browser.theme`)
- **Build Tools**: web-ext (development and testing)
- **No Dependencies**: Single-file architecture with no external libraries or build process

## Architecture Principles

### Data Model (`buildModel` function)
- **Two-tier hierarchy**: Host (domain) → Cluster (path-based grouping)
- **Special clustering logic**: GitHub uses `org/repo`, AWS uses first path segment, others use first path segment
- **Bottom-up counting**: Cluster count = tab count, Host count = unique tab IDs across clusters
- **URL normalization**: Strips tracking parameters (`utm_*`, `fbclid`, etc.) and trailing slashes

### Core Data Flow
1. `pullTabs()` → Browser API query for all tabs
2. `buildModel()` → Transform flat tab list into hierarchical structure
3. `render()` → DOM manipulation using `<template>` elements for performance
4. Event handlers trigger `refresh()` → Full rebuild cycle

## Critical Implementation Patterns

### Template-Based Rendering
Use `<template>` elements in `popup.html` for all dynamic content:
```javascript
const hostTpl = $$("#hostTemplate");
const frag = hostTpl.content.cloneNode(true);
// Populate and append fragment
```

### Bulk Operations
Always use array-based `browser.tabs.remove([...ids])` for performance:
```javascript
const idsArr = Array.from(hostNode.ids);
await browser.tabs.remove(idsArr);
```

### Theme Integration
Extension adapts to browser theme via `browser.theme.getCurrent()` with CSS custom properties fallback to `prefers-color-scheme`. Theme colors are mapped to specific CSS variables in `applyThemeFromBrowser()`.

## File Structure & Responsibilities

- **`manifest.json`**: Firefox extension manifest v2, requires `tabs`, `storage`, `theme` permissions
- **`popup.html`**: Single-page UI with CSP allowing `img-src https: data: moz-extension:` for favicons
- **`popup.js`**: All logic - no external dependencies, uses modern async/await
- **`popup.css`**: CSS custom properties for theming, responsive design for 580px width
- **`logo.svg`**: Brand asset (purple gradient skull+scythe theme)

## Development Workflows

### Prerequisites
- Firefox 78.0 or higher
- Node.js and npm (for web-ext tool only, not for runtime)
- Install dependencies: `npm install` (installs web-ext dev tool)

### Testing Locally
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select `manifest.json` from the repository root
4. Test in popup (click extension icon) or open in separate window

### Development with web-ext
- **Run with auto-reload**: `npx web-ext run` (starts Firefox with extension loaded)
- **Lint manifest**: `npx web-ext lint` (validates manifest.json)
- **Package**: `npx web-ext build` (creates .zip for distribution)

### Testing Changes
1. Make code changes to `popup.js`, `popup.html`, or `popup.css`
2. If using web-ext: Changes auto-reload in test browser
3. If using temporary add-on: Click reload button in `about:debugging`
4. Test tab grouping, filtering, and bulk operations
5. Verify theme adaptation works in both light and dark modes

### No Build Process Required
This is a pure JavaScript extension with no transpilation, bundling, or compilation steps. Edit files directly and reload the extension.

### URL Handling Specifics
- **Filtering**: Excludes `about:`, `moz-extension:`, `chrome:` schemes
- **GitHub clustering**: `github.com/org/repo` → cluster by `org/repo`
- **AWS clustering**: AWS domains → cluster by service name (first path segment)
- **Generic clustering**: First path segment or "/" for root

## UI/UX Conventions

### Interactive Elements
- **"Reap" buttons**: Purple accent color, confirmation for ≥10 tabs
- **Twisty toggles**: `▸`/`▾` for expand/collapse states
- **Search**: Real-time filtering across host/path/title
- **Sorting**: Count (default) or alphabetical

### Styling Patterns
- **Host cards**: Rounded borders, purple accent gradient header
- **Clusters**: Left border with dotted line, indented from host
- **Tabs**: Hover effects, favicon display, truncated text with ellipsis

## Performance Considerations
- **Shallow hierarchy**: Avoids deep nesting performance issues
- **Template cloning**: More efficient than innerHTML manipulation  
- **Bulk operations**: Single API calls for multiple tab operations
- **Favicon CSP**: Enables fast icon loading from any HTTPS source

## Extension-Specific Gotchas
- **Manifest v2**: Uses `browser_action` not `action` (v3 syntax)
- **Firefox-specific**: `applications.gecko` field for Firefox compatibility
- **Async handling**: All `browser.tabs.*` calls are promises, wrap in try/catch
- **URL parsing**: Always validate URLs in try/catch blocks due to malformed URLs

## Coding Standards and Conventions
- **No external dependencies**: Keep the extension dependency-free for simplicity and security
- **Single responsibility**: Each function should have one clear purpose
- **Error handling**: Always wrap browser API calls in try/catch blocks
- **Performance first**: Use template cloning, bulk operations, and shallow hierarchies
- **Consistency**: Follow existing patterns for event handlers and DOM manipulation
- **Comments**: Use sparingly; code should be self-documenting with clear function and variable names
- **Modern JavaScript**: Use async/await, arrow functions, template literals, and ES6+ features

## Common Tasks and Patterns

### Adding a New Tab Filter
1. Modify the filter logic in `pullTabs()` or `buildModel()`
2. Test with various tab types (pinned, different schemes, etc.)
3. Verify counts update correctly

### Modifying Clustering Logic
1. Update `clusterFor()` function only
2. Test with relevant sites (GitHub, AWS, generic URLs)
3. Ensure existing clusters still work correctly

### Adding New UI Elements
1. Add template in `popup.html` within appropriate `<template>` tag
2. Clone and populate in `render()` function
3. Wire event handlers within render cycle
4. Add corresponding CSS in `popup.css` following existing patterns

### Theme Customization
1. Theme colors map through `applyThemeFromBrowser()`
2. CSS custom properties in `popup.css` define defaults
3. Test in both light and dark Firefox themes