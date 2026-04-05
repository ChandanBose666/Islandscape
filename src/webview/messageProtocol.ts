import type { Framework, HydrationDirective } from '../model/islandGraph';

// ─── Serializable graph data sent to the webview ─────────────────────────────
// (Maps/Sets are not JSON-serializable so we use plain arrays/objects)

export interface SerializedIsland {
  id: string;
  componentName: string;
  sourceFile: string | null;
  hostFile: string;
  framework: Framework;
  directive: HydrationDirective;
  directiveValue: string | null;
  estimatedSizeKB: number | null;   // gzip KB, already divided
  sizeIsHeuristic: boolean | null;
  propCount: number;
  hasDynamicProp: boolean;
  warnings: string[];               // short warning labels from suggestion engine
}

export interface SerializedStateEdge {
  storeName: string;
  storeSourceFile: string;
  consumerIds: string[];
}

export interface SerializedRenderEdge {
  parentFile: string;
  islandId: string;
}

export interface GraphPayload {
  islands: SerializedIsland[];
  renderEdges: SerializedRenderEdge[];
  stateEdges: SerializedStateEdge[];
  activeFile: string | null;        // currently active .astro file path
  budgetKB: number | null;          // budget for the active file, null if none
  totalGzipKB: number;              // sum of gzip sizes for active file's islands
}

// ─── Extension → Webview messages ────────────────────────────────────────────

export type ExtensionMessage =
  | { type: 'update'; payload: GraphPayload }
  | { type: 'activeFileChanged'; activeFile: string | null };

// ─── Webview → Extension messages ────────────────────────────────────────────

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'revealIsland'; islandId: string }
  | { type: 'revealFile'; filePath: string };
