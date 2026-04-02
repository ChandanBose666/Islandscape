import * as vscode from 'vscode';
import { IslandGraph, IslandNode, getIslandsForFile } from '../model/islandGraph';
import { Suggestion } from './suggestionEngine';

export class IslandCodeActionProvider implements vscode.CodeActionProvider {
  constructor(
    private readonly graph: IslandGraph,
    private readonly getSuggestions: (hostFile: string) => Suggestion[],
  ) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const islands = getIslandsForFile(this.graph, document.uri.fsPath);
    const suggestions = this.getSuggestions(document.uri.fsPath);
    const actions: vscode.CodeAction[] = [];

    for (const island of islands) {
      if (!lineInRange(island.position.line, range)) continue;

      for (const suggestion of suggestions.filter(s => s.islandId === island.id)) {
        const action = buildAction(document, island, suggestion);
        if (action) actions.push(action);
      }
    }

    return actions;
  }
}

// ─── Action builders ─────────────────────────────────────────────────────────

function buildAction(
  document: vscode.TextDocument,
  island: IslandNode,
  suggestion: Suggestion,
): vscode.CodeAction | null {
  if (!suggestion.fixLabel) return null;

  switch (suggestion.kind) {
    case 'large-eager':
      return replaceDirectiveAction(document, island, 'client:load', 'client:idle', suggestion.fixLabel);
    case 'unused-directive':
      return removeDirectiveAction(document, island, suggestion.fixLabel);
    default:
      return null;
  }
}

function replaceDirectiveAction(
  document: vscode.TextDocument,
  island: IslandNode,
  oldDir: string,
  newDir: string,
  title: string,
): vscode.CodeAction {
  const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
  const lineText = document.lineAt(island.position.line).text;
  const col = lineText.indexOf(oldDir);

  if (col === -1) {
    action.disabled = { reason: 'Directive not found on this line' };
    return action;
  }

  const range = new vscode.Range(island.position.line, col, island.position.line, col + oldDir.length);
  action.edit = new vscode.WorkspaceEdit();
  action.edit.replace(document.uri, range, newDir);
  return action;
}

function removeDirectiveAction(
  document: vscode.TextDocument,
  island: IslandNode,
  title: string,
): vscode.CodeAction {
  const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
  const lineText = document.lineAt(island.position.line).text;

  // Match directive + surrounding whitespace, including optional ="value"
  const match = lineText.match(/\s+client:[a-z]+(?:="[^"]*")?/);
  if (!match || match.index === undefined) {
    action.disabled = { reason: 'Directive not found on this line' };
    return action;
  }

  const range = new vscode.Range(
    island.position.line, match.index,
    island.position.line, match.index + match[0].length,
  );
  action.edit = new vscode.WorkspaceEdit();
  action.edit.delete(document.uri, range);
  return action;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function lineInRange(line: number, range: vscode.Range): boolean {
  return line >= range.start.line && line <= range.end.line;
}
