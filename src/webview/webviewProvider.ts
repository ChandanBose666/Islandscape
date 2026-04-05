import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import type { IslandGraph, IslandNode } from '../model/islandGraph';
import type { Suggestion } from '../suggestions/suggestionEngine';
import type {
  ExtensionMessage,
  GraphPayload,
  SerializedIsland,
  WebviewMessage,
} from './messageProtocol';

export class IslandWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'astroIslands.islandMap';

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly graph: IslandGraph,
    private readonly getSuggestions: (hostFile: string) => Suggestion[],
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out')],
    };

    webviewView.webview.html = this.buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      if (msg.type === 'ready') {
        this.push();
      } else if (msg.type === 'revealIsland') {
        vscode.commands.executeCommand('astroIslands.revealIsland', msg.islandId);
      } else if (msg.type === 'revealFile') {
        vscode.window.showTextDocument(vscode.Uri.file(msg.filePath));
      }
    });
  }

  /** Called by extension.ts whenever the graph or active editor changes. */
  push(): void {
    if (!this.view?.visible) return;
    const payload = this.buildPayload();
    const msg: ExtensionMessage = { type: 'update', payload };
    this.view.webview.postMessage(msg);
  }

  /** Lightweight notification when only the active file changes. */
  pushActiveFileChanged(activeFile: string | null): void {
    if (!this.view?.visible) return;
    const msg: ExtensionMessage = { type: 'activeFileChanged', activeFile };
    this.view.webview.postMessage(msg);
  }

  // ─── Payload builder ────────────────────────────────────────────────────

  private buildPayload(): GraphPayload {
    const activeFile =
      vscode.window.activeTextEditor?.document.languageId === 'astro'
        ? vscode.window.activeTextEditor.document.uri.fsPath
        : null;

    const islands = this.serializeIslands(activeFile);

    const activeIslands = activeFile
      ? islands.filter(i => i.hostFile === activeFile)
      : islands;

    const totalGzipKB = activeIslands.reduce(
      (sum, i) => sum + (i.estimatedSizeKB ?? 0),
      0,
    );

    const budgetKB = activeFile ? this.getBudget(activeFile) : null;

    return {
      islands,
      renderEdges: this.graph.renderEdges,
      stateEdges: this.graph.stateEdges,
      activeFile,
      budgetKB,
      totalGzipKB,
    };
  }

  private serializeIslands(activeFile: string | null): SerializedIsland[] {
    const results: SerializedIsland[] = [];

    for (const node of this.graph.nodes.values()) {
      // In sidebar we show islands from the active file; for the graph tab we send all.
      const suggestions = this.getSuggestions(node.hostFile);
      const warnings = suggestions
        .filter(s => s.islandId === node.id)
        .map(s => s.shortLabel ?? s.message.slice(0, 60));

      results.push({
        id: node.id,
        componentName: node.componentName,
        sourceFile: node.sourceFile,
        hostFile: node.hostFile,
        framework: node.framework,
        directive: node.directive,
        directiveValue: node.directiveValue,
        estimatedSizeKB:
          node.estimatedSizeGzip !== null ? node.estimatedSizeGzip / 1024 : null,
        sizeIsHeuristic: node.sizeIsHeuristic,
        propCount: node.props.length,
        hasDynamicProp: node.props.some(p => p.isDynamic),
        warnings,
      });
    }

    return results;
  }

  private getBudget(activeFile: string): number | null {
    const budgets = vscode.workspace
      .getConfiguration('astroIslands')
      .get<Record<string, number>>('budgets', {});
    const fsPath = activeFile.replace(/\\/g, '/');
    for (const [pattern, budget] of Object.entries(budgets)) {
      if (fsPath.includes(pattern.replace(/\*/g, ''))) return budget;
    }
    return null;
  }

  // ─── HTML builder ───────────────────────────────────────────────────────

  private buildHtml(webview: vscode.Webview): string {
    const nonce     = crypto.randomBytes(16).toString('hex');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview.js'),
    );
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview.css'),
    );
    const origin = webview.cspSource;

    // Read the HTML template and fill in placeholders
    const html = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 script-src 'nonce-${nonce}';
                 style-src 'unsafe-inline' ${origin};
                 img-src data: ${origin};" />
  <link rel="stylesheet" href="${stylesUri}" />
  <title>Island Map</title>
</head>
<body>
  <island-app></island-app>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;

    return html;
  }
}
