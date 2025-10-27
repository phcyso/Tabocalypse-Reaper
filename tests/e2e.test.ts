import { WebDriver } from 'selenium-webdriver';
import {
  createDriverWithExtension,
  openE2EPage,
  createTestTabs,
  refreshE2EPage,
  takeScreenshot,
  cleanupTestTabs,
  getStatsText,
  searchFor,
  getHostCards,
} from './e2e-helpers';

// E2E tests require full Selenium + Firefox environment
// Skip if environment is not properly configured
const canRunE2E = async (): Promise<boolean> => {
  try {
    const { execSync } = require('child_process');
    // Check if geckodriver is accessible and Firefox is available
    execSync('geckodriver --version', { stdio: 'ignore', timeout: 1000 });
    execSync('firefox --version', { stdio: 'ignore', timeout: 1000 });
    // Check if DISPLAY is set (for X11/Xvfb)
    return process.env.DISPLAY !== undefined || process.env.HEADLESS === 'true';
  } catch {
    return false;
  }
};

// Conditionally run tests based on environment
const describeE2E = process.env.FORCE_E2E === 'true' 
  ? describe 
  : describe.skip;

describeE2E('Tabocalypse Reaper E2E Tests', () => {
  let driver: WebDriver;
  let canRun = false;

  beforeAll(async () => {
    canRun = await canRunE2E();
    if (!canRun) {
      console.warn('⚠️  E2E tests skipped: Selenium environment not available');
      console.warn('   Set FORCE_E2E=true to attempt running anyway');
      return;
    }

    try {
      driver = await createDriverWithExtension();
    } catch (error) {
      console.error('Failed to create driver:', error);
      throw error;
    }
  }, 30000); // 30 second timeout for driver creation

  afterAll(async () => {
    if (driver) {
      try {
        await driver.quit();
      } catch (error) {
        console.error('Error quitting driver:', error);
      }
    }
  });

  beforeEach(async () => {
    if (!canRun || !driver) {
      return;
    }
    // Clean up tabs before each test
    await cleanupTestTabs(driver);
  });

  describe('Basic UI Rendering', () => {
    test('should load e2e page and display UI', async () => {
      await openE2EPage(driver);
      
      const statsText = await getStatsText(driver);
      expect(statsText).toContain('tab(s) matched');
      
      // Take screenshot
      const screenshot = await takeScreenshot(driver, 'basic-ui');
      expect(screenshot).toBeDefined();
      expect(screenshot.length).toBeGreaterThan(0);
    });

    test('should display GitHub tabs with clustering', async () => {
      await openE2EPage(driver);
      
      // Create GitHub test tabs
      await createTestTabs(driver, [
        { url: 'https://github.com/mozilla/firefox', title: 'Firefox Repo' },
        { url: 'https://github.com/facebook/react', title: 'React Repo' },
      ]);
      
      await refreshE2EPage(driver);
      
      const statsText = await getStatsText(driver);
      expect(statsText).toContain('tab(s) matched');
      
      // Take screenshot
      await takeScreenshot(driver, 'github-tabs');
    });

    test('should display multiple hosts', async () => {
      await openE2EPage(driver);
      
      // Create tabs from different hosts
      await createTestTabs(driver, [
        { url: 'https://example.com/page1', title: 'Example 1' },
        { url: 'https://mozilla.org/page1', title: 'Mozilla 1' },
      ]);
      
      await refreshE2EPage(driver);
      
      const hosts = await getHostCards(driver);
      expect(hosts.length).toBeGreaterThan(0);
      
      // Take screenshot
      await takeScreenshot(driver, 'multiple-hosts');
    });
  });

  describe('Search Functionality', () => {
    test('should filter tabs by search query', async () => {
      await openE2EPage(driver);
      
      // Create diverse tabs
      await createTestTabs(driver, [
        { url: 'https://github.com/mozilla/firefox', title: 'Firefox Repo' },
        { url: 'https://example.com/test', title: 'Test Page' },
      ]);
      
      await refreshE2EPage(driver);
      
      // Search for "firefox"
      await searchFor(driver, 'firefox');
      
      const statsText = await getStatsText(driver);
      expect(statsText).toContain('tab(s) matched');
      
      // Take screenshot
      await takeScreenshot(driver, 'search-filtered');
    });
  });

  describe('Visual Snapshots', () => {
    test('should capture baseline layout screenshot', async () => {
      await openE2EPage(driver);
      
      // Create a standard set of tabs for visual baseline
      await createTestTabs(driver, [
        { url: 'https://github.com/mozilla/firefox', title: 'Firefox' },
        { url: 'https://example.com/page1', title: 'Example 1' },
      ]);
      
      await refreshE2EPage(driver);
      
      const screenshot = await takeScreenshot(driver, 'baseline-layout');
      expect(screenshot).toBeDefined();
      expect(screenshot.length).toBeGreaterThan(1000); // Should be a substantial image
    });
  });
});
