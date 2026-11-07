/**
 * THE CARD-ART SPEC WAITS WITH ITS OWN BUDGET AND NAMES WHAT WAS PENDING
 * (2026-11-07). tests/e2e/hero-cards-no-glitch.spec.ts waited a fixed number
 * of milliseconds for `[data-ready]="true"`, failed once today on a cold
 * runner, passed on the rerun, and its failure said only that the attribute
 * was still "false". data-ready is useTableArt().reveal, so the pending half
 * (deck faces still decoding, felt not decoded, cover not expired) is
 * knowable. These pins keep the wait bounded by the test's configured timeout
 * rather than a guessed constant, and keep the failure message carrying the
 * fixture's readiness snapshot. The assertion itself (data-ready must become
 * "true") is unchanged and still present.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const spec = readFileSync(join(root, 'tests/e2e/hero-cards-no-glitch.spec.ts'), 'utf8');
const fixture = readFileSync(join(root, 'tests/e2e/fixtures/cardArtReady.tsx'), 'utf8');

describe('hero-cards-no-glitch waits for the reveal with the test budget', () => {
  it('has no fixed-millisecond wait for data-ready="true" left', () => {
    expect(spec).not.toMatch(/toHaveAttribute\('data-ready', 'true', \{\s*timeout: \d/);
    expect(spec).not.toMatch(/toHaveAttribute\('data-ready', 'true'\)/);
  });

  it('derives the wait from the configured test timeout, less a margin', () => {
    const helper = spec.slice(
      spec.indexOf('async function expectTableRevealed('),
      spec.indexOf("test.describe('decoded card artwork'")
    );
    expect(helper).toContain('test.info().timeout');
    expect(helper).toMatch(/const margin = \d+_?\d*;/);
    expect(helper).toContain('configured - (Date.now() - startedAt) - margin');
  });

  it('still asserts that data-ready becomes "true", and says what was pending when it does not', () => {
    const helper = spec.slice(
      spec.indexOf('async function expectTableRevealed('),
      spec.indexOf("test.describe('decoded card artwork'")
    );
    expect(helper).toMatch(/\.toBe\('true'\)/);
    expect(helper).toContain('cardArtReadiness');
    expect(helper).toContain('still pending:');
  });

  it('is used at every reveal the spec waits for, and the "false" checks are untouched', () => {
    expect(spec.match(/await expectTableRevealed\(page, startedAt, '/g)).toHaveLength(3);
    expect(spec.match(/toHaveAttribute\('data-ready', 'false'\)/g)).toHaveLength(2);
  });

  it('the fixture reports the readiness state from the caches the hooks read', () => {
    expect(fixture).toContain('cardArtReadiness: () =>');
    for (const field of ['reveal', 'artReady', 'deckReady', 'deckDecoded', 'deckTotal', 'deckPending', 'feltDecoded'])
      expect(fixture).toContain(`${field}:`);
    expect(fixture).toContain("from '../../../src/utils/deckWarmer'");
    expect(fixture).toMatch(/isTableImageDecoded/);
  });
});
