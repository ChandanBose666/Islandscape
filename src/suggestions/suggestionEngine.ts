import { IslandNode } from '../model/islandGraph';
import { SizeResult } from '../analyzer/cacheManager';

export type SuggestionKind =
  | 'large-eager'        // client:load + size over threshold
  | 'unused-directive'   // no interactive logic but has a directive
  | 'framework-entry-cost'; // sole island of its framework on the page

export interface Suggestion {
  islandId: string;
  kind: SuggestionKind;
  message: string;
  fixLabel?: string; // present when a code action can fix it
}

export interface SuggestionEngineConfig {
  eagerSizeThresholdKB: number; // default 50
}

// Approximate minified+gzipped framework runtime sizes (KB)
const FRAMEWORK_RUNTIME_KB: Partial<Record<string, number>> = {
  react:  42,
  svelte: 15,
  vue:    33,
  solid:   7,
  preact:  4,
  lit:    16,
};

export function generateSuggestions(
  islands: IslandNode[],
  sizeMap: Map<string, SizeResult | null>,
  hasInteractiveMap: Map<string, boolean | null>,
  config: SuggestionEngineConfig,
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const frameworkCounts = countFrameworks(islands);

  for (const island of islands) {
    const size = sizeMap.get(island.id) ?? null;
    const hasInteractive = hasInteractiveMap.get(island.id) ?? null;

    // Rule 1 — large island hydrating eagerly
    if (island.directive === 'client:load' && size && !size.isHeuristic) {
      const gzipKB = size.sizeGzip / 1024;
      if (gzipKB > config.eagerSizeThresholdKB) {
        suggestions.push({
          islandId: island.id,
          kind: 'large-eager',
          message:
            `${island.componentName} is ~${fmt(size.sizeGzip)} gzipped and hydrates immediately (client:load). ` +
            `Consider client:idle or client:visible to defer hydration.`,
          fixLabel: 'Convert to client:idle',
        });
      }
    }

    // Rule 2 — directive present but no interactive logic detected
    if (hasInteractive === false) {
      suggestions.push({
        islandId: island.id,
        kind: 'unused-directive',
        message:
          `${island.componentName} has no detected state, hooks, or event handlers. ` +
          `It may not need a hydration directive and could render statically.`,
        fixLabel: 'Remove hydration directive',
      });
    }

    // Rule 3 — sole island of its framework (framework entry cost)
    if (island.framework !== 'unknown' && frameworkCounts.get(island.framework) === 1) {
      const runtimeKB = FRAMEWORK_RUNTIME_KB[island.framework];
      if (runtimeKB) {
        suggestions.push({
          islandId: island.id,
          kind: 'framework-entry-cost',
          message:
            `${island.componentName} is the only ${island.framework} island on this page, ` +
            `adding ~${runtimeKB} KB of ${island.framework} runtime that is not otherwise needed.`,
        });
      }
    }
  }

  return suggestions;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countFrameworks(islands: IslandNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const island of islands) {
    if (island.framework !== 'unknown') {
      counts.set(island.framework, (counts.get(island.framework) ?? 0) + 1);
    }
  }
  return counts;
}

function fmt(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
