const esbuild = require('esbuild');
const path    = require('path');

const isWatch = process.argv.includes('--watch');

// ─── Extension bundle ─────────────────────────────────────────────────────────
// Runs in the VSCode extension host (Node.js). Keep svelte and @vue/compiler-sfc
// external so they load from node_modules at runtime (they use dynamic requires
// and WASM that esbuild can't inline safely).
const extensionOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode', '@astrojs/compiler', 'esbuild', 'svelte', '@vue/compiler-sfc'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
};

// ─── Webview bundle ───────────────────────────────────────────────────────────
// Runs inside the VSCode webview (browser-like environment, no Node.js APIs).
// Lit and Cytoscape are bundled in — no CDN allowed inside webviews.
const webviewOptions = {
  entryPoints: ['webview-ui/main.ts'],
  bundle: true,
  outfile: 'out/webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  // Experimental decorators (used by Lit) require tsconfig to be read by esbuild.
  tsconfig: path.resolve(__dirname, 'tsconfig.webview.json'),
};

// ─── CSS copy — copy webview styles to out/ ───────────────────────────────────
const cssOptions = {
  entryPoints: ['webview-ui/styles.css'],
  outfile: 'out/webview.css',
  bundle: false,
  loader: { '.css': 'copy' },
};

if (isWatch) {
  Promise.all([
    esbuild.context(extensionOptions).then(ctx => ctx.watch()),
    esbuild.context(webviewOptions).then(ctx => ctx.watch()),
  ]).catch(() => process.exit(1));
} else {
  Promise.all([
    esbuild.build(extensionOptions),
    esbuild.build(webviewOptions),
    esbuild.build({ ...cssOptions, loader: { '.css': 'copy' } }).catch(() => {
      // Fallback: copy manually if esbuild copy loader unavailable
      const fs = require('fs');
      fs.mkdirSync('out', { recursive: true });
      fs.copyFileSync('webview-ui/styles.css', 'out/webview.css');
    }),
  ]).catch(() => process.exit(1));
}
