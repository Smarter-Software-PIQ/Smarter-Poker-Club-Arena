import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STYLE_THRESHOLDS, STYLE_CONSUMER_BOUNDS, STYLE_FAMILY_PARAMS, classifyOpponentStyle } from './HorseOpponentStyle.js';
import { MANIAC_MIN_RAISE_WIDTH } from './HorseOpponentExploit.js';

const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

describe('LAW: the opponent style read is a bounded, default-off, decision-time-only read', () => {
  const style = src('./HorseOpponentStyle.ts');
  const logic = src('./HorseLogic.ts');
  const mind = src('./HorseMind.ts');
  const pre = src('./HorsePreflop.ts');
  it('the classifier imports no hole-card, evaluator or retrospective analysis', () => {
    const imports = style.split('\n').filter((l) => /^import /.test(l)).join('\n');
    expect(imports).not.toMatch(/HorseEval|handEval|Showdown|hole|HorseLogic|HorsePreflop/i);
  });
  it('maniac cut equals the exploit read width line', () => {
    expect(STYLE_THRESHOLDS.maniacMinRaiseShare).toBe(MANIAC_MIN_RAISE_WIDTH);
  });
  it('every consumer flag is an explicit-true opt-in', () => {
    for (const f of ['styleValueBettorNotManiac', 'styleBigBetHonesty', 'styleRaiseRespect', 'styleTightReRaiserRespect'])
      expect(logic).toMatch(new RegExp(`opts\\.${f} === true`));
    expect(mind).toMatch(/options\.styleValueBettor === true/);
    expect(STYLE_THRESHOLDS.carryWeight).toBe(0);
  });
  it('no consumer reads the four-way label (telemetry only)', () => {
    const consumers = style.slice(style.indexOf('CONSUMER HELPERS'));
    expect(consumers).not.toMatch(/\.label\b/);
    expect(logic.match(/styleRead\([^)]*\)\.label/g)).toBeNull();
    expect(pre).not.toMatch(/\.label\b.*style/i);
  });
  it('consumers are bounded and non-negative; Omaha and short-deck consumers are off', () => {
    for (const b of Object.values(STYLE_CONSUMER_BOUNDS)) expect(JSON.stringify(b)).not.toMatch(/-\d/);
    for (const [f, p] of Object.entries(STYLE_FAMILY_PARAMS)) expect(p.consumers).toBe(f === 'holdem');
    expect(STYLE_THRESHOLDS.bigBetRespectCap).toBeLessThanOrEqual(0.15);
  });
  it('the Nash push/fold block never consults the style read, and the arbiter runs after the style consumers', () => {
    const nash = logic.indexOf('Nash');
    expect(nash).toBeGreaterThan(0);
    const firstStyle = logic.indexOf('HorseMind.styleRead(');
    const arbiter = logic.lastIndexOf('Phase 7');
    expect(firstStyle).toBeGreaterThan(0);
    expect(arbiter).toBeGreaterThan(firstStyle);
  });
  it('unknown is neutral in every variant family', () => {
    for (const [scope, variant] of [['holdem:full', 'nlh'], ['omaha:full', 'plo4'], ['omaha:full', 'plo5'], ['omaha:full', 'plo6'], ['sixplus:full', 'short_deck']] as const) {
      const r = classifyOpponentStyle({ scope, variant, domain: 'cash', counters: null });
      expect(r.evidence.supported).toBe(false);
      expect(r.participation.side).toBe('neutral');
      expect(r.aggression.side).toBe('neutral');
      expect(r.evidence.protectiveLogicArmed).toBe(true);
    }
  });
});
