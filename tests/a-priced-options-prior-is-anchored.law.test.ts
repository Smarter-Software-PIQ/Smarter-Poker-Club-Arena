/**
 * LAW: a priced option's prior is anchored (2026-11-24).
 *
 * Three Horse builds overshot by fitting their no-record prior to the Horse population while that population was
 * itself mis-playing: holdemValueAndCallsArePriced priced the bettor from a Horse field that over-folded rivers and
 * folded 83.4% of heads-up rivers live (rolled back 2026-11-24, audit #191), and omahaFlopFacingBetEv measured its flop
 * realization from the Horses' own over-folding continues (switched off 2026-11-24, audit #192). A fitted population
 * rate is only as good as the play it was measured on.
 *
 * So the authority doc of every priced option (name containing "Priced", or a doc that declares a
 * "Fitted population table:") carries a "## Prior anchor" section with four labelled lines:
 *   - Baseline:            the equilibrium or break-even rate the no-record prior is anchored to;
 *   - Population weight:   how much weight a measured population rate may carry, and that the weight is reduced when
 *                          the population is itself on the exploitable side of that baseline;
 *   - Own record:          that an opponent's own record dominates once it has a real sample;
 *   - No unshown cards:    that no unshown hole card was read to fit it.
 * Options whose doc existed before the rule are grandfathered by name in
 * docs/horse-option-prior-anchor-grandfathered.json (closed list; printed as a warning on every run).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const AUTH_DIR = join(ROOT, 'docs/horse-option-authority.d');
const GRANDFATHER_FILE = 'docs/horse-option-prior-anchor-grandfathered.json';
const LABELS = ['Baseline', 'Population weight', 'Own record', 'No unshown cards'] as const;

/** A priced option: its name says Priced, or its doc declares a fitted population table. */
function isPricedOption(option: string, text: string): boolean {
  return (
    /Priced/.test(option) || /^[ \t]*(?:[-*][ \t]*)?(?:\*\*)?Fitted population table:/im.test(text)
  );
}

/** The labels of the Prior anchor section that are missing or empty; null when the section is absent. */
function missingAnchorLines(text: string): string[] | null {
  const m = /^## Prior anchor[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text);
  if (!m) return null;
  const body = m[1];
  return LABELS.filter((label) => {
    const line = new RegExp(
      `^[ \\t]*[-*][ \\t]*(?:\\*\\*)?${label}:(?:\\*\\*)?[ \\t]*(\\S.*)$`,
      'mi'
    ).exec(body);
    return !line;
  });
}

function optionDocs(): Record<string, string> {
  const docs: Record<string, string> = {};
  for (const f of readdirSync(AUTH_DIR)) {
    if (!/^[A-Za-z][A-Za-z0-9]*\.md$/.test(f) || f === 'README.md') continue; // suffixed files are not option docs
    docs[f.slice(0, -3)] = readFileSync(join(AUTH_DIR, f), 'utf8');
  }
  return docs;
}

describe("a priced option's prior is anchored", () => {
  const docs = optionDocs();
  const grand = JSON.parse(readFileSync(join(ROOT, GRANDFATHER_FILE), 'utf8')) as {
    schema: string;
    asOf: string;
    options: string[];
  };

  it('the grandfather list is closed, dated and names only existing priced option docs', () => {
    expect(grand.schema).toBe('horse-option-prior-anchor-grandfathered/v1');
    expect(grand.asOf).toBe('2026-11-24');
    expect([...grand.options].sort()).toEqual(grand.options);
    expect(new Set(grand.options).size).toBe(grand.options.length);
    expect(grand.options.length).toBeLessThanOrEqual(48); // the list of 2026-11-24 only shrinks
    for (const o of grand.options) {
      expect(docs[o], `${GRANDFATHER_FILE}: ${o} has no authority doc`).toBeDefined();
      expect(isPricedOption(o, docs[o]!), `${GRANDFATHER_FILE}: ${o} is not a priced option`).toBe(
        true
      );
    }
  });

  it('every priced option doc not grandfathered states its prior anchor', () => {
    const grandfathered = new Set(grand.options);
    const failures: string[] = [];
    const warned: string[] = [];
    for (const [option, text] of Object.entries(docs).sort(([a], [b]) => a.localeCompare(b))) {
      if (!isPricedOption(option, text)) continue;
      const missing = missingAnchorLines(text);
      if (grandfathered.has(option)) {
        if (missing === null || missing.length > 0) warned.push(option);
        continue;
      }
      if (missing === null) failures.push(`${option}: no "## Prior anchor" section`);
      else if (missing.length > 0)
        failures.push(`${option}: Prior anchor lacks ${missing.join(', ')}`);
    }
    if (warned.length > 0)
      console.warn(
        `[prior-anchor] ${warned.length} priced options grandfathered on ${grand.asOf} without a Prior anchor section: ${warned.join(', ')}`
      );
    expect(failures).toEqual([]);
  });

  it('a grandfathered option that gains a complete section leaves the list', () => {
    const stale = grand.options.filter((o) => {
      const missing = docs[o] ? missingAnchorLines(docs[o]!) : null;
      return missing !== null && missing.length === 0;
    });
    expect(stale, `remove from ${GRANDFATHER_FILE}`).toEqual([]);
  });

  it('reads the section and its four labelled lines', () => {
    const good = [
      '# xIsPriced',
      '',
      'status',
      '',
      '## Prior anchor',
      '',
      '- Baseline: the bettor bluffs at the pot-odds rate b/(p+2b) with no record.',
      '- Population weight: at most 0.3, halved while the field over-folds against that rate.',
      '- **Own record:** his own record dominates from 30 bets.',
      '- No unshown cards: fitted on public actions and shown hands only.',
      '',
      '## Replay',
    ].join('\n');
    expect(missingAnchorLines(good)).toEqual([]);
    expect(missingAnchorLines(good.replace('**Own record:**', 'Own:'))).toEqual(['Own record']);
    expect(missingAnchorLines(good.replace(/^- Baseline:.*$/m, '- Baseline:'))).toEqual([
      'Baseline',
    ]);
    expect(missingAnchorLines('# x\n\n## Replay\n')).toBeNull();
    expect(isPricedOption('omahaSmallBetIsPriced', '')).toBe(true);
    expect(
      isPricedOption('styleFoldBluff', 'Fitted population table: fold to river bets by size')
    ).toBe(true);
    expect(isPricedOption('styleFoldBluff', 'no table')).toBe(false);
  });
});
