/**
 * Bundles the table surface fixture and its stylesheets for the rendered ink
 * guard (tests/e2e/css/table-surfaces-wear-smarterdesign.spec.ts). Plain .mjs
 * so the spec and a dev probe can both import it.
 *
 * Two modules are swapped for offline stand-ins: src/lib/supabase.ts and
 * src/hooks/useAuthUser.ts. Stylesheets are read from disk in the app's own
 * cascade order: the global sheets main.tsx and TablePage import, then every
 * stylesheet the bundled components import (from esbuild's metafile).
 */
import { build, buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const GLOBAL_SHEETS = [
  'src/styles/club-engine.css',
  'src/styles/animations.css',
  'src/styles/metallic-popups.css',
  'src/styles/reducedMotion.css',
  'src/components/table/ControlThemeTokens.css',
  'src/styles/table-design-tokens.css',
  'src/pages/MultiTablePage.css',
  'src/pages/TablePage.css',
];

const swaps = [
  [/[\\/]src[\\/]lib[\\/]supabase(\.ts)?$/, resolve(HERE, 'supabaseStub.ts')],
  [/[\\/]src[\\/]hooks[\\/]useAuthUser(\.ts)?$/, resolve(HERE, 'authStub.ts')],
];

const offline = {
  name: 'table-surfaces-offline',
  setup(build) {
    build.onResolve({ filter: /(supabase|useAuthUser)$/ }, (args) => {
      if (args.importer.startsWith(HERE)) return undefined;
      const full = resolve(args.resolveDir, args.path);
      for (const [re, to] of swaps) if (re.test(full)) return { path: to };
      return undefined;
    });
  },
};

export async function buildTableSurfaces(root) {
  const built = await build({
    entryPoints: [resolve(HERE, 'tableSurfacesFixture.tsx')],
    absWorkingDir: root,
    bundle: true,
    write: false,
    jsx: 'automatic',
    metafile: true,
    format: 'iife',
    platform: 'browser',
    outfile: 'table-surfaces.js',
    logLevel: 'silent',
    plugins: [offline],
    loader: {
      '.css': 'empty',
      '.png': 'dataurl',
      '.webp': 'dataurl',
      '.svg': 'dataurl',
      '.jpg': 'dataurl',
      '.mp3': 'empty',
      '.wav': 'empty',
    },
    // Vite's import.meta.glob (Table Studio's thumbnail catalogue) has no
    // esbuild meaning; the fixture serves an empty catalogue instead.
    banner: { js: 'var __tableSurfacesGlob = function () { return {}; };' },
    define: {
      'import.meta.glob': '__tableSurfacesGlob',
      'import.meta.env': JSON.stringify({
        VITE_SUPABASE_URL: 'https://offline.fixture',
        VITE_SUPABASE_ANON_KEY: 'fixture',
        BASE_URL: '/hub/club-arena/',
        DEV: false,
        PROD: true,
        MODE: 'test',
      }),
      'process.env.NODE_ENV': '"production"',
    },
  });
  const componentSheets = Object.keys(built.metafile.inputs).filter((f) => f.endsWith('.css'));
  const sheets = [...new Set([...GLOBAL_SHEETS, ...componentSheets])];
  const readStyle = (file) =>
    readFileSync(resolve(root, file), 'utf8').replace(
      /^\s*@import\s+(?:url\()?['"]([^'"]+)['"]\)?[^;]*;/gm,
      (_, imported) =>
        imported.startsWith('http')
          ? ''
          : readStyle(resolve(dirname(resolve(root, file)), imported))
    );
  const js = built.outputFiles.find((f) => f.path.endsWith('.js')).text;
  return { js, css: sheets.map(readStyle).join('\n'), sheets };
}

export const AUDIT_ENTRY = resolve(HERE, 'inkAudit.ts');

export function buildInkAudit(root) {
  return buildSync({
    entryPoints: [AUDIT_ENTRY],
    absWorkingDir: root,
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'InkAudit',
    platform: 'browser',
    logLevel: 'silent',
  }).outputFiles[0].text;
}
