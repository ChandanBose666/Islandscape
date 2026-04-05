import './components/island-list';
import './components/page-view';
import './components/island-graph';

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { ExtensionMessage, GraphPayload, WebviewMessage } from '../src/webview/messageProtocol';

// VSCode webview API
declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewMessage): void;
};

const vscode = acquireVsCodeApi();

type Tab = 'list' | 'page' | 'graph';

@customElement('island-app')
class IslandApp extends LitElement {
  static override styles = css`:host { display: block; }`;

  @state() private tab: Tab = 'list';
  @state() private payload: GraphPayload | null = null;

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener('message', this.onMessage);
    vscode.postMessage({ type: 'ready' });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('message', this.onMessage);
  }

  private onMessage = (event: MessageEvent<ExtensionMessage>) => {
    const msg = event.data;
    if (msg.type === 'update') {
      this.payload = msg.payload;
    } else if (msg.type === 'activeFileChanged') {
      if (this.payload) {
        this.payload = { ...this.payload, activeFile: msg.activeFile };
      }
    }
  };

  override render() {
    return html`
      <div class="tab-bar">
        ${this.tabButton('list',  '🏝 Islands')}
        ${this.tabButton('page',  '📄 Page')}
        ${this.tabButton('graph', '🕸 Graph')}
      </div>

      <div class="tab-content ${this.tab === 'list' ? 'visible' : ''}">
        <island-list
          .payload=${this.payload}
          @reveal-island=${this.onRevealIsland}>
        </island-list>
      </div>

      <div class="tab-content ${this.tab === 'page' ? 'visible' : ''}">
        <page-view
          .payload=${this.payload}
          @reveal-island=${this.onRevealIsland}>
        </page-view>
      </div>

      <div class="tab-content ${this.tab === 'graph' ? 'visible' : ''}">
        <island-graph
          .payload=${this.payload}
          @reveal-island=${this.onRevealIsland}
          @reveal-file=${this.onRevealFile}>
        </island-graph>
      </div>`;
  }

  private tabButton(id: Tab, label: string) {
    return html`
      <button
        class="${this.tab === id ? 'active' : ''}"
        @click=${() => { this.tab = id; }}>
        ${label}
      </button>`;
  }

  private onRevealIsland(e: Event) {
    const id = (e as CustomEvent<string>).detail;
    vscode.postMessage({ type: 'revealIsland', islandId: id });
  }

  private onRevealFile(e: Event) {
    const path = (e as CustomEvent<string>).detail;
    vscode.postMessage({ type: 'revealFile', filePath: path });
  }
}

declare global {
  interface HTMLElementTagNameMap { 'island-app': IslandApp; }
}
