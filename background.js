// Background script for E2E testing
// Opens e2e.html when E2E_MODE environment variable is set
// This file is conditionally loaded via manifest.json

// Check if we're in E2E test mode by looking for a specific storage flag
browser.storage.local.get('e2eMode').then((result) => {
  if (result.e2eMode) {
    // Open e2e.html in a new tab for testing
    browser.tabs.create({
      url: browser.runtime.getURL('e2e.html'),
      active: true
    });
  }
});

// Listen for messages from test environment to open e2e page
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openE2EPage') {
    browser.tabs.create({
      url: browser.runtime.getURL('e2e.html'),
      active: true
    }).then((tab) => {
      sendResponse({ success: true, tabId: tab.id });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep message channel open for async response
  }
});
