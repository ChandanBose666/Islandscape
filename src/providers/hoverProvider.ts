import * as vscode from 'vscode';
import { IslandGraph, getIslandsForFile } from '../model/islandGraph';

/**
 * Shows a dependency breakdown tooltip when the cursor hovers over a component
 * name that is a hydrated island in the current .astro file.
 */
export class IslandHoverProvider implements vscode.HoverProvider {
  constructor(private readonly graph: IslandGraph) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | null {
    if (document.languageId !== 'astro') return null;

    const islands = getIslandsForFile(this.graph, document.uri.fsPath);
    if (islands.length === 0) return null;

    // Find the word under the cursor
    const wordRange = document.getWordRangeAtPosition(position, /[\w$]+/);
    if (!wordRange) return null;
    const word = document.getText(wordRange);

    // Find a matching island on this line
    const island = islands.find(
      i => i.componentName === word && i.position.line === position.line,
    );
    if (!island) return null;

    // Build the markdown tooltip
    const lines: string[] = [];

    lines.push(`**🏝️ ${island.componentName}** — ${island.framework} island`);
    lines.push('');
    lines.push(`| | |`);
    lines.push(`|---|---|`);
    lines.push(`| Directive | \`${island.directive}\` |`);

    if (island.estimatedSizeGzip !== null) {
      const kb = (island.estimatedSizeGzip / 1024).toFixed(1);
      const label = island.sizeIsHeuristic ? `~${kb} KB (raw estimate)` : `~${kb} KB gzip`;
      lines.push(`| Size | ${label} |`);
    }

    if (island.estimatedSizeBytes !== null && !island.sizeIsHeuristic) {
      lines.push(`| Unminified | ~${(island.estimatedSizeBytes / 1024).toFixed(1)} KB |`);
    }

    lines.push(`| Props | ${island.props.length} |`);

    if (island.sourceFile) {
      const short = island.sourceFile.replace(/\\/g, '/').split('/').pop() ?? '';
      lines.push(`| Source | \`${short}\` |`);
    }

    // Shared packages (if we have them — stored on the SizeResult, not on IslandNode,
    // so we surface what we know from the node itself)
    if (island.directiveValue) {
      lines.push(`| Directive value | \`${island.directiveValue}\` |`);
    }

    // Timing note
    const timingNote: Record<string, string> = {
      'client:load':    'Hydrates **immediately** on page load.',
      'client:idle':    'Hydrates when the browser is **idle** (`requestIdleCallback`).',
      'client:visible': 'Hydrates when the element **scrolls into view**.',
      'client:media':   `Hydrates when the media query \`${island.directiveValue ?? ''}\` matches.`,
      'client:only':    'Renders **only on the client** — no SSR HTML.',
    };
    const note = timingNote[island.directive];
    if (note) {
      lines.push('');
      lines.push(`> ${note}`);
    }

    const md = new vscode.MarkdownString(lines.join('\n'));
    md.isTrusted = true;
    return new vscode.Hover(md, wordRange);
  }
}
