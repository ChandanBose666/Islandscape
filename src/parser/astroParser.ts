import { parse } from '@astrojs/compiler';
import type {
  Node,
  ComponentNode,
  FrontmatterNode,
  AttributeNode,
  RootNode,
} from '@astrojs/compiler/types';
import { IslandNode, HydrationDirective, PropInfo, makeIslandId } from '../model/islandGraph';

const HYDRATION_DIRECTIVES = new Set<string>([
  'client:load',
  'client:idle',
  'client:visible',
  'client:media',
  'client:only',
]);

export interface ParsedFile {
  islands: IslandNode[];
  /** Raw import lines extracted from the frontmatter, for ImportResolver */
  importLines: string[];
}

export async function parseAstroFile(source: string, hostFile: string): Promise<ParsedFile> {
  const result = await parse(source, { position: true });

  const importLines = extractImportLines(result.ast);
  const islands = extractIslands(result.ast, hostFile);

  return { islands, importLines };
}

// ─── AST walking ────────────────────────────────────────────────────────────

function extractIslands(root: RootNode, hostFile: string): IslandNode[] {
  const islands: IslandNode[] = [];

  walkNode(root, (node) => {
    if (node.type !== 'component') return;
    const component = node as ComponentNode;

    const directiveAttr = component.attributes.find(a => HYDRATION_DIRECTIVES.has(a.name));
    if (!directiveAttr) return;

    const directive = directiveAttr.name as HydrationDirective;

    // For client:media / client:only the value is the quoted string; for the
    // rest the attribute is typically bare (kind === 'empty'), value === ''.
    const directiveValue =
      directiveAttr.kind === 'quoted' && directiveAttr.value !== ''
        ? directiveAttr.value
        : null;

    const props = extractProps(component.attributes);

    // Positions from the compiler are 1-based; VSCode ranges are 0-based.
    const line = (component.position?.start.line ?? 1) - 1;
    const column = (component.position?.start.column ?? 1) - 1;

    islands.push({
      id: makeIslandId(hostFile, component.name, line),
      componentName: component.name,
      sourceFile: null,       // resolved later by ImportResolver
      hostFile,
      framework: 'unknown',   // detected later by FrameworkDetector
      directive,
      directiveValue,
      estimatedSizeBytes: null,
      estimatedSizeGzip: null,
      sizeIsHeuristic: null,
      props,
      position: { line, column },
    });
  });

  return islands;
}

function extractImportLines(root: RootNode): string[] {
  const fm = root.children.find((n): n is FrontmatterNode => n.type === 'frontmatter');
  if (!fm) return [];
  return fm.value
    .split('\n')
    .filter(line => /^\s*import\s/.test(line));
}

function extractProps(attributes: AttributeNode[]): PropInfo[] {
  return attributes
    .filter(a => !HYDRATION_DIRECTIVES.has(a.name) && a.kind !== 'spread')
    .map(a => ({
      name: a.name,
      isDynamic: a.kind === 'expression' || a.kind === 'shorthand',
      expressionText: a.kind === 'expression' ? a.value : undefined,
    }));
}

function walkNode(node: Node, visitor: (node: Node) => void): void {
  visitor(node);
  const children = (node as { children?: Node[] }).children;
  if (children) {
    for (const child of children) {
      walkNode(child, visitor);
    }
  }
}
