import type { PropInfo } from '../model/islandGraph';

// Rough JSON size threshold above which we warn (in bytes)
const DYNAMIC_PROP_WARN_THRESHOLD = 1024; // 1 KB

export interface PropWarning {
  islandId: string;
  propName: string;
  message: string;
}

/**
 * Analyzes island props for potential serialization cost issues.
 *
 * Rules:
 * - A dynamic prop (JSX expression) that looks like a large object/array
 *   literal gets flagged with an estimated size.
 * - A dynamic prop referencing a plain identifier cannot be sized statically;
 *   we emit a "dynamic reference — size unknown" warning instead.
 */
export function analyzePropSerializationCost(
  islandId: string,
  props: PropInfo[],
): PropWarning[] {
  const warnings: PropWarning[] = [];

  for (const prop of props) {
    if (!prop.isDynamic || !prop.expressionText) continue;

    const expr = prop.expressionText.trim();

    // Detect large inline object/array literals
    if ((expr.startsWith('{') || expr.startsWith('[')) && expr.length > DYNAMIC_PROP_WARN_THRESHOLD) {
      const estimatedKB = (expr.length / 1024).toFixed(1);
      warnings.push({
        islandId,
        propName: prop.name,
        message:
          `Prop "${prop.name}" contains an inline object/array (~${estimatedKB} KB of source). ` +
          `Large props add to the HTML payload — consider Nanostore or server fetch.`,
      });
      continue;
    }

    // Detect identifier references (variable name only) for dynamic props with
    // names that suggest they carry data payloads
    const dataNamePattern = /^(data|items|list|rows|products|results|entries|records|payload)$/i;
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(expr) && dataNamePattern.test(prop.name)) {
      warnings.push({
        islandId,
        propName: prop.name,
        message:
          `Prop "${prop.name}" references a dynamic value — its serialization cost cannot ` +
          `be estimated statically. If it's a large dataset, consider Nanostore or fetch.`,
      });
    }
  }

  return warnings;
}

/**
 * Returns true if any prop on an island looks like it could be a large payload.
 */
export function hasSuspectProps(props: PropInfo[]): boolean {
  return props.some(p => {
    if (!p.isDynamic || !p.expressionText) return false;
    const expr = p.expressionText.trim();
    return (
      ((expr.startsWith('{') || expr.startsWith('[')) && expr.length > DYNAMIC_PROP_WARN_THRESHOLD)
    );
  });
}
