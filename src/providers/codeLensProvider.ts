import * as vscode from 'vscode';
import { IslandGraph, IslandNode, getIslandsForFile } from '../model/islandGraph';

// Color-coded directive labels (unicode circles — render in most fonts)
const DIRECTIVE_PREFIX: Record<string, string> = {
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

  /** Call after the graph has been updated for a file. */
  refresh(): void {
    this._onChange.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const islands = getIslandsForFile(this.graph, document.uri.fsPath);
    return islands.map(island => buildLens(island));
  }
}

function buildLens(island: IslandNode): vscode.CodeLens {
  // Place the lens on the same line as the component tag.
  const range = new vscode.Range(
    island.position.line, island.position.column,
    island.position.line, island.position.column,
  );

  return new vscode.CodeLens(range, {
    title: buildTitle(island),
    command: 'astroIslands.revealIsland',
    arguments: [island.id],
    tooltip: `${island.componentName} — ${island.directive}`,
  });
}

function buildTitle(island: IslandNode): string {
  const icon = DIRECTIVE_PREFIX[island.directive] ?? '🏝️';
  const framework = island.framework !== 'unknown' ? ` | ${island.framework}` : '';

  const propCount = island.props.length;
  const props = propCount > 0
    ? ` | ${propCount} prop${propCount !== 1 ? 's' : ''}`
    : '';

  return `🏝️ ${icon} ${island.directive}${framework}${props}`;
}
