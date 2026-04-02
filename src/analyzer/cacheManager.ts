import * as crypto from 'crypto';

export interface SizeResult {
  sizeBytes: number;
  sizeGzip: number;
  /** true when the estimate came from fs.stat heuristic (e.g. .svelte / .vue) */
  isHeuristic: boolean;
  /** npm package names bundled into this island — used for shared-chunk dedup */
  sharedPackages: string[];
}

export class CacheManager {
  private readonly cache = new Map<string, SizeResult>();

  hash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  get(hash: string): SizeResult | undefined {
    return this.cache.get(hash);
  }

  set(hash: string, result: SizeResult): void {
    this.cache.set(hash, result);
  }

  clear(): void {
    this.cache.clear();
  }
}
