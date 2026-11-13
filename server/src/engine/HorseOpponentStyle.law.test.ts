import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STYLE_THRESHOLDS, STYLE_CONSUMER_BOUNDS, STYLE_FAMILY_PARAMS, classifyOpponentStyle } from './HorseOpponentStyle.js';
import { MANIAC_MIN_RAISE_WIDTH } from './HorseOpponentExploit.js';
import { VILLAINS, decide, install, preflopJam, type Mode } from './HorseOpponentStyle.contexts.test-support.js';
import { FX, ON, installFixture, spotOf } from './HorseOpponentStyle.fixtures.test-support.js';

const ALL_ON = { ...ON, styleTightReRaiserRespect: true, styleValueExtraction: true };

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
    for (const f of ['styleValueBettorNotManiac', 'styleBigBetHonesty', 'styleRaiseRespect', 'styleTightReRaiserRespect', 'styleValueExtraction', 'styleFoldBluff', 'styleFoldRatePreRepair'])
      expect(logic).toMatch(new RegExp(`opts\\.${f} === true`));
    expect(mind).toMatch(/options\.styleValueBettor === true/);
    expect(mind).toMatch(/options\.styleFoldRatePreRepair === true/);
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
  it('push/fold: a 12bb jam decision is identical with every option on, against every villain, cash, tournament and bubble', () => {
    for (const mode of ['cash', 'tournament', 'bubble'] as Mode[])
      for (const [vn, v] of Object.entries(VILLAINS)) {
        install(v, mode);
        const off = decide(preflopJam(mode));
        install(v, mode);
        const on = decide(preflopJam(mode), ALL_ON);
        expect(on.digest, `${mode}/${vn}`).toBe(off.digest);
      }
  });
  it('through decide(): the tournament utility arbiter runs after the style consumer has shaped the decision', () => {
    // BrainTelemetry keeps first-fire order: in the tournament fixture F026 the bluff-catch cap fires, and only then
    // does the tournament utility node of the decision graph enter (it evaluates the decision the cap shaped).
    const f = FX.find((x) => x.id === 'F026')!;
    installFixture(f);
    const order = Object.keys(decide(spotOf(f), ON).fires);
    const cap = order.indexOf('style_bluff_catch_cap_seen');
    const arbiter = order.indexOf('phase15_node_tournament_utility_entered');
    expect(cap).toBeGreaterThanOrEqual(0);
    expect(arbiter).toBeGreaterThan(cap);
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
