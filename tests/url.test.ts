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

  it("strips every tracking param in consecutive runs (audit F-14b)", () => {
    const result = normalizeUrl("https://example.com/page?utm_a=1&utm_b=2&utm_c=3&keep=1");
    expect(new URL(result).search).toBe("?keep=1");
  });

  it("strips a realistic mixed tracking sequence completely (audit F-14b)", () => {
    const params = new URL(
      normalizeUrl(
        "https://example.com/page?utm_source=a&keep=1&utm_medium=b&utm_campaign=c&gclid=x"
      )
    ).searchParams;
    expect(params.get("keep")).toBe("1");
    expect(params.get("utm_source")).toBeNull();
    expect(params.get("utm_medium")).toBeNull();
    expect(params.get("utm_campaign")).toBeNull();
    expect(params.get("gclid")).toBeNull();
  });

  it("keeps names that merely contain ref, strips exact matches (audit F-14a)", () => {
    const params = new URL(
      normalizeUrl(
        "https://example.com/page?prefix=p&reference=r&preference=pr&grep=g&refpage=rp&ref=strip&ref_page=strip"
      )
    ).searchParams;
    expect(params.get("prefix")).toBe("p");
    expect(params.get("reference")).toBe("r");
    expect(params.get("preference")).toBe("pr");
    expect(params.get("grep")).toBe("g");
    expect(params.get("refpage")).toBe("rp");
    expect(params.get("ref")).toBeNull();
    expect(params.get("ref_page")).toBeNull();
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

  it("does not match lookalike hosts like notgithub.com (audit F-12)", () => {
    const url = new URL("https://notgithub.com/org/repo/tree/main");
    const { key } = deriveClusterKey(url);
    expect(key).toBe("org");
  });

  it("still matches github.com subdomains like gist.github.com (audit F-12)", () => {
    const url = new URL("https://gist.github.com/user/gistid/abc");
    const { key, remainder } = deriveClusterKey(url);
    expect(key).toBe("user/gistid");
    expect(buildSubpath(remainder)).toBe("abc");
  });

  it("keeps the bare-org fallback for github.com/org (audit F-12)", () => {
    const url = new URL("https://github.com/phcyso");
    const { key } = deriveClusterKey(url);
    expect(key).toBe("phcyso");
  });

  it("clusters raw.githubusercontent.com by user/repo (audit F-13)", () => {
    const url = new URL("https://raw.githubusercontent.com/phcyso/Tabocalypse-Reaper/main/README.md");
    const { key, remainder } = deriveClusterKey(url);
    expect(key).toBe("phcyso/Tabocalypse-Reaper");
    expect(buildSubpath(remainder)).toBe("main/README.md");
  });

  it("keeps separate raw repos of one user apart (audit F-13)", () => {
    const a = deriveClusterKey(new URL("https://raw.githubusercontent.com/octocat/Spoon-Knife/main/README.md"));
    const b = deriveClusterKey(
      new URL("https://raw.githubusercontent.com/phcyso/Tabocalypse-Reaper/main/README.md")
    );
    expect(a.key).not.toBe(b.key);
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

  it("documents that host-less schemes parse with an empty host (audit F-4)", () => {
    // buildTabModel skips URLs whose parsed host is empty so these never form an
    // unnamed host card — see tests/model.test.ts.
    for (const url of [
      "file:///home/example/notes.txt",
      "data:text/html,hello",
      "view-source:https://example.com/page",
      "javascript:void 0",
      "blob:https://example.com/9f8b1e2a",
    ]) {
      expect(new URL(url).host, url).toBe("");
      expect(shouldIgnoreUrl(url), url).toBe(false);
    }
  });
});
