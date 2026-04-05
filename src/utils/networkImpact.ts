/**
 * Global User Impact lookup table.
 *
 * Transfer speeds are real-world median throughput values derived from
 * WebPageTest data by region/network tier (bytes/ms = KB/s / 1000).
 *
 * Formula: additionalMs = totalBytes / bytesPerMs
 */

export interface NetworkTier {
  label: string;       // e.g. "4G — Europe / North America"
  region: string;
  bytesPerMs: number;  // effective throughput in bytes/ms
  warn: boolean;       // true = show warning icon
}

// fmt: ~real-world median, not theoretical peak
export const NETWORK_TIERS: NetworkTier[] = [
  { label: '4G',  region: 'Europe / North America',   bytesPerMs: 1_250,  warn: false }, // ~10 Mbps
  { label: '4G',  region: 'Southeast Asia',            bytesPerMs:   500,  warn: false }, // ~4 Mbps
  { label: '3G',  region: 'India / Sub-Saharan Africa',bytesPerMs:   100,  warn: true  }, // ~800 kbps
  { label: '2G',  region: 'Low-connectivity markets',  bytesPerMs:    40,  warn: true  }, // ~320 kbps
];

export const SLOW_USERS_PERCENT = 18; // ~18% of global mobile users on 3G or slower

export interface ImpactRow {
  tier: NetworkTier;
  additionalMs: number;
}

/**
 * Returns estimated additional load time per tier for a given gzip byte count.
 */
export function calcNetworkImpact(totalGzipBytes: number): ImpactRow[] {
  return NETWORK_TIERS.map(tier => ({
    tier,
    additionalMs: Math.round(totalGzipBytes / tier.bytesPerMs),
  }));
}

export function fmtMs(ms: number): string {
  return ms >= 1000 ? `~${(ms / 1000).toFixed(1)}s` : `~${ms}ms`;
}
