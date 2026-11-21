/**
 * LAW: THE LIFETIME-HUD CONSUMER IS THE ONLY DECISION READER, AND IT IS DEFAULT OFF (2026-11-21, lane OPPONENT-HUD-9;
 * lead rulings 12:58 PM Chicago, item 4). Replaces TheHudProviderChangesNoDecision.law (provider-only branch): the
 * consumer now ships on the provider, so the provider may be read by a decision, but only by the consumer's named
 * sources, only under omahaOpponentLifetimeHud, and that option ships OFF. With it off an opponent read is the same
 * with a lifetime packet installed. A new reader must name itself here and carry its own option and criteria.
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

  it('omahaOpponentLifetimeHud ships OFF', () => {
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain('omahaOpponentLifetimeHud');
    expect(OPTION_SWITCH_RELEASE_DEFAULT_ON).not.toContain('omahaOpponentLifetimeHud');
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
