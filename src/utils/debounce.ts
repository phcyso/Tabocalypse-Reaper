export interface DebouncedFn<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

/**
 * Trailing-edge debounce: collapses a burst of calls into a single invocation after
 * `waitMs` of silence. Used for the filter box so each keystroke doesn't trigger a
 * full tabs.query + model + render cycle (audit finding F-9).
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number): DebouncedFn<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: A): void => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };

  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}
