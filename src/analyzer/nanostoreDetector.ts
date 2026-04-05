import * as fs from 'fs';

/**
 * Detects nanostores store imports in island source files.
 * Returns the list of store file paths imported by the given source file.
 * A "store" is identified as any import from 'nanostores' or '@nanostores/*',
 * or any local import that re-exports from those packages.
 */
export function detectNanostoreImports(sourceFile: string): string[] {
  let src: string;
  try {
    src = fs.readFileSync(sourceFile, 'utf8');
  } catch {
    return [];
  }

  const storeFiles: string[] = [];

  // Match: import { ... } from 'nanostores' | '@nanostores/...'
  const directImport = /from\s+['"](@?nanostores(?:\/[^'"]*)?)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = directImport.exec(src)) !== null) {
    storeFiles.push(m[1]); // package name (not a file path)
  }

  // Match local imports that might be store files (heuristic: filename contains 'store')
  const localImport = /from\s+['"](\.{1,2}\/[^'"]*store[^'"]*)['"]/gi;
  while ((m = localImport.exec(src)) !== null) {
    storeFiles.push(m[1]);
  }

  return [...new Set(storeFiles)];
}

/**
 * Returns true if the given source file imports from nanostores (directly or
 * via a local store file).
 */
export function usesNanostores(sourceFile: string): boolean {
  return detectNanostoreImports(sourceFile).length > 0;
}

/**
 * Given all island source files in a page, groups them by shared store imports.
 * Returns a map of storeIdentifier → islandIds that share it.
 */
export function groupBySharedStore(
  islands: Array<{ id: string; sourceFile: string | null }>,
): Map<string, string[]> {
  const storeToIslands = new Map<string, string[]>();

  for (const island of islands) {
    if (!island.sourceFile) continue;
    const stores = detectNanostoreImports(island.sourceFile);
    for (const store of stores) {
      const list = storeToIslands.get(store) ?? [];
      list.push(island.id);
      storeToIslands.set(store, list);
    }
  }

  // Only return stores shared by 2+ islands
  for (const [store, ids] of storeToIslands) {
    if (ids.length < 2) storeToIslands.delete(store);
  }

  return storeToIslands;
}
