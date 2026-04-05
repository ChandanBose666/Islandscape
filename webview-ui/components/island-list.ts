import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GraphPayload, SerializedIsland } from '../../src/webview/messageProtocol';

@customElement('island-list')
export class IslandList extends LitElement {
  static override styles = css`:host { display: block; }`;

  @property({ type: Object }) payload: GraphPayload | null = null;

  private get islands(): SerializedIsland[] {
    if (!this.payload) return [];
    const active = this.payload.activeFile;
    return active
      ? this.payload.islands.filter(i => i.hostFile === active)
      : this.payload.islands;
  }

  override render() {
    const islands = this.islands;
    if (islands.length === 0) {
      return html`
        <div class="empty-state">
          <div class="icon">🏝️</div>
          <div>No islands found in this file</div>
        </div>`;
    }

    return html`${islands.map(i => this.renderItem(i))}`;
  }

  private renderItem(island: SerializedIsland) {
    const sizeLabel = island.estimatedSizeKB !== null
      ? `${island.sizeIsHeuristic ? 'Raw ' : ''}~${island.estimatedSizeKB.toFixed(1)} KB`
      : '—';

    const directiveClass = island.directive.replace('client:', 'dir-');

    return html`
      <div class="island-item" @click=${() => this.revealIsland(island.id)}>
        <div style="display:flex;flex-direction:column;flex:1;min-width:0;gap:3px;">
          <div style="display:flex;align-items:center;gap:5px;">
            <span class="name">${island.componentName}</span>
            <span class="badge badge-${island.framework}">${island.framework}</span>
            <span class="directive ${directiveClass}">${island.directive}</span>
          </div>
          ${island.warnings.length > 0
            ? html`<div class="warning">⚠ ${island.warnings[0]}</div>`
            : ''}
        </div>
        <span class="size">${sizeLabel}</span>
      </div>`;
  }

  private revealIsland(id: string) {
    this.dispatchEvent(new CustomEvent('reveal-island', { detail: id, bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap { 'island-list': IslandList; }
}
