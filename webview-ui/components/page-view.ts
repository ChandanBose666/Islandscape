import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GraphPayload, SerializedIsland } from '../../src/webview/messageProtocol';

@customElement('page-view')
export class PageView extends LitElement {
  static override styles = css`:host { display: block; }`;

  @property({ type: Object }) payload: GraphPayload | null = null;

  private get activeIslands(): SerializedIsland[] {
    if (!this.payload?.activeFile) return [];
    return this.payload.islands.filter(i => i.hostFile === this.payload!.activeFile);
  }

  override render() {
    const { payload } = this;
    if (!payload?.activeFile) {
      return html`
        <div class="empty-state">
          <div class="icon">📄</div>
          <div>Open an .astro file to see its page view</div>
        </div>`;
    }

    const islands = this.activeIslands;
    if (islands.length === 0) {
      return html`
        <div class="empty-state">
          <div class="icon">✅</div>
          <div>No islands on this page</div>
        </div>`;
    }

    const totalKB = payload.totalGzipKB;
    const budget  = payload.budgetKB;
    const overBudget = budget !== null && totalKB > budget;
    const fillPct = budget !== null ? Math.min(100, (totalKB / budget) * 100) : 0;

    // Deduplicated shared packages
    const pkgCount = new Map<string, number>();
    for (const island of islands) {
      // warnings include "Framework Entry Cost" etc — already surfaced via list
    }

    return html`
      <div class="page-summary">
        <h3>Page View — ${shortPath(payload.activeFile)}</h3>

        ${islands.map(i => this.renderRow(i))}

        <div class="page-total">
          <span>Total gzip</span>
          <span style="color:${overBudget ? 'var(--vscode-charts-red)' : 'inherit'}">
            ~${totalKB.toFixed(1)} KB
            ${budget !== null ? html` / ${budget} KB budget ${overBudget ? '✗ OVER' : '✓'}` : ''}
          </span>
        </div>

        ${budget !== null ? html`
          <div class="budget-bar">
            <div class="fill ${overBudget ? 'over-budget' : ''}"
                 style="width:${fillPct}%"></div>
          </div>` : ''}
      </div>`;
  }

  private renderRow(island: SerializedIsland) {
    const sizeLabel = island.estimatedSizeKB !== null
      ? `${island.sizeIsHeuristic ? 'Raw ' : ''}~${island.estimatedSizeKB.toFixed(1)} KB`
      : '—';

    const directiveClass = island.directive.replace('client:', 'dir-');

    return html`
      <div class="island-item" @click=${() => this.revealIsland(island.id)}>
        <span class="badge badge-${island.framework}">${island.framework[0].toUpperCase()}</span>
        <span class="name">${island.componentName}</span>
        <span class="directive ${directiveClass}">${island.directive}</span>
        <span class="size" style="margin-left:auto;">${sizeLabel}</span>
        ${island.warnings.length > 0 ? html`<span class="warning">⚠</span>` : ''}
      </div>`;
  }

  private revealIsland(id: string) {
    this.dispatchEvent(new CustomEvent('reveal-island', { detail: id, bubbles: true, composed: true }));
  }
}

function shortPath(p: string): string {
  const idx = p.replace(/\\/g, '/').lastIndexOf('/src/');
  return idx !== -1 ? p.slice(idx + 1).replace(/\\/g, '/') : p.split(/[/\\]/).pop() ?? p;
}

declare global {
  interface HTMLElementTagNameMap { 'page-view': PageView; }
}
