import { describe, expect, it } from "vitest";

import { avatarHue, avatarLetter } from "../src/utils/avatar";

describe("letter-avatar fallback helpers (review A3)", () => {
  it("derives a deterministic hue from the hostname", () => {
    const first = avatarHue("github.com");
    expect(first).toBe(avatarHue("github.com"));
    expect(first).toBe(avatarHue("GITHUB.COM"));
    expect(Number.isInteger(first)).toBe(true);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(360);
  });

  it("spreads different hosts across hues", () => {
    const hues = new Set(
      ["github.com", "example.com", "news.ycombinator.com", "docs.aws.amazon.com"].map(avatarHue)
    );
    // Collisions are possible in principle but not for this sample.
    expect(hues.size).toBe(4);
  });

  it("returns hue 0 for the empty hostname", () => {
    expect(avatarHue("")).toBe(0);
  });

  it("takes the uppercased first letter as the avatar letter", () => {
    expect(avatarLetter("example.com")).toBe("E");
    expect(avatarLetter("docs.aws.amazon.com")).toBe("D");
  });

  it("falls back to '?' when there is no letter", () => {
    expect(avatarLetter("")).toBe("?");
    expect(avatarLetter("   ")).toBe("?");
  });
});
