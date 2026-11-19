/**
 * Natural, case-insensitive string comparison: "item 2" sorts before "item 10", and
 * CJK/accented titles order sensibly (audit finding F-15).
 */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
