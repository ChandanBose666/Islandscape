import * as vscode from 'vscode';
import { createIslandGraph, IslandGraph, IslandNode } from './model/islandGraph';
import { parseAstroFile } from './parser/astroParser';
import { buildImportMap } from './parser/importResolver';
import { detectFramework } from './analyzer/frameworkDetector';
import { IslandCodeLensProvider } from './providers/codeLensProvider';
import { IslandDiagnosticProvider } from './providers/diagnosticProvider';

// ─── Module-level state ───────────────────────────────────────────────────────

let graph: IslandGraph;
let codeLens: IslandCodeLensProvider;
let diagnostics: IslandDiagnosticProvider;
let statusBar: vscode.StatusBarItem;

// Debounce timer per file URI
const debounceTimers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 300;

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  graph = createIslandGraph();
  codeLens = new IslandCodeLensProvider(graph);
  diagnostics = new IslandDiagnosticProvider();

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'astroIslands.analyzeFile';
  statusBar.tooltip = 'Astro Island Visualizer — click to re-analyse';

  context.subscriptions.push(
    // CodeLens for .astro files
    vscode.languages.registerCodeLensProvider({ language: 'astro', scheme: 'file' }, codeLens),

    // Commands
    vscode.commands.registerCommand('astroIslands.analyzeFile', onAnalyzeFileCommand),
    vscode.commands.registerCommand('astroIslands.revealIsland', onRevealIsland),

    // Document lifecycle
    vscode.workspace.onDidOpenTextDocument(doc => scheduleAnalysis(doc)),
    vscode.workspace.onDidChangeTextDocument(e => scheduleAnalysis(e.document)),
    vscode.workspace.onDidCloseTextDocument(doc => {
      removeFileFromGraph(doc.uri.fsPath);
      diagnostics.clear(doc.uri);
      updateStatusBar();
    }),

    diagnostics,
    statusBar,
  );

  // Analyse any .astro file that is already open when the extension activates.
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.languageId === 'astro') scheduleAnalysis(doc);
  }
}

export function deactivate(): void {
  for (const t of debounceTimers.values()) clearTimeout(t);
  debounceTimers.clear();
}

// ─── Analysis pipeline ────────────────────────────────────────────────────────

function scheduleAnalysis(doc: vscode.TextDocument): void {
  if (doc.languageId !== 'astro') return;

  const key = doc.uri.toString();
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);

  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key);
    analyzeDocument(doc).catch(() => { /* silently ignore errors during analysis */ });
  }, DEBOUNCE_MS));
}

async function analyzeDocument(doc: vscode.TextDocument): Promise<void> {
  const hostFile = doc.uri.fsPath;
  const workspaceRoot =
    vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ?? '';

  let parsed;
  try {
    parsed = await parseAstroFile(doc.getText(), hostFile);
  } catch {
    // Parsing can fail on partially-typed syntax — ignore and keep stale data.
    return;
  }

  const importMap = buildImportMap(parsed.importLines, hostFile, workspaceRoot);

  // Enrich islands with resolved source file and framework
  const islands: IslandNode[] = parsed.islands.map(island => ({
    ...island,
    sourceFile: importMap.get(island.componentName) ?? null,
    framework:
      (importMap.get(island.componentName)
        ? detectFramework(importMap.get(island.componentName)!)
        : 'unknown'),
  }));

  // Replace stale nodes for this file
  removeFileFromGraph(hostFile);
  for (const island of islands) {
    graph.nodes.set(island.id, island);
    graph.renderEdges.push({ parentFile: hostFile, islandId: island.id });
  }

  codeLens.refresh();
  diagnostics.update(doc.uri, islands);
  updateStatusBar();
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function onAnalyzeFileCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'astro') {
    vscode.window.showInformationMessage('Open an .astro file to analyse its islands.');
    return;
  }
  await analyzeDocument(editor.document);
  const count = [...graph.nodes.values()].filter(n => n.hostFile === editor.document.uri.fsPath).length;
  vscode.window.showInformationMessage(`Astro Islands: found ${count} island${count !== 1 ? 's' : ''} in this file.`);
}

function onRevealIsland(islandId: string): void {
  const island = graph.nodes.get(islandId);
  if (!island) return;

  const uri = vscode.Uri.file(island.hostFile);
  const position = new vscode.Position(island.position.line, island.position.column);

  vscode.window.showTextDocument(uri, {
    selection: new vscode.Range(position, position),
    preserveFocus: false,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function removeFileFromGraph(hostFile: string): void {
  for (const [id, node] of graph.nodes) {
    if (node.hostFile === hostFile) graph.nodes.delete(id);
  }
  graph.renderEdges = graph.renderEdges.filter(e => e.parentFile !== hostFile);
}

function updateStatusBar(): void {
  const count = graph.nodes.size;
  if (count === 0) {
    statusBar.hide();
    return;
  }
  statusBar.text = `🏝️ ${count} island${count !== 1 ? 's' : ''}`;
  statusBar.show();
}
