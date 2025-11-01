import { queryOpenTabs } from "./browser/tabs.js";
import { renderTree } from "./dom/render.js";
import { requireElement } from "./dom/query.js";
import { buildTabModel } from "./model/index.js";
import { applyThemeFromBrowser } from "./theme/applyTheme.js";

async function refresh(): Promise<void> {
  const [excludePinned, normalize, filter] = readUiState();
  const tabs = await queryOpenTabs();
  const model = buildTabModel(tabs, { excludePinned, normalize, filter });
  renderTree(model, { onRefresh: refresh });
}

function readUiState(): [boolean, boolean, string] {
  const excludePinned = requireElement<HTMLInputElement>("#excludePinned").checked;
  const normalize = requireElement<HTMLInputElement>("#normalize").checked;
  const filter = requireElement<HTMLInputElement>("#search").value;
  return [excludePinned, normalize, filter];
}

function wireInteractionHandlers(): void {
  requireElement<HTMLButtonElement>("#refresh").addEventListener("click", () => {
    void refresh();
  });

  requireElement<HTMLInputElement>("#search").addEventListener("input", () => {
    void refresh();
  });

  requireElement<HTMLInputElement>("#excludePinned").addEventListener("change", () => {
    void refresh();
  });

  requireElement<HTMLInputElement>("#normalize").addEventListener("change", () => {
    void refresh();
  });

}

async function init(): Promise<void> {
  await applyThemeFromBrowser();
  wireInteractionHandlers();
  await refresh();
}

document.addEventListener("DOMContentLoaded", () => {
  void init();
});
