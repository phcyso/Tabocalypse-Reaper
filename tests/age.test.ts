import { describe, expect, it } from "vitest";

import { formatAge, isStale } from "../src/utils/age";
import { STALE_MS } from "../src/shared/constants.js";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("formatAge (review F3 age chips)", () => {
  it("hides the chip for anything younger than a minute", () => {
    expect(formatAge(0)).toBe("");
    expect(formatAge(59_999)).toBe("");
  });

  it("uses minutes under an hour", () => {
    expect(formatAge(MINUTE)).toBe("1m");
    expect(formatAge(3 * MINUTE)).toBe("3m");
    expect(formatAge(59 * MINUTE + 59_999)).toBe("59m");
  });

  it("uses hours under a day", () => {
    expect(formatAge(HOUR)).toBe("1h");
    expect(formatAge(3 * HOUR)).toBe("3h");
  });

  it("uses days beyond 24h", () => {
    expect(formatAge(DAY)).toBe("1d");
    expect(formatAge(2 * DAY + 3 * HOUR)).toBe("2d");
    expect(formatAge(14 * DAY)).toBe("14d");
  });
});

describe("isStale (review F3)", () => {
  const now = 10 * DAY;

  it("flags tabs untouched longer than the threshold", () => {
    expect(isStale(now - STALE_MS - 1, now)).toBe(true);
    expect(isStale(now - STALE_MS - HOUR, now)).toBe(true);
  });

  it("keeps fresh tabs unstale, boundary exclusive", () => {
    expect(isStale(now, now)).toBe(false);
    expect(isStale(now - STALE_MS, now)).toBe(false);
    expect(isStale(now - STALE_MS + 1, now)).toBe(false);
  });
});
