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
  setSortOrder,
  toggleCheckbox,
  getHostCards,
  clickHostTwisty,
  reapHost,
} from './e2e-helpers';

describe('Tabocalypse Reaper E2E Tests', () => {
  let driver: WebDriver;

  beforeAll(async () => {
    driver = await createDriverWithExtension();
  });

  afterAll(async () => {
    if (driver) {
      await driver.quit();
    }
  });

  beforeEach(async () => {
    // Clean up tabs before each test
    await cleanupTestTabs(driver);
  });

  describe('Basic UI Rendering', () => {
    test('should load e2e page and display empty state', async () => {
      await openE2EPage(driver);
      
      const statsText = await getStatsText(driver);
      expect(statsText).toContain('0 tab(s) matched');
      
      // Take screenshot
      const screenshot = await takeScreenshot(driver, 'empty-state');
      expect(screenshot).toBeDefined();
    });

    test('should display GitHub tabs with org/repo clustering', async () => {
      await openE2EPage(driver);
      
      // Create GitHub test tabs
      await createTestTabs(driver, [
        { url: 'https://github.com/mozilla/firefox', title: 'Firefox Repo' },
        { url: 'https://github.com/mozilla/gecko-dev', title: 'Gecko Dev' },
        { url: 'https://github.com/facebook/react', title: 'React Repo' },
        { url: 'https://github.com/facebook/react/issues', title: 'React Issues' },
      ]);
      
      await refreshE2EPage(driver);
      
      const statsText = await getStatsText(driver);
      expect(statsText).toContain('4 tab(s) matched');
      
      const hosts = await getHostCards(driver);
      expect(hosts).toHaveLength(1);
      expect(hosts[0].name).toBe('github.com');
      expect(hosts[0].count).toBe(4);
      
      // Take screenshot
      await takeScreenshot(driver, 'github-tabs');
    });

    test('should display AWS tabs with service clustering', async () => {
      await openE2EPage(driver);
      
      // Create AWS test tabs
      await createTestTabs(driver, [
        { url: 'https://console.aws.amazon.com/s3/buckets', title: 'S3 Buckets' },
        { url: 'https://console.aws.amazon.com/s3/home', title: 'S3 Home' },
        { url: 'https://console.aws.amazon.com/ec2/instances', title: 'EC2 Instances' },
        { url: 'https://docs.aws.amazon.com/lambda/latest/dg/', title: 'Lambda Docs' },
      ]);
      
      await refreshE2EPage(driver);
      
      const hosts = await getHostCards(driver);
      expect(hosts.length).toBeGreaterThan(0);
      
      // Take screenshot
      await takeScreenshot(driver, 'aws-tabs');
    });

    test('should display generic website tabs', async () => {
      await openE2EPage(driver);
      
      // Create generic test tabs
      await createTestTabs(driver, [
        { url: 'https://www.mozilla.org/en-US/firefox/', title: 'Firefox' },
        { url: 'https://www.mozilla.org/en-US/about/', title: 'About Mozilla' },
        { url: 'https://example.com/', title: 'Example' },
        { url: 'https://example.com/page1', title: 'Page 1' },
      ]);
      
      await refreshE2EPage(driver);
      
      const statsText = await getStatsText(driver);
      expect(statsText).toContain('4 tab(s) matched');
      
      const hosts = await getHostCards(driver);
      expect(hosts.length).toBeGreaterThanOrEqual(2);
      
      // Take screenshot
      await takeScreenshot(driver, 'generic-tabs');
    });
  });

  describe('Multi-window and Pinned Tabs', () => {
    test('should handle tabs across multiple windows', async () => {
      await openE2EPage(driver);
      
      // Create tabs in current window
      await createTestTabs(driver, [
        { url: 'https://example.com/page1', title: 'Page 1' },
        { url: 'https://example.com/page2', title: 'Page 2' },
      ]);
      
      // Create a new window with tabs
      await driver.executeScript(`
        return browser.windows.create({
          url: ['https://example.com/page3', 'https://test.com/page1']
        });
      `);
      
      await driver.sleep(1000);
      await refreshE2EPage(driver);
      
      const statsText = await getStatsText(driver);
      expect(statsText).toContain('tab(s) matched');
      
      const hosts = await getHostCards(driver);
      expect(hosts.length).toBeGreaterThanOrEqual(2);
      
      // Take screenshot
      await takeScreenshot(driver, 'multi-window-tabs');
    });

    test('should exclude pinned tabs when option is checked', async () => {
      await openE2EPage(driver);
      
      // Create regular and pinned tabs
      await createTestTabs(driver, [
        { url: 'https://example.com/regular', title: 'Regular Tab' },
        { url: 'https://example.com/pinned', title: 'Pinned Tab', pinned: true },
      ]);
      
      await refreshE2EPage(driver);
      
      // With exclude pinned checked (default)
      let statsText = await getStatsText(driver);
      expect(statsText).toContain('1 tab(s) matched');
      
      // Uncheck exclude pinned
      await toggleCheckbox(driver, 'excludePinned', false);
      
      statsText = await getStatsText(driver);
      expect(statsText).toContain('2 tab(s) matched');
      
      // Take screenshot
      await takeScreenshot(driver, 'pinned-tabs');
    });
  });

  describe('Search and Filtering', () => {
    test('should filter tabs by search query', async () => {
      await openE2EPage(driver);
      
      // Create diverse tabs
      await createTestTabs(driver, [
        { url: 'https://github.com/mozilla/firefox', title: 'Firefox Repo' },
        { url: 'https://github.com/facebook/react', title: 'React Repo' },
        { url: 'https://example.com/test', title: 'Test Page' },
      ]);
      
      await refreshE2EPage(driver);
      
      // Search for "firefox"
      await searchFor(driver, 'firefox');
      
      const statsText = await getStatsText(driver);
      expect(statsText).toContain('1 tab(s) matched');
      
      // Take screenshot
      await takeScreenshot(driver, 'search-filter');
    });

    test('should filter by host name', async () => {
      await openE2EPage(driver);
      
      await createTestTabs(driver, [
        { url: 'https://github.com/test/repo1', title: 'Repo 1' },
        { url: 'https://example.com/page1', title: 'Page 1' },
      ]);
      
      await refreshE2EPage(driver);
      
      // Search for "github"
      await searchFor(driver, 'github');
      
      const hosts = await getHostCards(driver);
      expect(hosts).toHaveLength(1);
      expect(hosts[0].name).toBe('github.com');
      
      // Take screenshot
      await takeScreenshot(driver, 'host-filter');
    });
  });

  describe('Sorting', () => {
    test('should sort hosts by count (default)', async () => {
      await openE2EPage(driver);
      
      // Create tabs with different host counts
      await createTestTabs(driver, [
        { url: 'https://example.com/page1', title: 'Example 1' },
        { url: 'https://example.com/page2', title: 'Example 2' },
        { url: 'https://example.com/page3', title: 'Example 3' },
        { url: 'https://test.com/page1', title: 'Test 1' },
      ]);
      
      await refreshE2EPage(driver);
      
      const hosts = await getHostCards(driver);
      expect(hosts[0].count).toBeGreaterThanOrEqual(hosts[1].count);
      
      // Take screenshot
      await takeScreenshot(driver, 'sort-count');
    });

    test('should sort hosts alphabetically', async () => {
      await openE2EPage(driver);
      
      await createTestTabs(driver, [
        { url: 'https://zebra.com/page1', title: 'Zebra' },
        { url: 'https://apple.com/page1', title: 'Apple' },
        { url: 'https://banana.com/page1', title: 'Banana' },
      ]);
      
      await refreshE2EPage(driver);
      await setSortOrder(driver, 'alpha');
      
      const hosts = await getHostCards(driver);
      expect(hosts[0].name).toBe('apple.com');
      
      // Take screenshot
      await takeScreenshot(driver, 'sort-alpha');
    });
  });

  describe('URL Normalization', () => {
    test('should normalize tracking parameters', async () => {
      await openE2EPage(driver);
      
      // Create tabs with tracking params
      await createTestTabs(driver, [
        { url: 'https://example.com/page?utm_source=test&utm_medium=email', title: 'With Tracking' },
        { url: 'https://example.com/page', title: 'Without Tracking' },
      ]);
      
      await refreshE2EPage(driver);
      
      // With normalize checked (default), should group together
      let statsText = await getStatsText(driver);
      expect(statsText).toContain('2 tab(s) matched');
      
      const hosts = await getHostCards(driver);
      expect(hosts).toHaveLength(1);
      
      // Take screenshot
      await takeScreenshot(driver, 'url-normalize');
    });
  });

  describe('Cluster Expansion and Tab List', () => {
    test('should expand host to show clusters', async () => {
      await openE2EPage(driver);
      
      await createTestTabs(driver, [
        { url: 'https://github.com/mozilla/firefox', title: 'Firefox' },
        { url: 'https://github.com/facebook/react', title: 'React' },
      ]);
      
      await refreshE2EPage(driver);
      
      // Expand github.com host
      await clickHostTwisty(driver, 'github.com');
      
      // Take screenshot showing expanded clusters
      await takeScreenshot(driver, 'expanded-clusters');
    });
  });

  describe('Bulk Operations', () => {
    test('should reap (close) tabs for a host with <10 tabs', async () => {
      await openE2EPage(driver);
      
      // Create small number of tabs
      await createTestTabs(driver, [
        { url: 'https://test-close.com/page1', title: 'Test 1' },
        { url: 'https://test-close.com/page2', title: 'Test 2' },
        { url: 'https://other.com/page1', title: 'Other' },
      ]);
      
      await refreshE2EPage(driver);
      
      const hostsBefore = await getHostCards(driver);
      const testHostBefore = hostsBefore.find(h => h.name === 'test-close.com');
      expect(testHostBefore).toBeDefined();
      
      // Reap test-close.com (no confirmation needed for <10 tabs)
      await reapHost(driver, 'test-close.com', false);
      await refreshE2EPage(driver);
      
      const hostsAfter = await getHostCards(driver);
      const testHostAfter = hostsAfter.find(h => h.name === 'test-close.com');
      expect(testHostAfter).toBeUndefined();
      
      // Take screenshot
      await takeScreenshot(driver, 'after-reap');
    });
  });

  describe('Visual Regression', () => {
    test('should match baseline screenshot for standard layout', async () => {
      await openE2EPage(driver);
      
      // Create a standard set of tabs
      await createTestTabs(driver, [
        { url: 'https://github.com/mozilla/firefox', title: 'Firefox' },
        { url: 'https://github.com/facebook/react', title: 'React' },
        { url: 'https://example.com/page1', title: 'Example 1' },
        { url: 'https://example.com/page2', title: 'Example 2' },
      ]);
      
      await refreshE2EPage(driver);
      
      const screenshot = await takeScreenshot(driver, 'baseline-layout');
      
      // Visual regression check (will create baseline on first run)
      expect(screenshot).toMatchImageSnapshot({
        customSnapshotIdentifier: 'baseline-layout',
        failureThreshold: 0.01,
        failureThresholdType: 'percent',
      });
    });
  });
});
