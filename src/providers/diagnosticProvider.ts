import * as vscode from 'vscode';
import { IslandNode } from '../model/islandGraph';
import { Suggestion } from '../suggestions/suggestionEngine';

const SOURCE = 'Astro Islands';

export class IslandDiagnosticProvider implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection('astroIslands');
  }

  update(uri: vscode.Uri, islands: IslandNode[], suggestions: Suggestion[]): void {
    const byIsland = new Map<string, Suggestion[]>();
    for (const s of suggestions) {
      const arr = byIsland.get(s.islandId) ?? [];
      arr.push(s);
      byIsland.set(s.islandId, arr);
    }

    this.collection.set(uri, islands.flatMap(island =>
      buildDiagnostics(island, byIsland.get(island.id) ?? []),
    ));
  }

  clear(uri: vscode.Uri): void {
    this.collection.delete(uri);
  }

  dispose(): void {
    this.collection.dispose();
  }
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

function buildDiagnostics(island: IslandNode, suggestions: Suggestion[]): vscode.Diagnostic[] {
  const diags: vscode.Diagnostic[] = [];
  const range = islandRange(island);

  for (const suggestion of suggestions) {
    switch (suggestion.kind) {
      case 'large-eager':
        diags.push(make(range, suggestion.message, vscode.DiagnosticSeverity.Warning));
        break;
      case 'unused-directive':
        diags.push(make(range, suggestion.message, vscode.DiagnosticSeverity.Warning));
        break;
      case 'framework-entry-cost':
        diags.push(make(range, suggestion.message, vscode.DiagnosticSeverity.Information));
        break;
    }
  }

  // Always show an info hint for client:load even when no size-based warning fired
  if (island.directive === 'client:load' && !suggestions.some(s => s.kind === 'large-eager')) {
    diags.push(make(
      range,
      `${island.componentName} uses client:load — hydrates immediately. ` +
      `Consider client:idle or client:visible if not above the fold.`,
      vscode.DiagnosticSeverity.Information,
    ));
  }

  return diags;
}

function make(range: vscode.Range, message: string, severity: vscode.DiagnosticSeverity): vscode.Diagnostic {
  const d = new vscode.Diagnostic(range, message, severity);
  d.source = SOURCE;
  return d;
}

function islandRange(island: IslandNode): vscode.Range {
  return new vscode.Range(
    island.position.line, island.position.column,
    island.position.line, island.position.column + island.componentName.length,
  );
}
