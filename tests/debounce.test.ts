import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { debounce } from "../src/utils/debounce";

describe("debounce (audit F-9)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses a rapid burst into one trailing invocation", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 140);

    debounced("a");
    vi.advanceTimersByTime(50);
    debounced("b");
    vi.advanceTimersByTime(50);
    debounced("c");

    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(139);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
  });

  it("fires again after the wait when called later", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 140);

    debounced("first");
    vi.advanceTimersByTime(140);
    expect(fn).toHaveBeenCalledTimes(1);

    debounced("second");
    vi.advanceTimersByTime(140);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("second");
  });

  it("drops the pending call when cancelled", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 140);

    debounced("only");
    debounced.cancel();
    vi.advanceTimersByTime(500);

    expect(fn).not.toHaveBeenCalled();
  });
});
