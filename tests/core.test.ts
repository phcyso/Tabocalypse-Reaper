import {
  normalizeURL,
  createNode,
  clusterFor,
  buildModel,
  CONFIRM_THRESHOLD,
} from '../core';

describe('Core Logic Unit Tests', () => {
  describe('normalizeURL', () => {
    test('should remove tracking parameters', () => {
      const url = 'https://example.com/page?utm_source=test&utm_medium=email&ref=homepage';
      const normalized = normalizeURL(url);
      expect(normalized).toBe('https://example.com/page');
    });

    test('should preserve non-tracking parameters', () => {
      const url = 'https://example.com/page?id=123&category=tech';
      const normalized = normalizeURL(url);
      expect(normalized).toBe('https://example.com/page?id=123&category=tech');
    });

    test('should remove trailing slashes', () => {
      const url = 'https://example.com/page/';
      const normalized = normalizeURL(url);
      expect(normalized).toBe('https://example.com/page');
    });

    test('should handle malformed URLs', () => {
      const url = 'not-a-valid-url';
      const normalized = normalizeURL(url);
      expect(normalized).toBe(url);
    });
  });

  describe('createNode', () => {
    test('should create a node with default kind', () => {
      const node = createNode('test');
      expect(node.name).toBe('test');
      expect(node.kind).toBe('node');
      expect(node.children).toBeInstanceOf(Map);
      expect(node.tabs).toEqual([]);
      expect(node.ids).toBeInstanceOf(Set);
      expect(node.count).toBe(0);
    });

    test('should create a node with custom kind', () => {
      const node = createNode('host', 'host');
      expect(node.name).toBe('host');
      expect(node.kind).toBe('host');
    });
  });

  describe('clusterFor', () => {
    test('should cluster GitHub URLs by org/repo', () => {
      const url = new URL('https://github.com/mozilla/firefox/issues/123');
      const result = clusterFor(url);
      expect(result.key).toBe('mozilla/firefox');
      expect(result.remainder).toEqual(['issues', '123']);
    });

    test('should handle GitHub URLs with only org', () => {
      const url = new URL('https://github.com/mozilla');
      const result = clusterFor(url);
      expect(result.key).toBe('mozilla');
    });

    test('should cluster AWS URLs by service', () => {
      const url = new URL('https://console.aws.amazon.com/s3/buckets/my-bucket');
      const result = clusterFor(url);
      expect(result.key).toBe('s3');
      expect(result.remainder).toEqual(['buckets', 'my-bucket']);
    });

    test('should cluster AWS docs by service', () => {
      const url = new URL('https://docs.aws.amazon.com/lambda/latest/dg/welcome.html');
      const result = clusterFor(url);
      expect(result.key).toBe('lambda');
      expect(result.remainder).toEqual(['latest', 'dg', 'welcome.html']);
    });

    test('should cluster generic URLs by first path segment', () => {
      const url = new URL('https://example.com/products/item/123');
      const result = clusterFor(url);
      expect(result.key).toBe('products');
      expect(result.remainder).toEqual(['item', '123']);
    });

    test('should use "/" for root paths', () => {
      const url = new URL('https://example.com/');
      const result = clusterFor(url);
      expect(result.key).toBe('/');
      expect(result.remainder).toEqual([]);
    });
  });

  describe('buildModel', () => {
    const createMockTab = (id: number, url: string, title: string, pinned = false) => ({
      id,
      url,
      title,
      pinned,
      windowId: 1,
      favIconUrl: '',
    });

    test('should build empty model for no tabs', () => {
      const model = buildModel([]);
      expect(model.kind).toBe('root');
      expect(model.children.size).toBe(0);
    });

    test('should group tabs by host', () => {
      const tabs = [
        createMockTab(1, 'https://example.com/page1', 'Page 1'),
        createMockTab(2, 'https://example.com/page2', 'Page 2'),
        createMockTab(3, 'https://test.com/page1', 'Test Page'),
      ];

      const model = buildModel(tabs);
      expect(model.children.size).toBe(2);
      expect(model.children.has('example.com')).toBe(true);
      expect(model.children.has('test.com')).toBe(true);
    });

    test('should count tabs correctly', () => {
      const tabs = [
        createMockTab(1, 'https://example.com/page1', 'Page 1'),
        createMockTab(2, 'https://example.com/page2', 'Page 2'),
      ];

      const model = buildModel(tabs);
      const exampleHost = model.children.get('example.com');
      expect(exampleHost?.count).toBe(2);
    });

    test('should exclude pinned tabs when excludePinned is true', () => {
      const tabs = [
        createMockTab(1, 'https://example.com/page1', 'Page 1', false),
        createMockTab(2, 'https://example.com/page2', 'Page 2', true),
      ];

      const model = buildModel(tabs, { excludePinned: true });
      const exampleHost = model.children.get('example.com');
      expect(exampleHost?.count).toBe(1);
    });

    test('should include pinned tabs when excludePinned is false', () => {
      const tabs = [
        createMockTab(1, 'https://example.com/page1', 'Page 1', false),
        createMockTab(2, 'https://example.com/page2', 'Page 2', true),
      ];

      const model = buildModel(tabs, { excludePinned: false });
      const exampleHost = model.children.get('example.com');
      expect(exampleHost?.count).toBe(2);
    });

    test('should filter tabs by search query', () => {
      const tabs = [
        createMockTab(1, 'https://example.com/firefox', 'Firefox Page'),
        createMockTab(2, 'https://example.com/chrome', 'Chrome Page'),
        createMockTab(3, 'https://test.com/firefox', 'Firefox Test'),
      ];

      const model = buildModel(tabs, { filter: 'firefox' });
      let totalTabs = 0;
      for (const [, host] of model.children) {
        totalTabs += host.count;
      }
      expect(totalTabs).toBe(2);
    });

    test('should normalize URLs when normalize is true', () => {
      const tabs = [
        createMockTab(1, 'https://example.com/page?utm_source=test', 'Page 1'),
        createMockTab(2, 'https://example.com/page', 'Page 2'),
      ];

      const model = buildModel(tabs, { normalize: true });
      const exampleHost = model.children.get('example.com');
      const cluster = Array.from(exampleHost?.children.values() || [])[0];
      expect(cluster?.tabs.length).toBe(2);
    });

    test('should not normalize URLs when normalize is false', () => {
      const tabs = [
        createMockTab(1, 'https://example.com/page?utm_source=test', 'Page 1'),
        createMockTab(2, 'https://example.com/page', 'Page 2'),
      ];

      const model = buildModel(tabs, { normalize: false });
      const exampleHost = model.children.get('example.com');
      // Should have same cluster but different tabs
      expect(exampleHost).toBeDefined();
    });

    test('should cluster GitHub tabs by org/repo', () => {
      const tabs = [
        createMockTab(1, 'https://github.com/mozilla/firefox', 'Firefox'),
        createMockTab(2, 'https://github.com/mozilla/firefox/issues', 'Firefox Issues'),
        createMockTab(3, 'https://github.com/facebook/react', 'React'),
      ];

      const model = buildModel(tabs);
      const githubHost = model.children.get('github.com');
      expect(githubHost?.children.size).toBe(2);
      expect(githubHost?.children.has('mozilla/firefox')).toBe(true);
      expect(githubHost?.children.has('facebook/react')).toBe(true);
    });

    test('should exclude internal browser URLs', () => {
      const tabs = [
        createMockTab(1, 'about:blank', 'Blank'),
        createMockTab(2, 'moz-extension://123/popup.html', 'Extension'),
        createMockTab(3, 'https://example.com/page', 'Example'),
      ];

      const model = buildModel(tabs);
      expect(model.children.size).toBe(1);
      expect(model.children.has('example.com')).toBe(true);
    });
  });

  describe('CONFIRM_THRESHOLD', () => {
    test('should be set to 10', () => {
      expect(CONFIRM_THRESHOLD).toBe(10);
    });
  });
});
