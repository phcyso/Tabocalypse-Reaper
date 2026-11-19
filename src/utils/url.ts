import { ClusterKey } from "../model/types.js";

// Anchored so names that merely CONTAIN a tracked fragment survive: `prefix`,
// `reference`, `preference`, `grep`, `refpage` are kept; `utm_*`, `fbclid`, `gclid`,
// `yclid`, `mc_cid`, `mc_eid`, `ref`, `ref_page` are stripped (audit finding F-14a).
const TRACKING_PARAM_PATTERN = /^(utm_[a-z_]*|fbclid|gclid|yclid|mc_cid|mc_eid|ref(_[a-z_]*)?)$/i;
const EXCLUDED_SCHEME_PATTERN = /^(about:|moz-extension:|chrome:)/;

const enum KnownHost {
  GitHub = "github.com",
  GitHubRaw = "raw.githubusercontent.com",
}

const AWS_HOST_FRAGMENT = "aws.amazon.com";

/**
 * Matches github.com and subdomains (gist.github.com) without matching lookalikes
 * such as notgithub.com (audit finding F-12).
 */
function isGitHubHost(host: string): boolean {
  return host === KnownHost.GitHub || host.endsWith(`.${KnownHost.GitHub}`);
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const params = new URLSearchParams(parsed.search);
    // Snapshot the keys before deleting: iterating the live iterator while removing
    // entries skips every other match (audit finding F-14b).
    for (const key of [...params.keys()]) {
      if (TRACKING_PARAM_PATTERN.test(key)) {
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

/**
 * Generates the display key for a cluster by inspecting the pathname and host.
 * Special-cases GitHub repositories and AWS consoles/docs so related resources
 * stay grouped together, otherwise it uses the first path segment.
 */
export function deriveClusterKey(url: URL): ClusterKey {
  const segments = url.pathname.split("/").filter(Boolean);

  if (isGitHubHost(url.host) && segments.length >= 2) {
    return { key: `${segments[0]}/${segments[1]}`, remainder: segments.slice(2) };
  }

  // Raw files from several repos of one user would otherwise all cluster under the
  // username via the generic rule (audit finding F-13).
  if (url.host === KnownHost.GitHubRaw && segments.length >= 2) {
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
