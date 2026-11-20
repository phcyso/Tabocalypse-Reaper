# Security Policy

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting**: open the
**Security** tab of this repository and choose *Report a vulnerability*.
You can also open a regular issue for anything you'd consider a cosmetic
bug — but please use private reporting for anything security-relevant.

## What Tabocalypse Reaper can and cannot do

Tabocalypse Reaper is a browser extension whose entire job is **closing
your tabs**. Knowing that shapes what a vulnerability means here:

- The extension has no server, no analytics, and makes **no network
  requests**. All data it touches (tab URLs/titles, UI preferences, the
  undo snapshot) stays in your browser's session storage and dies with
  the browser session.
- The worst a bug can realistically do is close tabs you did not intend
  to close, or mis-group tabs in the popup.
- It cannot read page content, execute remote code, or exfiltrate
  anything — the manifest permissions are exactly `tabs`, `storage`
  (session-only), and `theme`.

## Scope

- **In scope:** anything that lets the extension reap tabs outside the
  user's explicit action (the confirm guard, pinned-tab protection, or
  Undo), or that leaks session data outside the browser.
- **Out of scope:** GitHub Pages/website content, build tooling in
  `docker/`, and this repository's own CI.

## Supported versions

Only the latest release is supported. Releases are cut from `v*` tags;
update to the newest one before reporting.
