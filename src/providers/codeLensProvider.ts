import * as vscode from 'vscode';
import { IslandGraph, IslandNode, getIslandsForFile } from '../model/islandGraph';

const DIRECTIVE_ICON: Record<string, string> = {
  'client:load':    '🔴',
  'client:idle':    '🟡',
  'client:visible': '🟢',
  'client:media':   '🔵',
  'client:only':    '🟣',
};

export class IslandCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onChange.event;

  constructor(private readonly graph: IslandGraph) {}

  refresh(): void {
    this._onChange.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    return getIslandsForFile(this.graph, document.uri.fsPath).map(buildLens);
  }
}

function buildLens(island: IslandNode): vscode.CodeLens {
  const range = new vscode.Range(
    island.position.line, island.position.column,
    island.position.line, island.position.column,
  );

  return new vscode.CodeLens(range, {
    title: buildTitle(island),
    command: 'astroIslands.revealIsland',
    arguments: [island.id],
    tooltip: buildTooltip(island),
  });
}

function buildTitle(island: IslandNode): string {
  const icon      = DIRECTIVE_ICON[island.directive] ?? '⚪';
  const framework = island.framework !== 'unknown' ? ` | ${island.framework}` : '';
  const size      = formatSize(island);
  const propCount = island.props.length;
  const props     = propCount > 0 ? ` | ${propCount} prop${propCount !== 1 ? 's' : ''}` : '';

  return `🏝️ ${icon} ${island.directive}${framework}${size}${props}`;
}

function formatSize(island: IslandNode): string {
  if (island.estimatedSizeGzip === null) return '';
  const kb     = (island.estimatedSizeGzip / 1024).toFixed(1);
  const prefix = island.sizeIsHeuristic ? 'Raw ~' : '~';
  return ` | ${prefix}${kb} KB`;
}

function buildTooltip(island: IslandNode): string {
  const lines: string[] = [`${island.componentName} — ${island.directive}`];

  if (island.estimatedSizeGzip !== null) {
    const kb = (island.estimatedSizeGzip / 1024).toFixed(1);
    const note = island.sizeIsHeuristic
      ? `${kb} KB gzip (heuristic — esbuild cannot parse .svelte/.vue natively)`
      : `${kb} KB gzip`;
    lines.push(note);
  }

  if (island.estimatedSizeBytes !== null && !island.sizeIsHeuristic) {
    lines.push(`${(island.estimatedSizeBytes / 1024).toFixed(1)} KB minified (uncompressed)`);
  }

  return lines.join('\n');
}
