export const CONFIRM_THRESHOLD = 10;

/** A tab is "stale" when untouched for longer than this (review F3, default 24h). */
export const STALE_MS = 24 * 60 * 60 * 1000;

/** Above this many hosts the tree auto-collapses everything on open (review A1/F9). */
export const AUTO_COLLAPSE_HOST_COUNT = 20;

/** How long the post-reap undo toast stays on screen (review F1). */
export const UNDO_TOAST_MS = 8000;
