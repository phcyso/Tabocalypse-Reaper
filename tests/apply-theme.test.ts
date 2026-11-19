import { afterEach, beforeEach, describe, expect, it } from "vitest";

type AnyRecord = Record<string, unknown>;

function stubTheme(colors: unknown): void {
  (globalThis as AnyRecord).browser = {
    theme: {
      getCurrent: async () => ({ colors }),
    },
  };
}

function cssVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

describe("applyThemeFromBrowser coherence guard (audit F-17)", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
  });

  afterEach(() => {
    delete (globalThis as AnyRecord).browser;
  });

  it("applies a complete palette", async () => {
    stubTheme({
      popup: "#ff0000",
      popup_text: [0, 255, 0],
      toolbar_field: "#0000ff",
      accentcolor: "#123456",
      toolbar: "#abcdef",
    });
    const { applyThemeFromBrowser } = await import("../src/theme/applyTheme.js");

    await applyThemeFromBrowser();

    expect(cssVar("--card")).toBe("#ff0000");
    expect(cssVar("--text")).toBe("rgb(0, 255, 0)");
    expect(cssVar("--bg")).toBe("#0000ff");
    expect(cssVar("--accent")).toBe("#123456");
    expect(cssVar("--line")).toBe("rgba(128,128,128,0.25)");
  });

  it("ignores a partial palette: textcolor without popup", async () => {
    stubTheme({ textcolor: "#ffffff", toolbar: "#abcdef" });
    const { applyThemeFromBrowser } = await import("../src/theme/applyTheme.js");

    await applyThemeFromBrowser();

    expect(cssVar("--card")).toBe("");
    expect(cssVar("--text")).toBe("");
    expect(cssVar("--bg")).toBe("");
    expect(cssVar("--accent")).toBe("");
    expect(cssVar("--line")).toBe("");
  });

  it("ignores a partial palette: popup without popup_text", async () => {
    stubTheme({ popup: "#ff0000", toolbar_field: "#0000ff" });
    const { applyThemeFromBrowser } = await import("../src/theme/applyTheme.js");

    await applyThemeFromBrowser();

    expect(cssVar("--card")).toBe("");
    expect(cssVar("--text")).toBe("");
  });

  it("does nothing when the theme exposes no colors", async () => {
    stubTheme(undefined);
    const { applyThemeFromBrowser } = await import("../src/theme/applyTheme.js");

    await applyThemeFromBrowser();

    expect(cssVar("--card")).toBe("");
  });
});
