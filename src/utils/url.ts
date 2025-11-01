import { ClusterKey } from "../model/types.js";

const TRACKING_QUERY_PATTERN = /(utm_|fbclid|gclid|yclid|mc_cid|mc_eid|ref)/i;
const EXCLUDED_SCHEME_PATTERN = /^(about:|moz-extension:|chrome:)/;

const enum KnownHost {
  GitHub = "github.com",
}

const AWS_HOST_FRAGMENT = "aws.amazon.com";

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const params = new URLSearchParams(parsed.search);
    for (const key of params.keys()) {
      if (TRACKING_QUERY_PATTERN.test(key)) {
        params.delete(key);
      }
    }

    parsed.search = params.toString() ? `?${params.toString()}` : "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return url;
  }
}

export function shouldIgnoreUrl(url: string): boolean {
  return EXCLUDED_SCHEME_PATTERN.test(url);
}

export function tryParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function deriveClusterKey(url: URL): ClusterKey {
  const segments = url.pathname.split("/").filter(Boolean);

  if (url.host.endsWith(KnownHost.GitHub) && segments.length >= 2) {
    return { key: `${segments[0]}/${segments[1]}`, remainder: segments.slice(2) };
  }

  if (url.host.includes(AWS_HOST_FRAGMENT)) {
    return { key: segments[0] ?? "/", remainder: segments.slice(1) };
  }

  return { key: segments[0] ?? "/", remainder: segments.slice(1) };
}

export function buildSubpath(remainder: readonly string[]): string {
  return remainder.join("/");
}
