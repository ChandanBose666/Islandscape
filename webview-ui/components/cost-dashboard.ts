import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GraphPayload, SerializedIsland } from '../../src/webview/messageProtocol';
import {
  calcNetworkImpact,
  fmtMs,
  SLOW_USERS_PERCENT,
} from '../../src/utils/networkImpact';

// Hydration timing anchors (ms relative to navigation start)
const DIRECTIVE_TIMING: Record<string, string> = {
  'client:load':    '0 ms (immediate)',
  'client:idle':    '~50 ms (idle callback)',
  'client:visible': 'on scroll / intersection',
  'client:media':   'on media query match',
  'client:only':    '0 ms (client-only)',
};

@customElement('cost-dashboard')
export class CostDashboard extends LitElement {
  static override styles = css`:host { display: block; }`;

  @property({ type: Object }) payload: GraphPayload | null = null;

  private get activeIslands(): SerializedIsland[] {
    if (!this.payload?.activeFile) return [];
    return this.payload.islands.filter(i => i.hostFile === this.payload!.activeFile);
  }

  override render() {
    const { payload } = this;

    if (!payload?.activeFile || this.activeIslands.length === 0) {
      return html`
        <div class="empty-state">
          <div class="icon">📊</div>
          <div>Open an .astro file with islands to see the cost dashboard</div>
        </div>`;
    }

    const totalGzipBytes = (payload.totalGzipKB ?? 0) * 1024;
    const impact = calcNetworkImpact(totalGzipBytes);

    // Find the heaviest island for the highlight callout
    const heaviest = [...this.activeIslands].sort(
      (a, b) => (b.estimatedSizeKB ?? 0) - (a.estimatedSizeKB ?? 0),
    )[0];

    return html`
      <div class="page-summary">

        <!-- ── Hydration waterfall ─────────────────────────────────── -->
        <h3>Hydration Timeline</h3>
        ${this.renderWaterfall()}

        <!-- ── Budget bar ─────────────────────────────────────────── -->
        ${this.renderBudgetBar(payload)}

        <!-- ── Global User Impact ─────────────────────────────────── -->
        <h3 style="margin-top:14px;">Global User Impact
          <span class="sub">(total: ~${payload.totalGzipKB.toFixed(1)} KB islands)</span>
        </h3>

        <div class="impact-table">
          ${impact.map(row => html`
            <div class="impact-row">
              <span class="network">${row.tier.label}</span>
              <span class="region">${row.tier.region}</span>
              <span class="time ${row.tier.warn ? 'warn' : ''}">
                ${fmtMs(row.additionalMs)} additional load
                ${row.tier.warn ? html`<span class="warn-icon">⚠</span>` : ''}
              </span>
            </div>`)}
        </div>

        <div class="note">
          ~${SLOW_USERS_PERCENT}% of global mobile users are on 3G or slower.
          ${heaviest && heaviest.estimatedSizeKB
            ? html`Your heaviest island (<strong>${heaviest.componentName}</strong>,
                ${heaviest.estimatedSizeKB.toFixed(1)} KB) contributes
                ${fmtMs(Math.round((heaviest.estimatedSizeKB * 1024) / 100))}
                of that load time on 3G.`
            : ''}
        </div>

      </div>`;
  }

  private renderWaterfall() {
    const islands = [...this.activeIslands].sort((a, b) => {
      // Sort by hydration timing: load < idle < visible < media < only
      const order = ['client:load', 'client:only', 'client:idle', 'client:visible', 'client:media'];
      return order.indexOf(a.directive) - order.indexOf(b.directive);
    });

    const maxKB = Math.max(...islands.map(i => i.estimatedSizeKB ?? 0), 1);

    return html`
      <div class="waterfall">
        ${islands.map(island => {
          const kb = island.estimatedSizeKB ?? 0;
          const barPct = Math.max(4, (kb / maxKB) * 100);
          const dirClass = island.directive.replace('client:', 'dir-');
          const timing = DIRECTIVE_TIMING[island.directive] ?? '—';

          return html`
            <div class="wf-row" @click=${() => this.revealIsland(island.id)}>
              <span class="wf-timing">${timing.split(' ')[0]}</span>
              <div class="wf-bar-wrap">
                <div class="wf-bar ${dirClass}" style="width:${barPct}%"></div>
              </div>
              <span class="wf-label">
                ${island.componentName}
                <span class="directive ${dirClass}">${island.directive}</span>
                ${kb > 0 ? html`<span class="size">${kb.toFixed(1)} KB</span>` : ''}
                ${island.warnings.length > 0 ? html`<span class="warning">⚠</span>` : ''}
              </span>
            </div>`;
        })}
        <div class="wf-axis">time →</div>
      </div>`;
  }

  private renderBudgetBar(payload: GraphPayload) {
    if (payload.budgetKB === null) return html``;
    const pct = Math.min(100, (payload.totalGzipKB / payload.budgetKB) * 100);
    const over = payload.totalGzipKB > payload.budgetKB;
    return html`
      <div class="budget-section">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
          <span>Page Budget</span>
          <span style="color:${over ? 'var(--vscode-charts-red)' : 'inherit'}">
            ${payload.totalGzipKB.toFixed(1)} / ${payload.budgetKB} KB
            ${over ? '✗ OVER' : '✓'}
          </span>
        </div>
        <div class="budget-bar">
          <div class="fill ${over ? 'over-budget' : ''}" style="width:${pct}%"></div>
        </div>
      </div>`;
  }

  private revealIsland(id: string) {
    this.dispatchEvent(new CustomEvent('reveal-island', { detail: id, bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap { 'cost-dashboard': CostDashboard; }
}
