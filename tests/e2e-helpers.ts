import { Builder, WebDriver, By, until } from 'selenium-webdriver';
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
  
  // Allow unsigned extensions
  options.setPreference('xpinstall.signatures.required', false);
  options.setPreference('extensions.autoDisableScopes', 0);
  options.setPreference('extensions.enabledScopes', 15);

  const driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .build();

  try {
    // Install the extension as a temporary add-on
    // Using any cast because installAddon is a Firefox-specific method not in WebDriver types
    const extensionId = await (driver as any).installAddon(EXTENSION_PATH, true);
    console.log(`Extension installed with ID: ${extensionId}`);
    
    // Give extension time to initialize
    await driver.sleep(2000);
  } catch (error) {
    console.error('Failed to install extension:', error);
    await driver.quit();
    throw error;
  }

  return driver;
}

/**
 * Open the E2E test page
 */
export async function openE2EPage(driver: WebDriver): Promise<void> {
  // Get the extension's UUID by querying installed extensions
  // For temporary extensions, we need to find the extension's internal URL
  
  try {
    // Navigate to a blank page first
    await driver.get('about:blank');
    
    // Execute script in privileged context to open e2e page via extension API
    const tabId = await driver.executeAsyncScript(`
      const callback = arguments[arguments.length - 1];
      
      if (typeof browser === 'undefined') {
        callback(null);
        return;
      }
      
      browser.tabs.create({
        url: browser.runtime.getURL('e2e.html'),
        active: true
      }).then(tab => {
        callback(tab.id);
      }).catch(err => {
        callback(null);
      });
    `);
    
    if (tabId) {
      console.log('E2E page opened via extension API');
      // Give page time to load
      await driver.sleep(2000);
    } else {
      throw new Error('Failed to open e2e page via extension API');
    }
    
    // Wait for the tree element to ensure page is loaded
    await driver.wait(until.elementLocated(By.id('tree')), E2E_PAGE_LOAD_TIMEOUT);
    
  } catch (error) {
    console.error('Error opening E2E page:', error);
    throw error;
  }
}

/**
 * Create test tabs with specific URLs
 */
export async function createTestTabs(driver: WebDriver, tabs: TestTab[]): Promise<void> {
  for (const tab of tabs) {
    try {
      await driver.executeAsyncScript(`
        const callback = arguments[arguments.length - 1];
        
        if (typeof browser === 'undefined') {
          callback(false);
          return;
        }
        
        browser.tabs.create({
          url: "${tab.url}",
          pinned: ${tab.pinned || false},
          active: false
        }).then(() => {
          callback(true);
        }).catch(err => {
          console.error('Error creating tab:', err);
          callback(false);
        });
      `);
    } catch (error) {
      console.error(`Failed to create tab ${tab.url}:`, error);
    }
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
  try {
    await driver.executeAsyncScript(`
      const callback = arguments[arguments.length - 1];
      
      if (typeof browser === 'undefined') {
        callback(false);
        return;
      }
      
      browser.tabs.query({}).then(tabs => {
        const tabsToRemove = tabs
          .filter(t => !t.url.includes('e2e.html'))
          .map(t => t.id);
        
        if (tabsToRemove.length > 0) {
          return browser.tabs.remove(tabsToRemove);
        }
      }).then(() => {
        callback(true);
      }).catch(err => {
        console.error('Error cleaning up tabs:', err);
        callback(false);
      });
    `);
    
    await driver.sleep(500);
  } catch (error) {
    console.error('Failed to cleanup tabs:', error);
  }
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
    try {
      const name = await card.findElement(By.css('.hostName')).getText();
      const badge = await card.findElement(By.css('.badge')).getText();
      results.push({ name, count: parseInt(badge) });
    } catch (error) {
      // Skip cards that couldn't be read
      console.warn('Failed to read host card:', error);
    }
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
        try {
          await driver.wait(until.alertIsPresent(), 1000);
          const alert = await driver.switchTo().alert();
          await alert.accept();
        } catch (error) {
          console.warn('No alert present or failed to accept:', error);
        }
      }
      
      await driver.sleep(500);
      return;
    }
  }
  
  throw new Error(`Host "${hostName}" not found`);
}

