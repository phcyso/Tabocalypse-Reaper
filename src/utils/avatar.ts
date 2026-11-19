/**
 * Deterministic letter-avatar fallback for missing favicons (review A3).
 *
 * The hue is a pure hash of the hostname so every row of the same host shares
 * the same tinted avatar — stable across renders, sessions and screenshots.
 */

/** FNV-1a 32-bit hash. */
function hashString(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Hue (0–359) derived from the hostname; 0 for the empty string. */
export function avatarHue(hostname: string): number {
  if (!hostname) {
    return 0;
  }
  return hashString(hostname.toLowerCase()) % 360;
}

/** Uppercase first letter of the hostname; "?" when there is none. */
export function avatarLetter(hostname: string): string {
  const letter = hostname.trim().charAt(0).toUpperCase();
  return letter || "?";
}
