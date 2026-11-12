import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// #10290 replaced the Table Studio's `aria-label="Current Table Configuration"`
// region with a collapsed <details>, and the production spec kept selecting the
// old label. The selector matched nothing, Post-Deploy E2E failed every run
// from 11-09 (operational alert 371597). A production spec may select an
// aria-label only when the client source can render that exact label.

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
  });
}

const source = sourceFiles('src')
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

function sourceCanRender(label: string): boolean {
  for (const quote of ['"', "'", '`']) {
    if (source.includes(`${quote}${label}${quote}`)) return true;
  }
  // A template such as `${title} Live Summary` renders any "<title> Live Summary".
  const words = label.split(' ');
  for (let i = 1; i < words.length; i++) {
    if (source.includes(`} ${words.slice(i).join(' ')}\``)) return true;
  }
  return false;
}

it('selects only aria-labels the client source renders in every production spec', () => {
  const specs = readdirSync('tests/e2e').filter((name) => /^production-.*\.spec\.ts$/.test(name));
  expect(specs.length).toBeGreaterThan(0);
  const missing: string[] = [];
  for (const spec of specs) {
    const text = readFileSync(join('tests/e2e', spec), 'utf8');
    for (const match of text.matchAll(/\[aria-label="([^"]+)"\]/g)) {
      if (!sourceCanRender(match[1])) missing.push(`${spec}: ${match[1]}`);
    }
  }
  expect(missing, 'production specs select labels no source renders').toEqual([]);
});
