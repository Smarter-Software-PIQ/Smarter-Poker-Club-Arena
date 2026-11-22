/**
 * LAW: THE LIFETIME READ NEVER LOWERS A RAISE OR A BET BY ITSELF (2026-11-21, lane OPPONENT-HUD; lead order after the
 * symmetric re-score, which found raise->call -113.2 +- 48.6 and bet->check -20.0 +- 16.1 bb for persons).
 * With omahaOpponentLifetimeHud on, the four sites where the lifetime read turned raises into calls and bets into
 * checks on the Nov 20 journals (the flop/turn V53 pressure raise, the preflop opener / re-raiser exploit, the
 * flop/turn bluff baseline's station read, the river bluff baseline's station / fold reads) read the opponent as
 * without it too; where the lifetime read would lower the action by itself, the lowering stands only when a priced
 * comparison on his lifetime response says so (raise vs call: omahaHudPricedRaiseOverCall; bet vs check:
 * omahaHudPricedBetOverCheck), and where that cannot be priced the lifetime read is not consumed at the site. With
 * the option off no site changes (hudReadActive is false and no shadow read is taken).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { emptyHudProfile } from './opponentHud/OpponentHudProfile.js';
import { buildHudPacket, clearDecisionHud, installDecisionHud } from './opponentHud/OpponentHud.js';
import {
  omahaHudPricedBetOverCheck,
  omahaHudPricedRaiseOverCall,
} from './HorseOmahaPricedWiring.js';

const OPP = '50000000-0000-4000-8000-0000000000b1';
const T = 1_800_000_000_000;
const SRC = readFileSync(resolve(__dirname, 'HorseLogic.ts'), 'utf8');

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
  clearDecisionHud();
});

function tight() {
  const p = emptyHudProfile(OPP, 'plo5');
  p.hands = 300;
  p.wm = T;
  p.recAt = T;
  for (const [k, o, h] of [
    ['pf.vpip', 300, 45],
    ['pf.pfr', 300, 12],
    ['pf.open', 150, 8],
    ['pf.3bet', 100, 2],
    ['f.betCk', 80, 10],
    ['f.fBet', 60, 40],
    ['f.fRaise', 10, 6],
  ] as const) {
    p.life[k] = [o, h];
    p.rec[k] = [o, h];
  }
  return p;
}

describe('the lifetime read never lowers a raise or a bet by itself', () => {
  it('option off: hudReadActive is false, the shadow read is the read', () => {
    HorseMind.setDecisionScope('omaha:full', 'plo5', 'cash');
    HorseMind.setDecisionReadOptions({});
    expect(HorseMind.hudReadActive()).toBe(false);
    expect(HorseMind.opponentReadWithoutHud(OPP)).toEqual(HorseMind.opponentRead(OPP));
  });

  it('option on: the shadow read is the decayed / presumed read, with receipts muted; PLO6 is never active', () => {
    installDecisionHud(buildHudPacket('plo5', [tight()], {}, T, 'flop'));
    HorseMind.setDecisionScope('omaha:full', 'plo5', 'cash');
    HorseMind.setDecisionReadOptions({ opponentLifetimeHud: true });
    expect(HorseMind.hudReadActive()).toBe(true);
    enableBrainTelemetry();
    drainFires();
    const shadow = HorseMind.opponentReadWithoutHud(OPP);
    expect(drainFires()).toEqual([]); // no receipt from the shadow read: the presumption receipt stays gone
    expect(shadow?.presumed).toBe(true);
    expect(HorseMind.opponentRead(OPP)?.presumed === true).toBe(false);
    HorseMind.setDecisionScope('omaha:full', 'plo6', 'cash');
    expect(HorseMind.hudReadActive()).toBe(false);
  });

  it('the four sites are gated on hudReadActive and price before lowering (source law)', () => {
    const sites = SRC.split('OPPONENT HUD NO-LOWERING').length - 1;
    expect(sites).toBeGreaterThanOrEqual(4);
    // every shadow read sits behind hudReadActive(); every priced helper call is in a no-lowering block
    const shadows = [...SRC.matchAll(/opponentReadWithoutHud\(/g)].map((m) => m.index!);
    expect(shadows.length).toBe(4);
    for (const i of shadows)
      expect(SRC.slice(Math.max(0, i - 1500), i)).toContain('hudReadActive()');
    // the table's bluff scale as without the lifetime read: taken only with the read on
    const tables = [...SRC.matchAll(/HorseMind\.withoutHud\(/g)].map((m) => m.index!);
    expect(tables.length).toBe(2); // the table bluff scale and the preflop maniac-pressure widths
    for (const i of tables) expect(SRC.slice(Math.max(0, i - 200), i)).toContain('hudReadActive()');
    expect(SRC.match(/omahaHudPricedRaiseOverCall\(player/g)?.length).toBe(1);
    expect(SRC.match(/omahaHudPricedBetOverCheck\(player/g)?.length).toBe(2);
  });

  it('priced helpers: null where no priced comparison exists (the read is then not consumed)', () => {
    const gs: any = {
      gameVariant: 'plo5',
      stage: 'preflop',
      pot: 10,
      currentBet: 4,
      toCall: 4,
      communityCards: [],
      players: [
        { seat: 1, user_id: 'h', stack: 200, bet: 0, cards: ['As', 'Ks', 'Qd', 'Jd', '9c'] },
        { seat: 2, user_id: OPP, stack: 200, bet: 4 },
      ],
      dealerSeat: 2,
    };
    const hero = gs.players[0];
    expect(omahaHudPricedRaiseOverCall(hero, gs, {} as any)).toBeNull(); // preflop: no sampled spot
    expect(
      omahaHudPricedBetOverCheck(hero, { ...gs, stage: 'flop', toCall: 0 }, {} as any)
    ).toBeNull(); // flop bet: unpriced
  });
});
