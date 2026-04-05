import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import cytoscape, { type Core, type ElementDefinition, type Stylesheet } from 'cytoscape';
import type { GraphPayload } from '../../src/webview/messageProtocol';

// Framework → color mapping (same palette as CSS badges)
const FRAMEWORK_COLORS: Record<string, string> = {
  react:   '#61dafb',
  svelte:  '#ff3e00',
  vue:     '#42b883',
  solid:   '#446b9e',
  preact:  '#673ab8',
  lit:     '#324fff',
  unknown: '#888888',
};

@customElement('island-graph')
export class IslandGraph extends LitElement {
  // Graph renders outside shadow DOM so Cytoscape can access DOM dimensions
  static override shadowRootOptions = { ...LitElement.shadowRootOptions, mode: 'open' as const };
  static override styles = css`
    :host { display: block; }
    #cy-container { width: 100%; height: calc(100vh - 31px); }
  `;

  @property({ type: Object }) payload: GraphPayload | null = null;

  private cy: Core | null = null;
  private container: HTMLElement | null = null;

  override render() {
    return html`<div id="cy-container"></div>`;
  }

  override firstUpdated() {
    this.container = this.renderRoot.querySelector('#cy-container');
    this.initCytoscape();
  }

  override updated(changedProps: Map<string, unknown>) {
    if (changedProps.has('payload')) {
      this.rebuildGraph();
    }
  }

  private initCytoscape() {
    if (!this.container) return;

    this.cy = cytoscape({
      container: this.container,
      style: this.buildStylesheet(),
      layout: { name: 'breadthfirst', directed: true, padding: 20 } as cytoscape.BreadthFirstLayoutOptions,
      elements: [],
      wheelSensitivity: 0.3,
    });

    this.cy.on('tap', 'node', evt => {
      const data = evt.target.data() as { type: string; filePath?: string; id?: string };
      if (data.type === 'island' && data.id) {
        this.dispatchEvent(new CustomEvent('reveal-island', { detail: data.id, bubbles: true, composed: true }));
      } else if (data.filePath) {
        this.dispatchEvent(new CustomEvent('reveal-file', { detail: data.filePath, bubbles: true, composed: true }));
      }
    });

    this.rebuildGraph();
  }

  private rebuildGraph() {
    if (!this.cy || !this.payload) return;

    const { islands, renderEdges, stateEdges } = this.payload;
    const elements: ElementDefinition[] = [];

    // ── Page nodes (unique host files) ───────────────────────────────────
    const pageFiles = new Set(islands.map(i => i.hostFile));
    for (const file of pageFiles) {
      elements.push({
        data: {
          id: `page:${file}`,
          label: shortName(file),
          type: 'page',
          filePath: file,
        },
      });
    }

    // ── Island nodes ─────────────────────────────────────────────────────
    for (const island of islands) {
      const sizeLabel = island.estimatedSizeKB !== null
        ? `\n~${island.estimatedSizeKB.toFixed(1)} KB`
        : '';
      elements.push({
        data: {
          id: island.id,
          label: `${island.componentName}${sizeLabel}`,
          type: 'island',
          framework: island.framework,
          directive: island.directive,
          hasWarning: island.warnings.length > 0,
          filePath: island.sourceFile ?? undefined,
        },
      });
    }

    // ── Store nodes (from state edges) ────────────────────────────────────
    const addedStores = new Set<string>();
    for (const edge of stateEdges) {
      if (!addedStores.has(edge.storeName)) {
        elements.push({
          data: {
            id: `store:${edge.storeName}`,
            label: edge.storeName,
            type: 'store',
            filePath: edge.storeSourceFile,
          },
        });
        addedStores.add(edge.storeName);
      }
    }

    // ── Render edges (page → island) ──────────────────────────────────────
    for (const e of renderEdges) {
      elements.push({
        data: {
          id: `re:${e.parentFile}:${e.islandId}`,
          source: `page:${e.parentFile}`,
          target: e.islandId,
          type: 'renders',
        },
      });
    }

    // ── State edges (island → store, dashed) ─────────────────────────────
    for (const e of stateEdges) {
      for (const consumerId of e.consumerIds) {
        elements.push({
          data: {
            id: `se:${e.storeName}:${consumerId}`,
            source: consumerId,
            target: `store:${e.storeName}`,
            type: 'state',
          },
        });
      }
    }

    this.cy.elements().remove();
    this.cy.add(elements);
    this.cy.style(this.buildStylesheet());
    this.cy.layout({ name: 'breadthfirst', directed: true, padding: 20 } as cytoscape.BreadthFirstLayoutOptions).run();
    this.cy.fit(undefined, 20);
  }

  private buildStylesheet(): Stylesheet[] {
    // Read VSCode CSS variables for theme awareness
    const fgColor   = getComputedStyle(document.body).getPropertyValue('--vscode-foreground').trim() || '#ccc';
    const bgColor   = getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e';
    const edgeColor = getComputedStyle(document.body).getPropertyValue('--vscode-panel-border').trim() || '#444';

    return [
      {
        selector: 'node[type="page"]',
        style: {
          'shape': 'rectangle',
          'background-color': bgColor,
          'border-color': fgColor,
          'border-width': 1.5,
          'label': 'data(label)',
          'color': fgColor,
          'font-size': 10,
          'text-valign': 'center',
          'text-halign': 'center',
          'width': 'label',
          'height': 'label',
          'padding': 8,
        },
      },
      {
        selector: 'node[type="island"]',
        style: {
          'shape': 'round-rectangle',
          'background-color': (ele) => FRAMEWORK_COLORS[(ele.data('framework') as string) ?? 'unknown'] ?? '#888',
          'background-opacity': 0.2,
          'border-color': (ele) => FRAMEWORK_COLORS[(ele.data('framework') as string) ?? 'unknown'] ?? '#888',
          'border-width': 1.5,
          'label': 'data(label)',
          'color': fgColor,
          'font-size': 9,
          'text-valign': 'center',
          'text-halign': 'center',
          'width': 'label',
          'height': 'label',
          'padding': 8,
          'text-wrap': 'wrap',
        },
      },
      {
        selector: 'node[type="island"][?hasWarning]',
        style: {
          'border-color': '#ff9900',
          'border-width': 2,
        },
      },
      {
        selector: 'node[type="store"]',
        style: {
          'shape': 'diamond',
          'background-color': bgColor,
          'border-color': edgeColor,
          'border-width': 1.5,
          'label': 'data(label)',
          'color': fgColor,
          'font-size': 9,
          'text-valign': 'center',
          'text-halign': 'center',
          'width': 60,
          'height': 40,
        },
      },
      {
        selector: 'edge[type="renders"]',
        style: {
          'width': 1,
          'line-color': edgeColor,
          'target-arrow-color': edgeColor,
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
        },
      },
      {
        selector: 'edge[type="state"]',
        style: {
          'width': 1,
          'line-color': '#a050dc',
          'target-arrow-color': '#a050dc',
          'target-arrow-shape': 'triangle',
          'line-style': 'dashed',
          'curve-style': 'bezier',
        },
      },
      {
        selector: 'node:selected',
        style: {
          'border-color': 'var(--vscode-focusBorder, #007fd4)',
          'border-width': 2.5,
        },
      },
    ];
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.cy?.destroy();
    this.cy = null;
  }
}

function shortName(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
}

declare global {
  interface HTMLElementTagNameMap { 'island-graph': IslandGraph; }
}
