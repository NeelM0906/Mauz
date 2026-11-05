/**
 * Whether a host is on a never-capture list. "example.com" matches the site and its subdomains;
 * a pattern with * is a wildcard over the whole host ("*bank*"). The browser extension has a
 * copy of this in browser-extension/extension/page.js; keep them in step.
 */
export function isBlockedSite(host: string, patterns: readonly string[]): boolean {
  const normalizedHost = host.toLowerCase();

  return patterns.some((pattern) => {
    const normalized = pattern.trim().toLowerCase();

    if (normalized.length === 0) {
      return false;
    }

    if (normalized.includes("*")) {
      const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");

      return new RegExp(`^${escaped}$`).test(normalizedHost);
    }

    return normalizedHost === normalized || normalizedHost.endsWith(`.${normalized}`);
  });
}

/** Sites Mauz never reads or screenshots by default: banking, payments, and patient portals. */
export const DEFAULT_CAPTURE_BLOCKED_SITES: readonly string[] = [
  "*bank*",
  "paypal.com",
  "venmo.com",
  "wise.com",
  "revolut.com",
  "americanexpress.com",
  "capitalone.com",
  "chase.com",
  "discover.com",
  "schwab.com",
  "fidelity.com",
  "vanguard.com",
  "robinhood.com",
  "coinbase.com",
  "mychart.*",
  "*.mychart.*",
  "1password.com",
  "bitwarden.com",
  "lastpass.com"
];
