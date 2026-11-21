/**
 * LAW: THE LIFETIME-HUD CONSUMER IS THE ONLY DECISION READER, AND IT IS DEFAULT OFF (2026-11-21, lane OPPONENT-HUD-9;
 * lead rulings 12:58 PM Chicago, item 4). Replaces TheHudProviderChangesNoDecision.law (provider-only branch): the
 * consumer now ships on the provider, so the provider may be read by a decision, but only by the consumer's named
 * sources and only under its OWN option omahaOpponentLifetimeHudDecides (default OFF) together with the store option
 * omahaOpponentLifetimeHud: the store option alone arms, loads and attaches and decides nothing, so the store can be
 * switched on and backfilled before any decision reads it. With the consumer off an opponent read is the same with a
 * lifetime packet installed. A new reader must name itself here and carry its own option and criteria.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { HorseMind } from './HorseMind.js';
import {
  OPTION_SWITCH_RELEASE_DEFAULT_OFF,
  OPTION_SWITCH_RELEASE_DEFAULT_ON,
} from './HorseOptionSwitch.js';
import { emptyHudProfile } from './opponentHud/OpponentHudProfile.js';
import { buildHudPacket, clearDecisionHud, installDecisionHud } from './opponentHud/OpponentHud.js';

const ENGINE = __dirname;
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}
const files = walk(ENGINE).map((p) => ({ p, rel: relative(ENGINE, p).split(sep).join('/') }));
/** the worker install and request type (provider) plus the consumer's own decision sources: nothing else */
const READERS = [
  'HorseLogic.ts',
  'HorseMind.ts',
  'HorseOmahaPreflopHudPriced.ts',
  'HorseOmahaPricedWiring.ts',
  'horseDecision/protocol.ts',
  'horseDecision/workerRuntime.ts',
].sort();

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
  clearDecisionHud();
});

describe('the lifetime-HUD consumer is the only decision reader, and it is default OFF', () => {
  it('only the consumer and the worker install import the opponent HUD modules', () => {
    const importers = files
      .filter((f) => !f.rel.startsWith('opponentHud/'))
      .filter((f) => /from\s+['"][^'"]*opponentHud\//.test(readFileSync(f.p, 'utf8')))
      .map((f) => f.rel)
      .sort();
    for (const rel of importers) expect(READERS).toContain(rel);
    expect(importers).toContain('HorseMind.ts');
  });

  it('both options ship OFF', () => {
    for (const name of ['omahaOpponentLifetimeHud', 'omahaOpponentLifetimeHudDecides']) {
      expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain(name);
      expect(OPTION_SWITCH_RELEASE_DEFAULT_ON).not.toContain(name);
    }
  });

  it('the decision read option is produced at one place and needs the consumer option AND the store option', () => {
    const reads: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f.p, 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (/opts(\?)?\.omahaOpponentLifetimeHudDecides\b/.test(l)) reads.push(`${f.rel}:${i}`);
      });
    }
    expect(reads.length).toBe(1);
    expect(reads[0]).toMatch(/^HorseLogic\.ts:/);
    const src = readFileSync(join(ENGINE, 'HorseLogic.ts'), 'utf8');
    expect(src).toMatch(
      /\.\.\.\(opts\.omahaOpponentLifetimeHud === true &&\s*opts\.omahaOpponentLifetimeHudDecides === true &&/
    );
    expect(src.split('{ opponentLifetimeHud: true }').length - 1).toBe(1);
  });

  it('with the option off an opponent read is identical with a lifetime packet installed', () => {
    const OPP = '50000000-0000-4000-8000-0000000000c1';
    HorseMind.setDecisionScope('omaha:full', 'plo5', 'cash');
    const before = HorseMind.opponentRead(OPP);
    const p = emptyHudProfile(OPP, 'plo5');
    p.hands = 300;
    p.life['pf.vpip'] = [300, 40];
    p.life['pf.pfr'] = [300, 10];
    installDecisionHud(buildHudPacket('plo5', [p], {}, 1_800_000_000_000, 'flop'));
    expect(HorseMind.opponentRead(OPP)).toEqual(before);
  });
});
