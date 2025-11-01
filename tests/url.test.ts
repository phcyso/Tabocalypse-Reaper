import { describe, expect, it } from "vitest";

import { buildSubpath, deriveClusterKey, normalizeUrl, shouldIgnoreUrl } from "../src/utils/url";

describe("normalizeUrl", () => {
  it("strips tracking parameters and trailing slashes", () => {
    const result = normalizeUrl("https://example.com/path/?utm_source=foo&keep=1//");
    const normalized = new URL(result);
    expect(normalized.pathname).toBe("/path");
    expect(normalized.searchParams.get("utm_source")).toBeNull();
    expect(normalized.searchParams.get("keep")).toBe("1//");
  });

  it("returns original URL when parsing fails", () => {
    const malformed = "http://%zz";
    expect(normalizeUrl(malformed)).toBe(malformed);
  });
});

describe("deriveClusterKey", () => {
  it("derives GitHub repository clusters", () => {
    const url = new URL("https://github.com/org/repo/issues/1");
    const { key, remainder } = deriveClusterKey(url);
    expect(key).toBe("org/repo");
    expect(buildSubpath(remainder)).toBe("issues/1");
  });

  it("uses first segment for generic hosts", () => {
    const url = new URL("https://example.com/alpha/bravo");
    const { key, remainder } = deriveClusterKey(url);
    expect(key).toBe("alpha");
    expect(buildSubpath(remainder)).toBe("bravo");
  });
});

describe("shouldIgnoreUrl", () => {
  it("filters internal browser schemes", () => {
    expect(shouldIgnoreUrl("about:newtab")).toBe(true);
    expect(shouldIgnoreUrl("moz-extension://some-id")).toBe(true);
    expect(shouldIgnoreUrl("chrome://settings")).toBe(true);
  });

  it("allows http and https URLs", () => {
    expect(shouldIgnoreUrl("https://example.com")).toBe(false);
  });
});
