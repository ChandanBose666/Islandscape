import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createIslandGraph, IslandGraph, IslandNode, getIslandsForFile } from './model/islandGraph';
import { parseAstroFile } from './parser/astroParser';
import { buildImportMap } from './parser/importResolver';
import { detectFramework } from './analyzer/frameworkDetector';
import { CacheManager } from './analyzer/cacheManager';
import { SizeEstimator } from './analyzer/sizeEstimator';
import { hasInteractiveLogic } from './analyzer/unusedDirectiveChecker';
import { groupBySharedStore } from './analyzer/nanostoreDetector';
import { analyzePropSerializationCost } from './analyzer/propAnalyzer';
import { generateSuggestions, Suggestion } from './suggestions/suggestionEngine';
import { IslandCodeActionProvider } from './suggestions/codeActionProvider';
import { IslandCodeLensProvider } from './providers/codeLensProvider';
import { IslandDiagnosticProvider } from './providers/diagnosticProvider';
import { IslandWebviewProvider } from './webview/webviewProvider';
import { IslandHoverProvider } from './providers/hoverProvider';
import { initTelemetry, sendEvent } from './utils/telemetry';

// ─── Module-level state ───────────────────────────────────────────────────────

let graph: IslandGraph;
let codeLens: IslandCodeLensProvider;
let diagnostics: IslandDiagnosticProvider;
let webviewProvider: IslandWebviewProvider;
let statusBar: vscode.StatusBarItem;
let sizeEstimator: SizeEstimator;

// Per-file suggestion cache — read by CodeActionProvider
const suggestionsMap = new Map<string, Suggestion[]>();

// Debounce timers
const debounceTimers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 300;

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  initTelemetry(context);
  sendEvent('activated');

  graph         = createIslandGraph();
  codeLens      = new IslandCodeLensProvider(graph);
  diagnostics   = new IslandDiagnosticProvider();
  sizeEstimator = new SizeEstimator(new CacheManager());
  webviewProvider = new IslandWebviewProvider(
    context.extensionUri,
    graph,
    (hostFile) => suggestionsMap.get(hostFile) ?? [],
  );

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'astroIslands.analyzeFile';
  statusBar.tooltip = 'Astro Island Visualizer — click to re-analyse';

  const codeActions = new IslandCodeActionProvider(
    graph,
    (hostFile) => suggestionsMap.get(hostFile) ?? [],
  );

  // ── FileSystemWatcher — live updates on .astro file changes ──────────────
  const fsWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.workspace.workspaceFolders?.[0] ?? '',
      'src/pages/**/*.astro',
    ),
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

    vscode.window.registerWebviewViewProvider(IslandWebviewProvider.viewId, webviewProvider),

    vscode.languages.registerHoverProvider(
      { language: 'astro', scheme: 'file' },
      new IslandHoverProvider(graph),
    ),

    vscode.commands.registerCommand('astroIslands.analyzeFile',      onAnalyzeFileCommand),
    vscode.commands.registerCommand('astroIslands.analyzeWorkspace', onAnalyzeWorkspaceCommand),
    vscode.commands.registerCommand('astroIslands.revealIsland',     onRevealIsland),
    vscode.commands.registerCommand('astroIslands.jumpToLargest',    onJumpToLargestIsland),
    vscode.commands.registerCommand('astroIslands.exportReport',     onExportReport),

    vscode.workspace.onDidOpenTextDocument(doc => scheduleAnalysis(doc)),
    vscode.workspace.onDidChangeTextDocument(e => scheduleAnalysis(e.document)),
    vscode.workspace.onDidCloseTextDocument(doc => {
      removeFileFromGraph(doc.uri.fsPath);
      suggestionsMap.delete(doc.uri.fsPath);
      diagnostics.clear(doc.uri);
      updateStatusBar();
      webviewProvider.push();
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

    // Notify webview when the active editor changes (tabs)
    vscode.window.onDidChangeActiveTextEditor(editor => {
      const activeFile = editor?.document.languageId === 'astro'
        ? editor.document.uri.fsPath
        : null;
      webviewProvider.pushActiveFileChanged(activeFile);
      updateStatusBar();
    }),

    // FileSystemWatcher events
    fsWatcher.onDidChange(uri => reanalyzePath(uri)),
    fsWatcher.onDidCreate(uri => reanalyzePath(uri)),
    fsWatcher.onDidDelete(uri => {
      removeFileFromGraph(uri.fsPath);
      suggestionsMap.delete(uri.fsPath);
      updateStatusBar();
      webviewProvider.push();
    }),

    fsWatcher,
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

  // 5 — Generate suggestions (engine rules + prop warnings)
  const sizeMap    = new Map(islands.map((island, i) => [island.id, sizeResults[i]]));
  const suggestions = generateSuggestions(islands, sizeMap, hasInteractiveMap, getConfig());

  // Append prop-serialization warnings as info diagnostics
  for (const island of islands) {
    const propWarnings = analyzePropSerializationCost(island.id, island.props);
    for (const w of propWarnings) {
      suggestions.push({
        islandId: w.islandId,
        kind: 'large-eager',   // reuse kind; diagnostic provider only uses message
        message: w.message,
        shortLabel: `Large prop: ${w.propName}`,
      });
    }
  }

  suggestionsMap.set(hostFile, suggestions);

  // 6 — Update graph + state edges (nanostores)
  removeFileFromGraph(hostFile);
  for (const island of islands) {
    graph.nodes.set(island.id, island);
    graph.renderEdges.push({ parentFile: hostFile, islandId: island.id });
  }
  rebuildStateEdges();

  // 7 — Notify providers
  codeLens.refresh();
  diagnostics.update(doc.uri, islands, suggestions);
  updateStatusBar();
  webviewProvider.push();
}

// ─── State edges (nanostores) ─────────────────────────────────────────────────

function rebuildStateEdges(): void {
  const allIslands = [...graph.nodes.values()].map(n => ({ id: n.id, sourceFile: n.sourceFile }));
  const storeGroups = groupBySharedStore(allIslands);

  graph.stateEdges = [];
  for (const [store, ids] of storeGroups) {
    // Determine the store source file (use the first consumer's import path as heuristic)
    const firstIsland = graph.nodes.get(ids[0]);
    graph.stateEdges.push({
      storeName: store,
      storeSourceFile: firstIsland?.sourceFile ?? store,
      consumerIds: ids,
    });
  }
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
  sendEvent('analyze_file', undefined, { island_count: count });
  vscode.window.showInformationMessage(
    `Astro Islands: found ${count} island${count !== 1 ? 's' : ''} in this file.`,
  );
}

async function onAnalyzeWorkspaceCommand(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) {
    vscode.window.showInformationMessage('No workspace open.');
    return;
  }

  const astroFiles = await vscode.workspace.findFiles(
    '**/*.astro',
    '**/node_modules/**',
    500,
  );

  if (astroFiles.length === 0) {
    vscode.window.showInformationMessage('No .astro files found in workspace.');
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Astro Islands: Analyzing workspace…',
      cancellable: false,
    },
    async (progress) => {
      let done = 0;
      for (const uri of astroFiles) {
        progress.report({
          message: `${uri.fsPath.split(/[/\\]/).pop()} (${done}/${astroFiles.length})`,
          increment: (1 / astroFiles.length) * 100,
        });
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          await analyzeDocument(doc);
        } catch { /* skip unreadable files */ }
        done++;
      }
    },
  );

  sendEvent('analyze_workspace', undefined, { file_count: astroFiles.length, island_count: graph.nodes.size });
  vscode.window.showInformationMessage(
    `Astro Islands: analysed ${astroFiles.length} files — ${graph.nodes.size} islands found.`,
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

function onJumpToLargestIsland(): void {
  const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
  const candidates = activeFile
    ? getIslandsForFile(graph, activeFile)
    : [...graph.nodes.values()];

  if (candidates.length === 0) {
    vscode.window.showInformationMessage('No islands found to jump to.');
    return;
  }

  const largest = candidates.reduce((best, n) =>
    (n.estimatedSizeGzip ?? 0) > (best.estimatedSizeGzip ?? 0) ? n : best,
  );

  const position = new vscode.Position(largest.position.line, largest.position.column);
  vscode.window.showTextDocument(vscode.Uri.file(largest.hostFile), {
    selection: new vscode.Range(position, position),
    preserveFocus: false,
  });
}

async function onExportReport(): Promise<void> {
  if (graph.nodes.size === 0) {
    vscode.window.showInformationMessage('No islands to export. Open and analyse an .astro file first.');
    return;
  }

  const uri = await vscode.window.showSaveDialog({
    filters: { 'JSON': ['json'], 'Markdown': ['md'] },
    defaultUri: vscode.Uri.file(
      path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '.', 'astro-islands-report.md'),
    ),
  });
  if (!uri) return;

  const ext = uri.fsPath.split('.').pop()?.toLowerCase();
  const islands = [...graph.nodes.values()];

  let content: string;
  if (ext === 'json') {
    content = JSON.stringify(
      islands.map(n => ({
        id: n.id,
        componentName: n.componentName,
        hostFile: n.hostFile,
        sourceFile: n.sourceFile,
        framework: n.framework,
        directive: n.directive,
        estimatedSizeKB: n.estimatedSizeGzip !== null ? +(n.estimatedSizeGzip / 1024).toFixed(2) : null,
        sizeIsHeuristic: n.sizeIsHeuristic,
        propCount: n.props.length,
        warnings: (suggestionsMap.get(n.hostFile) ?? [])
          .filter(s => s.islandId === n.id)
          .map(s => s.shortLabel ?? s.message),
      })),
      null,
      2,
    );
  } else {
    content = buildMarkdownReport(islands);
  }

  fs.writeFileSync(uri.fsPath, content, 'utf8');
  sendEvent('export_report', { format: ext ?? 'md' }, { island_count: islands.length });
  vscode.window.showInformationMessage(`Report exported to ${path.basename(uri.fsPath)}.`);
}

function buildMarkdownReport(islands: IslandNode[]): string {
  const lines: string[] = [
    '# Astro Islands Report',
    '',
    `Generated: ${new Date().toISOString()}  `,
    `Total islands: **${islands.length}**  `,
    `Total gzip size: **~${(islands.reduce((s, n) => s + (n.estimatedSizeGzip ?? 0), 0) / 1024).toFixed(1)} KB**`,
    '',
    '| Component | File | Framework | Directive | Size (gzip) | Warnings |',
    '|-----------|------|-----------|-----------|-------------|----------|',
  ];

  for (const n of islands.sort((a, b) => (b.estimatedSizeGzip ?? 0) - (a.estimatedSizeGzip ?? 0))) {
    const sizeLabel = n.estimatedSizeGzip !== null
      ? `${n.sizeIsHeuristic ? 'Raw ' : ''}~${(n.estimatedSizeGzip / 1024).toFixed(1)} KB`
      : '—';
    const hostShort = n.hostFile.replace(/\\/g, '/').split('/').pop() ?? n.hostFile;
    const warnings = (suggestionsMap.get(n.hostFile) ?? [])
      .filter(s => s.islandId === n.id)
      .map(s => s.shortLabel ?? '⚠')
      .join(', ') || '—';

    lines.push(`| ${n.componentName} | ${hostShort} | ${n.framework} | \`${n.directive}\` | ${sizeLabel} | ${warnings} |`);
  }

  return lines.join('\n') + '\n';
}

// ─── FileSystemWatcher helper ─────────────────────────────────────────────────

async function reanalyzePath(uri: vscode.Uri): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await analyzeDocument(doc);
  } catch { /* file may not be readable */ }
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
