/**
 * THE HELP CENTER AND LEGAL DOCUMENTS WEAR THE ARENA, AND THE PRERENDER STAYS
 * SESSIONLESS (#SmarterDesign player pages batch P2, 2026-11-28)
 *
 * The Help Center and the four legal documents moved to the arena workspace.
 * Three things keep that pass honest:
 *  1. each page root, and the Help Center's prerender, carries .arena-workspace,
 *     and both Help renderers print the same mast;
 *  2. the dress stays on its own page: SystemStatus keeps its own sheet, and
 *     the Help page reaches into it only under its own status case; the legal
 *     layout is printed by the four legal pages and nothing else;
 *  3. the prerender path (src/prerender/entry-server.tsx renders these pages
 *     for signed-out readers and crawlers) never reaches the Supabase client or
 *     anything that needs a browser session, now that it imports the mast.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function selectors(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@') && !/^(from|to|\d+%)/.test(s))
    .flatMap((s) => s.split(','))
    .map((s) => s.trim());
}

/** Every module reachable by relative import from a file, as repo paths. */
function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [resolve(process.cwd(), entry)];
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(tsx?|mjs|js)$/.test(file)) continue;
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(
      /(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]|import\s*\(?\s*['"](\.[^'"]+)['"]/g
    )) {
      const spec = m[1] ?? m[2];
      const base = resolve(dirname(file), spec);
      const hit = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        join(base, 'index.ts'),
        join(base, 'index.tsx'),
      ].find((p) => existsSync(p) && statSync(p).isFile());
      if (hit) queue.push(hit);
    }
  }
  return new Set([...seen].map((p) => p.slice(process.cwd().length + 1)));
}

describe('the Help Center and legal documents wear the arena workspace', () => {
  it('each page root carries .arena-workspace and the arena mast', () => {
    for (const path of [
      'src/pages/HelpPage.tsx',
      'src/prerender/HelpPrerender.tsx',
      'src/components/legal/LegalDocumentLayout.tsx',
    ]) {
      const source = read(path);
      expect(source, path).toMatch(/className=\{`\$\{styles\.page\} arena-workspace`\}/);
      expect(source, path).toContain('<ArenaWorkspaceHeader');
      // The mast carries the one chrome "?"; the page bar under it prints none.
      expect(source, path).toMatch(/<PageBar[^>]*titleAs=\{false\}[^>]*showHelp=\{false\}/s);
    }
  });

  it('both Help renderers print the same mast', () => {
    const mast = (s: string) => s.match(/<ArenaWorkspaceHeader[\s\S]*?\/>/)?.[0];
    expect(mast(read('src/prerender/HelpPrerender.tsx'))).toBe(
      mast(read('src/pages/HelpPage.tsx'))
    );
  });
});

describe('the dress stays on its own page', () => {
  it('SystemStatus keeps its own sheet; the Help page dresses it only inside its status case', () => {
    expect(read('src/components/support/SystemStatus.module.css')).not.toContain('arena');
    const reach = selectors(read('src/pages/HelpPage.module.css')).filter((s) =>
      /\.statusDeck/.test(s)
    );
    expect(reach.length).toBeGreaterThan(4);
    for (const s of reach) expect(s.startsWith('.statusDeck')).toBe(true);
  });

  it('the legal layout is printed by the four legal documents and nothing else', () => {
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && read(p).includes('LegalDocumentLayout')) users.push(p);
      }
    };
    walk('src');
    expect(users.sort()).toEqual([
      'src/components/legal/LegalDocumentLayout.tsx',
      'src/pages/legal/FairGamingPage.tsx',
      'src/pages/legal/PrivacyPolicyPage.tsx',
      'src/pages/legal/PromotionsPage.tsx',
      'src/pages/legal/TermsOfServicePage.tsx',
    ]);
  });
});

describe('the prerender path stays sessionless', () => {
  it.each([
    'src/prerender/HelpPrerender.tsx',
    'src/pages/legal/TermsOfServicePage.tsx',
    'src/pages/legal/PrivacyPolicyPage.tsx',
    'src/pages/legal/FairGamingPage.tsx',
    'src/pages/legal/PromotionsPage.tsx',
  ])('%s never reaches the Supabase client or a session hook', (entry) => {
    const graph = importGraph(entry);
    expect(graph.has('src/components/lobby/ArenaWorkspaceHeader.tsx')).toBe(true);
    for (const path of graph) {
      expect(path).not.toMatch(/src\/lib\/supabase\.ts$|useAuthUser|ClubWorkspaceContext/);
    }
  });
});
