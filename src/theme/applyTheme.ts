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
 *
 * Coherence guard (audit finding F-17): the mapping only applies when a coherent popup
 * pair (`popup` + `popup_text`) exists. A custom theme defining, say, `textcolor` but
 * no `popup` would otherwise pair light text with the dark `--card` from the
 * prefers-color-scheme media query — partial palettes are ignored entirely and the
 * popup falls back to its native light/dark styling.
 */
export async function applyThemeFromBrowser(): Promise<void> {
  try {
    if (!browser.theme?.getCurrent) {
      return;
    }

    const theme = await browser.theme.getCurrent();
    const colors: ThemeColors | undefined = theme?.colors;
    if (!colors) {
      return;
    }

    const popup = toCssColor(colors.popup);
    const popupText = toCssColor(colors.popup_text);
    if (!popup || !popupText) {
      return;
    }

    const root = document.documentElement;
    root.style.setProperty("--card", popup);
    root.style.setProperty("--text", popupText);

    assignColor("--bg", colors.toolbar_field, root);
    assignColor("--accent", colors.accentcolor, root);

    if (colors.toolbar) {
      root.style.setProperty("--line", "rgba(128,128,128,0.25)");
    }
  } catch (error) {
    console.error("Failed to apply browser theme", error);
  }
}
