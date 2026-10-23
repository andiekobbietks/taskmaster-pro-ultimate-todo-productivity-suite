/**
 * Shared platform detection for hackathon-related senders.
 *
 * Kept in its own module so mail ingestion and inbox storage can share the
 * same list without creating a circular dependency.
 */

export const PLATFORM_DOMAINS: Record<string, string> = {
  "devpost.com": "devpost",
  "devpost.org": "devpost",
  "mlh.io": "mlh",
  "mlh.com": "mlh",
  "kaggle.com": "kaggle",
  "lablab.ai": "lablab",
  "ethglobal.com": "ethglobal",
  "devfolio.co": "devfolio",
  "unstop.com": "unstop",
  "hackerrank.com": "hackerrank",
  "hackerearth.com": "hackerearth",
};

export function detectPlatform(sender: string): string | null {
  const domain = sender.toLowerCase().split("@")[1] || "";
  for (const [d, platform] of Object.entries(PLATFORM_DOMAINS)) {
    if (domain.includes(d)) return platform;
  }
  return null;
}
