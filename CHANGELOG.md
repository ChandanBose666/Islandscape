# Changelog

All notable changes to Astro Island Visualizer are documented here.

## [0.1.0] — 2026-04-05

### Added

**Phase 1 — Foundation**
- Island detection via `@astrojs/compiler` WASM — finds all `client:*` component usages in `.astro` files
- Import resolver: maps component names to resolved file paths, handles `@/` and `~/` aliases via `tsconfig-paths`
- Framework detector: React, Preact, Solid, Svelte, Vue, Lit — by file extension and import scan
- `CodeLensProvider`: colour-coded inline annotations above every island (🔴 load · 🟡 idle · 🟢 visible · 🔵 media · 🟣 only)
- `DiagnosticProvider`: advisory warning on `client:load` usage
- Debounced analysis (300 ms) triggered on file open and edit
- Status bar item: island count, total gzip KB

**Phase 2 — Intelligence**
- `SizeEstimator`: esbuild in-memory bundle + `zlib` gzip for `.tsx/.jsx/.ts/.js` islands
- `CacheManager`: MD5 content-hash keyed in-memory cache, invalidated on save
- `UnusedDirectiveChecker`: per-framework regex patterns to detect state, hooks, and event handlers
- `SuggestionEngine`: three rules — large-eager, unused-directive, framework-entry-cost
- `CodeActionProvider`: "Convert to client:idle" and "Remove hydration directive" lightbulbs
- CodeLens now shows gzip KB (e.g. `~34.2 KB` or `Raw ~18 KB` for heuristic estimates)
- Status bar turns red when over per-route budget
- Settings: `astroIslands.eagerSizeThresholdKB`, `astroIslands.budgets`

**Phase 3 — Visualization**
- Sidebar panel ("Island Map") with three tabs: Islands, Page, Graph
- `WebviewViewProvider` with typed bidirectional message protocol
- **Island List tab**: flat list with framework badges, directive chips, size, warning badges
- **Page View tab**: virtual page assembly — aggregate stats, budget bar, over-budget indicator
- **Dependency Graph tab**: Cytoscape.js DAG — page → island → nanostore nodes, theme-aware colours, click-to-navigate
- `NanostoreDetector`: scans for nanostores imports, builds dashed state-sharing edges in the graph
- `PropAnalyzer`: flags large inline prop literals and dynamic data-named props
- Full SFC size estimation: `svelte/compiler` (Svelte) and `@vue/compiler-sfc` (Vue) compiled then bundled with esbuild
- `FileSystemWatcher` on `src/pages/**/*.astro` — live re-analysis on create, change, and delete
- Command: "Astro Islands: Analyze Workspace" with progress notification

**Phase 4 — Impact**
- **Cost Dashboard tab** (4th sidebar tab): hydration waterfall timeline + budget bar + Global User Impact panel
- Global User Impact: load-time estimates for 4G/3G/2G by region from hardcoded WebPageTest median throughput data
- `IslandHoverProvider`: markdown tooltip on island component names showing framework, directive, size, timing note
- Command: "Astro Islands: Jump to Largest Island"
- Command: "Astro Islands: Export Report" — saves JSON or Markdown report sorted by size
- `SuggestionEngine` Rule 2b: below-fold heuristic — `client:load` on components named footer/related/sidebar/comments triggers "Convert to `client:visible`" lightbulb

**Phase 5 — Polish**
- Extension icon and marketplace listing metadata
- VSCode Walkthroughs onboarding (3-step intro)
- Opt-in anonymous telemetry via `@vscode/extension-telemetry`
- README with install instructions, feature overview, and configuration reference
- CI/CD: GitHub Actions workflow — build, type-check, and `vsce package` on every push and PR
- CHANGELOG
