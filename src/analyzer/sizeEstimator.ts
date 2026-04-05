import * as esbuild from 'esbuild';
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CacheManager, SizeResult } from './cacheManager';

const JSX_EXTENSIONS      = new Set(['.tsx', '.jsx', '.ts', '.js']);
const SVELTE_EXTENSION    = '.svelte';
const VUE_EXTENSION       = '.vue';

// Rough gzip ratio for unminified source code
const HEURISTIC_GZIP_RATIO = 0.35;

export class SizeEstimator {
  constructor(private readonly cache: CacheManager) {}

  async estimate(sourceFile: string): Promise<SizeResult | null> {
    if (!fs.existsSync(sourceFile)) return null;

    let content: string;
    try {
      content = fs.readFileSync(sourceFile, 'utf-8');
    } catch {
      return null;
    }

    const hash = this.cache.hash(content);
    const cached = this.cache.get(hash);
    if (cached) return cached;

    const ext = path.extname(sourceFile).toLowerCase();
    let result: SizeResult | null = null;

    if (JSX_EXTENSIONS.has(ext)) {
      result = await this.estimateWithEsbuild(sourceFile) ?? this.estimateHeuristic(sourceFile);
    } else if (ext === SVELTE_EXTENSION) {
      result = await this.estimateSvelte(sourceFile, content) ?? this.estimateHeuristic(sourceFile);
    } else if (ext === VUE_EXTENSION) {
      result = await this.estimateVue(sourceFile, content) ?? this.estimateHeuristic(sourceFile);
    }

    if (result) this.cache.set(hash, result);
    return result;
  }

  // ─── esbuild (accurate) ──────────────────────────────────────────────────

  private async estimateWithEsbuild(sourceFile: string): Promise<SizeResult | null> {
    try {
      const result = await esbuild.build({
        entryPoints: [sourceFile],
        bundle: true,
        write: false,
        metafile: true,
        platform: 'browser',
        format: 'esm',
        minify: true,
        treeShaking: true,
        logLevel: 'silent',
        // Don't let missing path aliases abort the whole analysis.
        // Unresolved imports become empty stubs; size is slightly under-estimated
        // but far better than no estimate at all.
        plugins: [stubUnresolvedPlugin()],
      });

      const output = result.outputFiles[0].contents;
      const gzipped = zlib.gzipSync(output);
      const sharedPackages = extractNpmPackages(result.metafile!);

      return {
        sizeBytes: output.length,
        sizeGzip: gzipped.length,
        isHeuristic: false,
        sharedPackages,
      };
    } catch {
      return null;
    }
  }

  // ─── Svelte SFC (svelte/compiler → esbuild) ──────────────────────────────

  private async estimateSvelte(sourceFile: string, content: string): Promise<SizeResult | null> {
    try {
      // Dynamic require keeps svelte out of the extension bundle (marked external)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const svelte = require('svelte/compiler') as typeof import('svelte/compiler');
      const { js } = svelte.compile(content, {
        filename: sourceFile,
        generate: 'client',
        dev: false,
      });

      // Write compiled JS to a temp file so esbuild can bundle its deps
      const tmpFile = path.join(os.tmpdir(), `aiv-svelte-${Date.now()}.js`);
      fs.writeFileSync(tmpFile, js.code, 'utf8');
      try {
        return await this.estimateWithEsbuild(tmpFile) ?? null;
      } finally {
        fs.rmSync(tmpFile, { force: true });
      }
    } catch {
      return null;
    }
  }

  // ─── Vue SFC (@vue/compiler-sfc → esbuild) ───────────────────────────────

  private async estimateVue(sourceFile: string, content: string): Promise<SizeResult | null> {
    try {
      // Dynamic require keeps @vue/compiler-sfc out of the bundle
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { parse, compileScript, compileTemplate } =
        require('@vue/compiler-sfc') as typeof import('@vue/compiler-sfc');

      const { descriptor } = parse(content, { filename: sourceFile });
      const id = `vue-${Date.now()}`;

      const script = compileScript(descriptor, { id });
      const template = compileTemplate({
        source: descriptor.template?.content ?? '',
        filename: sourceFile,
        id,
        scoped: descriptor.styles.some(s => s.scoped),
      });

      const combined = `${script.content}\n${template.code}`;
      const tmpFile = path.join(os.tmpdir(), `aiv-vue-${id}.js`);
      fs.writeFileSync(tmpFile, combined, 'utf8');
      try {
        return await this.estimateWithEsbuild(tmpFile) ?? null;
      } finally {
        fs.rmSync(tmpFile, { force: true });
      }
    } catch {
      return null;
    }
  }

  // ─── Heuristic (fs.stat) ─────────────────────────────────────────────────

  private estimateHeuristic(sourceFile: string): SizeResult | null {
    try {
      const rawBytes = fs.statSync(sourceFile).size;
      return {
        sizeBytes: rawBytes,
        sizeGzip: Math.round(rawBytes * HEURISTIC_GZIP_RATIO),
        isHeuristic: true,
        sharedPackages: [],
      };
    } catch {
      return null;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * esbuild plugin: when a module can't be resolved (e.g. path aliases like @/utils),
 * replace it with an empty module instead of throwing a build error.
 */
function stubUnresolvedPlugin(): esbuild.Plugin {
  return {
    name: 'stub-unresolved',
    setup(build) {
      // Intercept all resolution errors and return an empty module
      build.onResolve({ filter: /.*/ }, args => {
        // Let esbuild try first; only intercept if it would fail
        if (args.kind === 'entry-point') return null;
        // Absolute paths and relative paths are fine; only alias/bare specifiers
        // that don't resolve to a real file might fail
        return null;
      });

      build.onLoad({ filter: /.*/ }, args => {
        if (!fs.existsSync(args.path)) {
          return { contents: 'export default {}', loader: 'js' };
        }
        return null;
      });
    },
  };
}

function extractNpmPackages(metafile: esbuild.Metafile): string[] {
  const pkgs = new Set<string>();
  for (const inputPath of Object.keys(metafile.inputs)) {
    const idx = inputPath.lastIndexOf('node_modules/');
    if (idx === -1) continue;
    const rest = inputPath.slice(idx + 'node_modules/'.length).split('/');
    const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
    if (name) pkgs.add(name);
  }
  return [...pkgs];
}
