import * as vscode from 'vscode';
import { IslandNode } from '../model/islandGraph';

const SOURCE = 'Astro Islands';

export class IslandDiagnosticProvider implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection('astroIslands');
  }

  update(uri: vscode.Uri, islands: IslandNode[]): void {
    this.collection.set(uri, islands.flatMap(island => buildDiagnostics(island)));
  }

  clear(uri: vscode.Uri): void {
    this.collection.delete(uri);
  }

  dispose(): void {
    this.collection.dispose();
  }
}

// ─── Rules ───────────────────────────────────────────────────────────────────

function buildDiagnostics(island: IslandNode): vscode.Diagnostic[] {
  const diags: vscode.Diagnostic[] = [];

  if (island.directive === 'client:load') {
    diags.push(makeInfo(
      island,
      `${island.componentName} uses client:load — hydrates immediately on page load. ` +
      `Consider client:idle or client:visible if this component is not above the fold.`,
    ));
  }

  return diags;
}

function makeInfo(island: IslandNode, message: string): vscode.Diagnostic {
  const range = new vscode.Range(
    island.position.line, island.position.column,
    island.position.line, island.position.column + island.componentName.length,
  );
  const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Information);
  diag.source = SOURCE;
  return diag;
}
