# Tabocalypse Reaper - AI Development Guide

## Project Overview
A Firefox browser extension that organizes tabs using a **Host → Cluster** hierarchy for efficient tab management. Built with manifest v2, vanilla JavaScript, and focuses on performance and theme adaptability.

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

### Testing Locally
1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select `manifest.json`
4. Test in popup or separate window

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