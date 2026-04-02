import * as fs from 'fs';
import { Framework } from '../model/islandGraph';

/**
 * Returns:
 *   true  — interactive logic detected (directive is justified)
 *   false — no interactive logic found (directive may be unnecessary)
 *   null  — could not determine (file unreadable or unknown framework)
 */
export function hasInteractiveLogic(sourceFile: string, framework: Framework): boolean | null {
  let source: string;
  try {
    source = fs.readFileSync(sourceFile, 'utf-8');
  } catch {
    return null;
  }

  const patterns = PATTERNS_BY_FRAMEWORK[framework];
  if (!patterns) return null;

  return patterns.some(p => p.test(source));
}

// ─── Per-framework patterns ───────────────────────────────────────────────────

const PATTERNS_BY_FRAMEWORK: Partial<Record<Framework, RegExp[]>> = {
  react: [
    /\buseState\s*[(<]/,
    /\buseEffect\s*\(/,
    /\buseRef\s*[(<]/,
    /\buseReducer\s*\(/,
    /\buseCallback\s*\(/,
    /\buseMemo\s*\(/,
    /\bon[A-Z]\w+\s*[:=]/,   // onClick, onChange, etc. as JSX props
  ],
  preact: [
    /\buseState\s*[(<]/,
    /\buseEffect\s*\(/,
    /\bsignal\s*\(/,
    /\bon[A-Z]\w+\s*[:=]/,
  ],
  solid: [
    /\bcreateSignal\s*\(/,
    /\bcreateEffect\s*\(/,
    /\bcreateMemo\s*\(/,
    /\bcreateStore\s*\(/,
    /\bon[A-Z]\w+\s*[:=]/,
  ],
  svelte: [
    /\$:/,            // reactive declarations
    /\bon:[a-z]/,     // event directives
    /\bbind:/,
    /writable\s*\(/,
  ],
  vue: [
    /\bref\s*\(/,
    /\breactive\s*\(/,
    /\bcomputed\s*\(/,
    /\bwatch\s*\(/,
    /@[a-z]+\s*=/,   // @click=, @input=
    /v-model/,
  ],
  lit: [
    /@[a-z]+\s*=/,    // @click= event bindings
    /\bproperty\b/,
    /\bstate\b/,
    /\beventOptions\b/,
  ],
};
