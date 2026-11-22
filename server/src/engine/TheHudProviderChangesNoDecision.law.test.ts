/**
 * LAW: THE HUD PROVIDER CHANGES NO DECISION (2026-11-21, lane OPPONENT-HUD; lead order: split the provider from its
 * decision consumers so it can ride a cutover dark). On this branch omahaOpponentLifetimeHud arms the profile store,
 * attaches each opponent's lifetime profile to the decision request and installs it in the worker for the accessor,
 * and NOTHING in the decision path reads it: no engine source but the worker install and the request type imports
 * the opponentHud modules, no source reads the option out of the decision options, and an opponent read is the same
 * with a packet installed. A consumer added later must name itself here (and carry its own option and criteria).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { HorseMind } from './HorseMind.js';
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
/** the only engine sources allowed to import the opponent HUD modules on the provider branch */
const ALLOWED = new Set(['horseDecision/workerRuntime.ts', 'horseDecision/protocol.ts']);

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
  clearDecisionHud();
});

describe('the HUD provider changes no decision', () => {
  it('no decision source imports the opponent HUD modules (worker install and request type only)', () => {
    const offenders = files
      .filter((f) => !f.rel.startsWith('opponentHud/') && !ALLOWED.has(f.rel))
      .filter((f) => /from\s+['"][^'"]*opponentHud\//.test(readFileSync(f.p, 'utf8')))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
    expect(files.some((f) => f.rel === 'HorseLogic.ts')).toBe(true);
  });

  it('the decision options read the option for its receipt only', () => {
    const reads: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f.p, 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (/opts(\?)?\.omahaOpponentLifetimeHud\b/.test(l))
          reads.push(`${f.rel}: ${l.trim()} ${lines[i + 1]?.trim() ?? ''}`);
      });
    }
    expect(reads.length).toBe(1);
    expect(reads[0]).toMatch(
      /^HorseLogic\.ts: .*telemetryOn\(opts\)\) noteFire\('opponent_hud_provider_armed_seen'\);$/
    );
  });

  it('an opponent read is identical with a lifetime packet installed', () => {
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
