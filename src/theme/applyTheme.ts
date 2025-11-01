type ThemeColorValue = string | [number, number, number] | [number, number, number, number];

type ThemeColors = browser._manifest.ThemeType["colors"];

function toCssColor(value: ThemeColorValue | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  const [r, g, b, maybeAlpha] = value;
  if (typeof maybeAlpha === "number") {
    return `rgba(${r}, ${g}, ${b}, ${maybeAlpha})`;
  }
  return `rgb(${r}, ${g}, ${b})`;
}

function assignColor(variable: string, value: ThemeColorValue | null | undefined, root: HTMLElement): void {
  const resolved = toCssColor(value);
  if (resolved) {
    root.style.setProperty(variable, resolved);
  }
}

/**
 * Pulls the active Firefox theme colors (when available) and maps them onto the popup's
 * CSS variables so the extension mirrors the host browser chrome.
 */
export async function applyThemeFromBrowser(): Promise<void> {
  try {
    if (!browser.theme?.getCurrent) {
      return;
    }

    const theme = await browser.theme.getCurrent();
    if (!theme?.colors) {
      return;
    }

    const colors: ThemeColors = theme.colors;
    const root = document.documentElement;

    assignColor("--card", colors.popup, root);
    assignColor("--bg", colors.toolbar_field, root);
    assignColor("--accent", colors.accentcolor, root);
    assignColor("--text", colors.textcolor ?? colors.toolbar_field_text, root);

    if (colors.toolbar) {
      root.style.setProperty("--line", "rgba(128,128,128,0.25)");
    }
  } catch (error) {
    console.error("Failed to apply browser theme", error);
  }
}
