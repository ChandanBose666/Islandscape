import * as path from 'path';
import * as fs from 'fs';

/** Maps a component name (as it appears in the template) to its resolved absolute file path. */
export type ImportMap = Map<string, string>;

const COMPONENT_EXTENSIONS = ['.astro', '.tsx', '.jsx', '.ts', '.js', '.svelte', '.vue'];

/**
 * Build a name→path map from raw import lines extracted from an .astro frontmatter.
 *
 * Handles:
 *   - Relative imports (`./`, `../`)
 *   - Absolute-from-root (`/`)
 *   - Common aliases: `@/` and `~/` both resolve to `<workspaceRoot>/src/`
 *   - Extensionless imports (tries COMPONENT_EXTENSIONS in order)
 *   - Barrel / index files
 */
export function buildImportMap(
  importLines: string[],
  hostFile: string,
  workspaceRoot: string,
): ImportMap {
  const map: ImportMap = new Map();
  const hostDir = path.dirname(hostFile);

  for (const line of importLines) {
    const specifier = extractSpecifier(line);
    if (!specifier) continue;

    // Skip bare node_module imports that aren't known aliases
    if (!isLocalSpecifier(specifier)) continue;

    const names = extractImportedNames(line);
    if (names.length === 0) continue;

    const resolved = resolveSpecifier(specifier, hostDir, workspaceRoot);
    if (!resolved) continue;

    for (const name of names) {
      map.set(name, resolved);
    }
  }

  return map;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the module specifier from an import line.
 * Handles both `from '...'` and `import '...'` (side-effect imports, rare but possible).
 */
function extractSpecifier(line: string): string | null {
  const m = line.match(/from\s+['"]([^'"]+)['"]\s*;?\s*$/) ??
            line.match(/^import\s+['"]([^'"]+)['"]\s*;?\s*$/);
  return m ? m[1] : null;
}

function isLocalSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('@/') ||
    specifier.startsWith('~/')
  );
}

/**
 * Extract all uppercase-starting names introduced by an import statement.
 * Covers:
 *   - Default:  `import Foo from '...'`
 *   - Named:    `import { Foo, Bar as Baz } from '...'`
 *   - Mixed:    `import Foo, { Bar } from '...'`
 */
function extractImportedNames(line: string): string[] {
  const names: string[] = [];

  // Default import — must start with uppercase (component convention)
  const defaultMatch = line.match(/import\s+([A-Z]\w*)/);
  if (defaultMatch) names.push(defaultMatch[1]);

  // Named / aliased imports: { Foo, Bar as MyBar }
  const braceMatch = line.match(/\{([^}]+)\}/);
  if (braceMatch) {
    for (const part of braceMatch[1].split(',')) {
      // Take the "as Alias" name if present, otherwise the name itself
      const alias = part.trim().split(/\s+as\s+/).pop()?.trim() ?? '';
      if (/^[A-Z]/.test(alias)) names.push(alias);
    }
  }

  return [...new Set(names)];
}

function resolveSpecifier(specifier: string, hostDir: string, workspaceRoot: string): string | null {
  let basePath: string;

  if (specifier.startsWith('.')) {
    basePath = path.resolve(hostDir, specifier);
  } else if (specifier.startsWith('/')) {
    basePath = path.resolve(workspaceRoot, specifier.slice(1));
  } else {
    // @/ or ~/ → <workspaceRoot>/src/
    const relative = specifier.replace(/^[@~]\//, '');
    basePath = path.resolve(workspaceRoot, 'src', relative);
  }

  // Already has a recognised extension
  if (COMPONENT_EXTENSIONS.includes(path.extname(basePath)) && fs.existsSync(basePath)) {
    return basePath;
  }

  // Try appending each extension
  for (const ext of COMPONENT_EXTENSIONS) {
    const candidate = basePath + ext;
    if (fs.existsSync(candidate)) return candidate;
  }

  // Try index file inside the path as a directory
  for (const ext of COMPONENT_EXTENSIONS) {
    const candidate = path.join(basePath, 'index' + ext);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}
