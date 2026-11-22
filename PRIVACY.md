# Privacy Policy

**Tabocalypse Reaper collects no data.** There is no analytics, no
telemetry, no accounts, and no advertising. The extension makes no network
requests of its own and contains no third-party code.

Last updated: 2026-11-22 · Contact: [GitHub issues](https://github.com/phcyso/Tabocalypse-Reaper/issues)

## What stays on your device

- **Your tabs.** The extension reads your open tabs (title, address,
  favicon, pinned state, window/container/group membership) to group and
  display them, and closes the ones you choose to reap. This information
  never leaves your browser.
- **Your preferences.** Sort order, the "exclude pinned" toggle, and the
  window-scope choice are kept in `browser.storage.session`, which Firefox
  wipes when the browser closes.
- **Your undo snapshot.** The last reap (addresses and titles of the closed
  tabs) is kept in session storage for at most the current session so the
  Undo toast can restore it.

## What the permissions are for

| Permission | Why |
|---|---|
| `tabs` | Enumerate open tabs (title/URL/favicon) and close the ones you reap. |
| `storage` | Session-only preferences and the last-reap undo snapshot (above). |
| `theme` | Match the popup's colours to your Firefox theme. |
| `tabGroups` | Name and colour your existing Firefox tab groups in the list. |
| `contextualIdentities` | Label rows with their container's name and colour. |

## Favicons

The popup displays the same favicon images Firefox has already fetched for
your open tabs. Displaying them sends no data about you to those sites.

## Declaration

The extension declares `data_collection_permissions: ["none"]` in its
manifest — it does not collect or transmit any data.
