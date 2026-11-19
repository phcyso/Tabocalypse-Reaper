import { STALE_MS } from "../shared/constants.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Relative age for the staleness chip (review F3): "3m", "3h", "2d".
 * Returns "" (no chip) for anything younger than a minute — a "0m" chip on
 * every fresh tab is pure noise.
 */
export function formatAge(ageMs: number): string {
  if (ageMs < MINUTE_MS) {
    return "";
  }
  if (ageMs < HOUR_MS) {
    return `${Math.floor(ageMs / MINUTE_MS)}m`;
  }
  if (ageMs < DAY_MS) {
    return `${Math.floor(ageMs / HOUR_MS)}h`;
  }
  return `${Math.floor(ageMs / DAY_MS)}d`;
}

/** True when a tab's last access is older than the staleness threshold. */
export function isStale(lastAccessed: number, now: number, staleMs: number = STALE_MS): boolean {
  return now - lastAccessed > staleMs;
}
