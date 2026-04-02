// Framework types
export type Framework = 'react' | 'svelte' | 'vue' | 'solid' | 'preact' | 'lit' | 'unknown';

// Hydration directive types
export type HydrationDirective =
  | 'client:load'
  | 'client:idle'
  | 'client:visible'
  | 'client:media'
  | 'client:only';

// A single prop passed to an island from the .astro template
export interface PropInfo {
  name: string;
  isDynamic: boolean;       // true if value is {expression}, false if "string literal"
  expressionText?: string;  // the raw expression text if isDynamic
}

// A single island component instance
export interface IslandNode {
  id: string;                          // unique: `${hostFile}::${componentName}::${line}`
  componentName: string;               // e.g. "AddToCart"
  sourceFile: string | null;           // resolved absolute path to the component source, null if unresolved
  hostFile: string;                    // absolute path to the .astro file that renders this island
  framework: Framework;
  directive: HydrationDirective;
  directiveValue: string | null;       // e.g. "(min-width: 768px)" for client:media, "react" for client:only
  estimatedSizeBytes: number | null;   // null until size estimation runs
  estimatedSizeGzip: number | null;    // null until size estimation runs
  sizeIsHeuristic: boolean | null;     // true = fs.stat estimate (svelte/vue), false = esbuild
  props: PropInfo[];
  position: {
    line: number;    // 0-indexed line in the host file
    column: number;  // 0-indexed column
  };
}

// An edge representing one .astro file rendering an island
export interface RenderEdge {
  parentFile: string;    // absolute path to the .astro file
  islandId: string;      // ID of the IslandNode
}

// An edge representing shared state between islands via a store
export interface StateEdge {
  storeName: string;       // e.g. "cartStore"
  storeSourceFile: string; // absolute path to the store file
  consumerIds: string[];   // IslandNode IDs that import this store
}

// The full in-memory graph for the workspace
export interface IslandGraph {
  nodes: Map<string, IslandNode>;
  renderEdges: RenderEdge[];
  stateEdges: StateEdge[];
}

// Factory to create an empty graph
export function createIslandGraph(): IslandGraph {
  return {
    nodes: new Map(),
    renderEdges: [],
    stateEdges: [],
  };
}

// Helper: get all islands for a specific host file
export function getIslandsForFile(graph: IslandGraph, hostFile: string): IslandNode[] {
  return Array.from(graph.nodes.values()).filter(n => n.hostFile === hostFile);
}

// Helper: generate a stable island ID
export function makeIslandId(hostFile: string, componentName: string, line: number): string {
  return `${hostFile}::${componentName}::${line}`;
}
