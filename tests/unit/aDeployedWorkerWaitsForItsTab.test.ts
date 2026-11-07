import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const root = (p: string) => path.resolve(__dirname, '../..', p);
const sw = readFileSync(root('public/sw-bus.js'), 'utf8');
const gate = readFileSync(root('src/hooks/useShellUpdateGate.ts'), 'utf8');

function handler(event: string): string {
  const start = sw.indexOf(`sw.addEventListener('${event}'`);
  expect(start, `sw-bus.js has no ${event} handler`).toBeGreaterThan(-1);
  const next = sw.indexOf('sw.addEventListener(', start + 1);
  return sw.slice(start, next === -1 ? undefined : next);
}

describe('the worker never activates itself under an open tab', () => {
  it('install precaches and does not skipWaiting', () => {
    expect(handler('install')).not.toMatch(/skipWaiting\s*\(/);
  });

  it('skipWaiting is reachable only from a SKIP_WAITING message', () => {
    const calls = sw
      .split('\n')
      .filter((line) => /skipWaiting\s*\(/.test(line) && !/^\s*(\/\/|\*)/.test(line));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/SKIP_WAITING/);
  });

  it('the open app never activates a waiting worker or reloads itself', () => {
    expect(gate).not.toContain('SKIP_WAITING');
    expect(gate).not.toMatch(/location\.reload\s*\(/);
  });
});
