import * as vscode from 'vscode';
import { createIslandGraph, IslandGraph, IslandNode, getIslandsForFile } from './model/islandGraph';
import { parseAstroFile } from './parser/astroParser';
import { buildImportMap } from './parser/importResolver';
import { detectFramework } from './analyzer/frameworkDetector';
import { CacheManager } from './analyzer/cacheManager';
import { SizeEstimator } from './analyzer/sizeEstimator';
import { hasInteractiveLogic } from './analyzer/unusedDirectiveChecker';
import { generateSuggestions, Suggestion } from './suggestions/suggestionEngine';
import { IslandCodeActionProvider } from './suggestions/codeActionProvider';
import { IslandCodeLensProvider } from './providers/codeLensProvider';
import { IslandDiagnosticProvider } from './providers/diagnosticProvider';

// ─── Module-level state ───────────────────────────────────────────────────────

let graph: IslandGraph;
let codeLens: IslandCodeLensProvider;
let diagnostics: IslandDiagnosticProvider;
let statusBar: vscode.StatusBarItem;
let sizeEstimator: SizeEstimator;

// Per-file suggestion cache — read by CodeActionProvider
const suggestionsMap = new Map<string, Suggestion[]>();

// Debounce timers
const debounceTimers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 300;

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  graph         = createIslandGraph();
  codeLens      = new IslandCodeLensProvider(graph);
  diagnostics   = new IslandDiagnosticProvider();
  sizeEstimator = new SizeEstimator(new CacheManager());

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'astroIslands.analyzeFile';
  statusBar.tooltip = 'Astro Island Visualizer — click to re-analyse';

  const codeActions = new IslandCodeActionProvider(
    graph,
    (hostFile) => suggestionsMap.get(hostFile) ?? [],
  );

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'astro', scheme: 'file' },
      codeLens,
    ),
    vscode.languages.registerCodeActionsProvider(
      { language: 'astro', scheme: 'file' },
      codeActions,
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),

    vscode.commands.registerCommand('astroIslands.analyzeFile', onAnalyzeFileCommand),
    vscode.commands.registerCommand('astroIslands.revealIsland', onRevealIsland),

    vscode.workspace.onDidOpenTextDocument(doc => scheduleAnalysis(doc)),
    vscode.workspace.onDidChangeTextDocument(e => scheduleAnalysis(e.document)),
    vscode.workspace.onDidCloseTextDocument(doc => {
      removeFileFromGraph(doc.uri.fsPath);
      suggestionsMap.delete(doc.uri.fsPath);
      diagnostics.clear(doc.uri);
      updateStatusBar();
    }),

    // Re-analyse open .astro files when a component source file is saved
    vscode.workspace.onDidSaveTextDocument(doc => {
      const ext = doc.uri.fsPath.split('.').pop()?.toLowerCase() ?? '';
      if (['tsx', 'jsx', 'ts', 'js', 'svelte', 'vue'].includes(ext)) {
        for (const openDoc of vscode.workspace.textDocuments) {
          if (openDoc.languageId === 'astro') scheduleAnalysis(openDoc);
        }
      }
    }),

    diagnostics,
    statusBar,
  );

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
    analyzeDocument(doc).catch(() => { /* ignore errors on partial edits */ });
  }, DEBOUNCE_MS));
}

async function analyzeDocument(doc: vscode.TextDocument): Promise<void> {
  const hostFile      = doc.uri.fsPath;
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ?? '';

  // 1 — Parse .astro file
  let parsed;
  try {
    parsed = await parseAstroFile(doc.getText(), hostFile);
  } catch {
    return;
  }

  // 2 — Resolve imports + detect frameworks
  const importMap = buildImportMap(parsed.importLines, hostFile, workspaceRoot);
  const islands: IslandNode[] = parsed.islands.map(island => {
    const sourceFile = importMap.get(island.componentName) ?? null;
    return { ...island, sourceFile, framework: sourceFile ? detectFramework(sourceFile) : 'unknown' };
  });

  // 3 — Estimate sizes in parallel
  const sizeResults = await Promise.all(
    islands.map(island =>
      island.sourceFile ? sizeEstimator.estimate(island.sourceFile) : Promise.resolve(null),
    ),
  );

  for (let i = 0; i < islands.length; i++) {
    const sr = sizeResults[i];
    if (sr) {
      islands[i].estimatedSizeBytes = sr.sizeBytes;
      islands[i].estimatedSizeGzip  = sr.sizeGzip;
      islands[i].sizeIsHeuristic    = sr.isHeuristic;
    }
  }

  // 4 — Unused-directive check
  const hasInteractiveMap = new Map<string, boolean | null>();
  for (const island of islands) {
    if (island.sourceFile) {
      hasInteractiveMap.set(island.id, hasInteractiveLogic(island.sourceFile, island.framework));
    }
  }

  // 5 — Generate suggestions
  const sizeMap    = new Map(islands.map((island, i) => [island.id, sizeResults[i]]));
  const suggestions = generateSuggestions(islands, sizeMap, hasInteractiveMap, getConfig());
  suggestionsMap.set(hostFile, suggestions);

  // 6 — Update graph
  removeFileFromGraph(hostFile);
  for (const island of islands) {
    graph.nodes.set(island.id, island);
    graph.renderEdges.push({ parentFile: hostFile, islandId: island.id });
  }

  // 7 — Notify providers
  codeLens.refresh();
  diagnostics.update(doc.uri, islands, suggestions);
  updateStatusBar();
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function onAnalyzeFileCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'astro') {
    vscode.window.showInformationMessage('Open an .astro file to analyse its islands.');
    return;
  }
  await analyzeDocument(editor.document);
  const count = getIslandsForFile(graph, editor.document.uri.fsPath).length;
  vscode.window.showInformationMessage(
    `Astro Islands: found ${count} island${count !== 1 ? 's' : ''} in this file.`,
  );
}

function onRevealIsland(islandId: string): void {
  const island = graph.nodes.get(islandId);
  if (!island) return;
  const position = new vscode.Position(island.position.line, island.position.column);
  vscode.window.showTextDocument(vscode.Uri.file(island.hostFile), {
    selection: new vscode.Range(position, position),
    preserveFocus: false,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function removeFileFromGraph(hostFile: string): void {
  for (const [id, node] of graph.nodes) {
    if (node.hostFile === hostFile) graph.nodes.delete(id);
  }
  graph.renderEdges = graph.renderEdges.filter(e => e.parentFile !== hostFile);
}

function updateStatusBar(): void {
  const count = graph.nodes.size;
  if (count === 0) { statusBar.hide(); return; }

  const totalGzip = [...graph.nodes.values()]
    .reduce((sum, n) => sum + (n.estimatedSizeGzip ?? 0), 0);

  const sizeLabel  = totalGzip > 0 ? ` | ~${(totalGzip / 1024).toFixed(1)} KB` : '';
  const budget     = getBudgetForActiveFile();
  const overBudget = budget !== null && totalGzip / 1024 > budget;

  statusBar.text = `🏝️ ${count} island${count !== 1 ? 's' : ''}${sizeLabel}`;
  statusBar.backgroundColor = overBudget
    ? new vscode.ThemeColor('statusBarItem.errorBackground')
    : undefined;
  statusBar.show();
}

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('astroIslands');
  return { eagerSizeThresholdKB: cfg.get<number>('eagerSizeThresholdKB', 50) };
}

function getBudgetForActiveFile(): number | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const budgets = vscode.workspace
    .getConfiguration('astroIslands')
    .get<Record<string, number>>('budgets', {});
  const fsPath = editor.document.uri.fsPath.replace(/\\/g, '/');
  for (const [pattern, budget] of Object.entries(budgets)) {
    if (fsPath.includes(pattern.replace(/\*/g, ''))) return budget;
  }
  return null;
}
