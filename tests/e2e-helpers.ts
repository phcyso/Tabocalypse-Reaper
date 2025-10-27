import { Builder, WebDriver, By, until, logging } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox';
import path from 'path';
import fs from 'fs';

const EXTENSION_PATH = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.resolve(__dirname, '../test-screenshots');
const E2E_PAGE_LOAD_TIMEOUT = 10000;

export interface TestTab {
  url: string;
  pinned?: boolean;
  title?: string;
}

/**
 * Create a Firefox driver with the extension loaded
 */
export async function createDriverWithExtension(): Promise<WebDriver> {
  // Ensure screenshots directory exists
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  const options = new firefox.Options();
  
  // Headless mode for CI
  if (process.env.CI || process.env.HEADLESS) {
    options.addArguments('-headless');
  }
  
  // Disable animations for stable screenshots
  options.setPreference('ui.prefersReducedMotion', 1);
  
  // Load extension
  const extensionPath = path.join(EXTENSION_PATH, 'manifest.json');
  console.log(`Loading extension from: ${extensionPath}`);
  
  // Use temporary profile to avoid conflicts
  options.setPreference('xpinstall.signatures.required', false);
  options.setPreference('extensions.webextensions.uuids', 
    `{"tabocalypse-reaper@example.com": "{test-uuid}"}`);

  const driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .build();

  // Install the extension
  await driver.installAddon(EXTENSION_PATH, true);
  
  // Give extension time to initialize
  await driver.sleep(2000);

  return driver;
}

/**
 * Open the E2E test page
 */
export async function openE2EPage(driver: WebDriver): Promise<void> {
  // The extension ID is set in manifest.json
  const e2eUrl = 'moz-extension://test-uuid/e2e.html';
  
  // Alternative: Use the background script to open e2e page
  // For now, we'll open it directly via all tabs and find the extension URL
  const handles = await driver.getAllWindowHandles();
  
  // Try to find if e2e page is already open
  let e2eHandle = null;
  for (const handle of handles) {
    await driver.switchTo().window(handle);
    const url = await driver.getCurrentUrl();
    if (url.includes('e2e.html')) {
      e2eHandle = handle;
      break;
    }
  }
  
  if (!e2eHandle) {
    // Open a new tab and navigate to e2e page
    await driver.executeScript('window.open("about:blank", "_blank");');
    const newHandles = await driver.getAllWindowHandles();
    const newHandle = newHandles.find(h => !handles.includes(h));
    if (newHandle) {
      await driver.switchTo().window(newHandle);
    }
    
    // Get the extension's internal URL
    // We need to get it from the extension context
    // For now, use a workaround: load the extension page via special protocol
    const allTabs = await driver.executeScript(`
      return browser.tabs.query({}).then(tabs => 
        tabs.map(t => ({ id: t.id, url: t.url }))
      );
    `);
    
    // Create e2e tab via extension API
    await driver.executeScript(`
      return browser.tabs.create({
        url: browser.runtime.getURL('e2e.html'),
        active: true
      });
    `);
    
    await driver.sleep(1000);
  }
  
  // Wait for page to load
  await driver.wait(until.elementLocated(By.id('tree')), E2E_PAGE_LOAD_TIMEOUT);
}

/**
 * Create test tabs with specific URLs
 */
export async function createTestTabs(driver: WebDriver, tabs: TestTab[]): Promise<void> {
  for (const tab of tabs) {
    await driver.executeScript(`
      return browser.tabs.create({
        url: "${tab.url}",
        pinned: ${tab.pinned || false},
        active: false
      });
    `);
  }
  
  // Give tabs time to load
  await driver.sleep(1000);
}

/**
 * Refresh the E2E page to reflect current tab state
 */
export async function refreshE2EPage(driver: WebDriver): Promise<void> {
  const refreshBtn = await driver.findElement(By.id('refresh'));
  await refreshBtn.click();
  await driver.sleep(500); // Wait for render
}

/**
 * Take a screenshot and save it
 */
export async function takeScreenshot(
  driver: WebDriver,
  name: string
): Promise<Buffer> {
  const screenshot = await driver.takeScreenshot();
  const buffer = Buffer.from(screenshot, 'base64');
  
  const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  fs.writeFileSync(filepath, buffer);
  console.log(`Screenshot saved: ${filepath}`);
  
  return buffer;
}

/**
 * Clean up all tabs except the E2E page
 */
export async function cleanupTestTabs(driver: WebDriver): Promise<void> {
  await driver.executeScript(`
    return browser.tabs.query({}).then(tabs => {
      const tabsToRemove = tabs
        .filter(t => !t.url.includes('e2e.html'))
        .map(t => t.id);
      return browser.tabs.remove(tabsToRemove);
    });
  `);
  
  await driver.sleep(500);
}

/**
 * Get the text content of the stats element
 */
export async function getStatsText(driver: WebDriver): Promise<string> {
  const stats = await driver.findElement(By.id('stats'));
  return await stats.getText();
}

/**
 * Type in the search box
 */
export async function searchFor(driver: WebDriver, query: string): Promise<void> {
  const search = await driver.findElement(By.id('search'));
  await search.clear();
  await search.sendKeys(query);
  await driver.sleep(500); // Wait for filter to apply
}

/**
 * Change sort order
 */
export async function setSortOrder(driver: WebDriver, order: 'count' | 'alpha'): Promise<void> {
  const sortSelect = await driver.findElement(By.id('sort'));
  await sortSelect.sendKeys(order === 'alpha' ? 'A' : 'C');
  await driver.sleep(500);
}

/**
 * Toggle a checkbox option
 */
export async function toggleCheckbox(
  driver: WebDriver,
  id: string,
  checked: boolean
): Promise<void> {
  const checkbox = await driver.findElement(By.id(id));
  const isChecked = await checkbox.isSelected();
  
  if (isChecked !== checked) {
    await checkbox.click();
    await driver.sleep(500);
  }
}

/**
 * Get all host cards
 */
export async function getHostCards(driver: WebDriver): Promise<any[]> {
  const hostCards = await driver.findElements(By.css('.hostCard'));
  const results = [];
  
  for (const card of hostCards) {
    const name = await card.findElement(By.css('.hostName')).getText();
    const badge = await card.findElement(By.css('.badge')).getText();
    results.push({ name, count: parseInt(badge) });
  }
  
  return results;
}

/**
 * Click a twisty to expand/collapse
 */
export async function clickHostTwisty(
  driver: WebDriver,
  hostName: string
): Promise<void> {
  const hostCards = await driver.findElements(By.css('.hostCard'));
  
  for (const card of hostCards) {
    const name = await card.findElement(By.css('.hostName')).getText();
    if (name === hostName) {
      const twisty = await card.findElement(By.css('.hostHeader .twisty'));
      await twisty.click();
      await driver.sleep(300);
      return;
    }
  }
  
  throw new Error(`Host "${hostName}" not found`);
}

/**
 * Click reap button for a host
 */
export async function reapHost(
  driver: WebDriver,
  hostName: string,
  confirmDialog: boolean = false
): Promise<void> {
  const hostCards = await driver.findElements(By.css('.hostCard'));
  
  for (const card of hostCards) {
    const name = await card.findElement(By.css('.hostName')).getText();
    if (name === hostName) {
      const closeBtn = await card.findElement(By.css('.hostHeader .close'));
      await closeBtn.click();
      
      if (confirmDialog) {
        // Handle confirmation dialog
        await driver.wait(until.alertIsPresent(), 1000);
        const alert = await driver.switchTo().alert();
        await alert.accept();
      }
      
      await driver.sleep(500);
      return;
    }
  }
  
  throw new Error(`Host "${hostName}" not found`);
}
