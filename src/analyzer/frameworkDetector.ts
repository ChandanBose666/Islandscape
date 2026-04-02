import * as path from 'path';
import * as fs from 'fs';
import { Framework } from '../model/islandGraph';

/**
 * Detect the UI framework used by an island component.
 *
 * Strategy:
 *   1. Extension-based (fast, unambiguous for .svelte / .vue)
 *   2. Source-scan for JSX/TSX files (React, Preact, Solid, Lit)
 */
export function detectFramework(sourceFile: string): Framework {
  const ext = path.extname(sourceFile).toLowerCase();

  switch (ext) {
    case '.svelte': return 'svelte';
    case '.vue':    return 'vue';
    case '.astro':  return 'unknown'; // nested Astro components aren't islands
    case '.tsx':
    case '.jsx':
    case '.ts':
    case '.js':
      return detectFromSource(sourceFile);
    default:
      return 'unknown';
  }
}

// ─── Source-level detection ──────────────────────────────────────────────────

// Ordered from most-specific to least-specific so that Solid/Preact are caught
// before their JSX superficially resembles React.
const PATTERNS: Array<{ framework: Framework; regex: RegExp }> = [
  { framework: 'solid',  regex: /from\s+['"]solid-js(?:\/[^'"]*)?['"]/ },
  { framework: 'preact', regex: /from\s+['"]preact(?:\/[^'"]*)?['"]/ },
  { framework: 'lit',    regex: /from\s+['"](?:lit|@lit\/[^'"]+)['"]/ },
  { framework: 'react',  regex: /from\s+['"]react(?:\/[^'"]*)?['"]/ },
];

function detectFromSource(sourceFile: string): Framework {
  let source: string;
  try {
    source = fs.readFileSync(sourceFile, 'utf-8');
  } catch {
    return 'unknown';
  }

  for (const { framework, regex } of PATTERNS) {
    if (regex.test(source)) return framework;
  }

  return 'unknown';
}
