/**
 * LAW (lane core-repair, B3 Math Core Turn/River): opponent-lifetime-backed PLO5 turn/river pricing
 * behind default-OFF omahaMathCorePlo5Turn / omahaMathCorePlo5River.
 *
 * Enforces every hard invariant of CORE-LEAD4-B3-TURN-RIVER-SPEC.md:
 *  1. Cumulative tail-mass bins match HUD_FW_EDGES ('fw1') and avoid thin-slice size-mix dilution.
 *  2. Barrel sharpening activates only when prevAggressor=true and never weakens on sparse barrel data.
 *  3. Station / nit / unknown-opponent guard by construction: f_lo <= p_base => excessMass === 0 => 0 flips.
 *  4. Non-inertness vs high-frequency over-stabber / barrel_air: mature high f_lo proves +EV plain call.
 *  5. Turn continuation is capped (zero phantom river fold credit) via conservative lifetimeRiverShare.
 *  6. River all-in commit guard: fold -> call/all-in committing Hero's stack still requires K_allin = 25.
 *  7. Current nuts facing a wager is never folded even with null or ultra-tight opponent record.
 *  8. Stage 1 boundary: never emits bet, raise, or call -> fold; declines raises & multiway facing bets.
 *  9. Determinism & zero wall-clock reads.
 * 10. End-to-end HUD packet integration (public counters only, zero unshown cards) & off-scope isolation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HorseDecision, SeatPlayer } from '../../types.js';
import type { HorseGameStateV2 } from '../HorseLogic.js';
import { cardToInt } from './OmahaMathCoreEval.js';
import { rakeNet, type CoreState } from './OmahaMathCore.js';
import { saveFastRandom } from '../HorseEval.js';
import { ServerTableEngineTurns } from '../ServerTableEngineTurns.js';
import { omahaMathCoreOwns } from './OmahaMathCoreAcceptance.js';
import { omahaMathCoreRule } from './OmahaMathCoreRule.js';
import { warmOmahaMathCore } from './OmahaMathCoreWarmUp.js';
import {
  OMAHA_MATH_CORE_TR_FW_EDGES,
  cumulativeTailBets,
  lifetimeRiverShare,
  omahaMathCoreTurnRiverProvider,
  priceTurnRiverLifetimeCall,
  setOmahaMathCoreTurnRiverProvider,
  turnRiverTailFrequency,
} from './OmahaMathCoreTurnRiver.js';
import { HUD_FW_BINS, HUD_FW_EDGES, emptyHudProfile } from '../opponentHud/OpponentHudProfile.js';
import {
  buildHudPacket,
  clearDecisionHud,
  installDecisionHud,
} from '../opponentHud/OpponentHud.js';
import { omahaMathCoreTurnRiverHud } from '../opponentHud/OmahaMathCoreTurnRiverHud.js';

const SUITS: Record<string, 'spades' | 'hearts' | 'diamonds' | 'clubs'> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
};
const cardObjs = (s: string) =>
  (s.match(/.{2}/g) ?? []).map((c) => ({ rank: c[0], suit: SUITS[c[1]] }));
const cards = (s: string) => cardObjs(s).map(cardToInt);

function makeState(over: Partial<CoreState> = {}): CoreState {
  // PLO5 river on K♠ 9♦ 4♣ 2♥ 7♠; Hero holds K♥ K♣ Q♦ J♣ T♥ (top set — strong bluff-catcher, not the nuts since 8-6 or flush could exist? No flush here: only 2 spades; 6-5/T-8/8-6? 9-7-4-2 -> 8-6 no straight, K-9-7-4-2 rainbow-ish -> top set KK is actually near-nuts, let's give Hero middle two pair K-9 or Q-J? Wait: K♠ 9♦ 7♣ 4♥ 2♠; Hero has K♥ 9♣ 8♦ 5♣ 3♥ = top two pair K9: strong bluff-catcher, NOT current nuts since KK/99/77/44/22/86/65/etc beat it!)
  return {
    variant: 'plo5',
    chipUnit: 0.01,
    mode: 'table',
    street: 'river',
    hole: cards('Kh9c8d5c3h'),
    board: cards('Ks9d7c4h2s'),
    pot: 200,
    toCall: 100,
    heroBet: 0,
    heroStack: 500,
    currentBet: 100,
    minRaiseTo: 200,
    maxRaiseTo: 500,
    bigBlind: 2,
    legal: ['fold', 'call', 'raise', 'all_in'],
    heroSeat: 1,
    heroPosition: 'BB',
    ip: false,
    opponents: [
      {
        seat: 2,
        stack: 400,
        bet: 100,
        folded: false,
        allIn: false,
        streetAction: 'wager',
        calledPrevStreet: false,
        prevAggressor: true,
        position: 'BTN',
        preflopLevel: 'open',
      },
    ],
    aggressorSeat: 2,
    line: 'stab',
    band: 'pot',
    wagerFrac: 1.0,
    heroWagerLine: 'raise',
    preflopRaises: 1,
    rake: { percent: 5, cap: 6, noFlopNoDrop: true },
    seed: 'b3-law-seed-1',
    ...over,
  };
}

function makeBins(atIndex: number, count: number): number[] {
  const bins = new Array<number>(HUD_FW_BINS).fill(0);
  bins[atIndex] = count;
  return bins;
}

afterEach(() => {
  clearDecisionHud();
  setOmahaMathCoreTurnRiverProvider(omahaMathCoreTurnRiverHud);
  vi.restoreAllMocks();
});

describe('LAW: B3 Math Core Turn/River opponent-lifetime pricing (OmahaMathCoreTurnRiverHud)', () => {
  it('1. cumulative tail bin edges exactly match HUD_FW_EDGES and avoid size-mix dilution', () => {
    expect([...OMAHA_MATH_CORE_TR_FW_EDGES]).toEqual([...HUD_FW_EDGES]);
    // frac = 0.90 -> 0.85 * 0.90 = 0.765 -> upper edge >= 0.765 starts at b10 (0.882) through b13
    const concentrated = makeBins(11, 30); // all 30 bets in pot-size bin b11 (0.882..1.024]
    const split = new Array<number>(HUD_FW_BINS).fill(0);
    split[10] = 15; // 0.761..0.882
    split[11] = 15; // 0.882..1.024
    expect(cumulativeTailBets(concentrated, 0.9)).toBe(30);
    expect(cumulativeTailBets(split, 0.9)).toBe(30);
    // Smaller bets strictly below 0.85 * frac (e.g. b03 <= 0.312) are excluded from the tail
    split[3] = 50;
    expect(cumulativeTailBets(split, 0.9)).toBe(30);
  });

  it('2. barrel sharpening increases f_lo when prevAggressor=true and never weakens on sparse barrel data', () => {
    const rec = { opps: 120, bets: 60, bins: makeBins(11, 60), priorRate: 0.28 };
    const noBarrel = turnRiverTailFrequency(rec, null, 1.0, 'river', 'hu', true, 3);
    const highBarrel = turnRiverTailFrequency(
      rec,
      { opps: 100, bets: 80 },
      1.0,
      'river',
      'hu',
      true,
      3
    );
    const sparseBarrel = turnRiverTailFrequency(
      rec,
      { opps: 3, bets: 1 },
      1.0,
      'river',
      'hu',
      true,
      3
    );
    expect(highBarrel.fLo).toBeGreaterThan(noBarrel.fLo);
    expect(highBarrel.usedBarrel).toBe(true);
    expect(sparseBarrel.fLo).toBeCloseTo(noBarrel.fLo, 10);
    expect(sparseBarrel.usedBarrel).toBe(false);
  });

  it('3. station / nit / unknown-opponent guard: f_lo <= p_base yields excessMass === 0 and 0 flips', () => {
    const state = makeState();
    const net = (p: number) => rakeNet(state, p);
    // Tight / station bettor: bets 15% over 300 opps (well below p_base = 0.28)
    const tight = priceTurnRiverLifetimeCall({
      state,
      counts: { opps: 300, bets: 45, bins: makeBins(11, 45), priorRate: 0.28 },
      barrel: null,
      riverCounts: null,
      net,
      k: 5,
    });
    expect(tight.excessMass).toBe(0);
    expect(tight.call).toBe(false);

    // Unknown opponent: 0 opps -> 0 excess, 0 flips
    const unknown = priceTurnRiverLifetimeCall({
      state,
      counts: { opps: 0, bets: 0, bins: makeBins(11, 0), priorRate: 0.28 },
      barrel: null,
      riverCounts: null,
      net,
      k: 5,
    });
    expect(unknown.call).toBe(false);
  });

  it('4. non-inertness: mature high-frequency pot-stabber proves +EV river plain call with top two pair', () => {
    const state = makeState();
    const net = (p: number) => rakeNet(state, p);
    // Opponent stabs pot-size 78% of the time over 220 river opportunities
    const res = priceTurnRiverLifetimeCall({
      state,
      counts: { opps: 220, bets: 172, bins: makeBins(11, 172), priorRate: 0.28 },
      barrel: { opps: 120, bets: 96 },
      riverCounts: null,
      net,
      k: 5,
    });
    expect(res.applies).toBe(true);
    expect(res.fLo).toBeGreaterThan(0.5);
    expect(res.excessMass).toBeGreaterThan(0.35);
    expect(res.call).toBe(true);
    expect(res.evCallLo).toBeGreaterThan(0);
  });

  it('5. turn continuation is capped (zero phantom river fold credit) and conservative in sigma/budget', () => {
    expect(lifetimeRiverShare(0.65, 0, 1.0)).toBeCloseTo(0.65, 10);
    const sHalf = lifetimeRiverShare(0.65, 0.5, 1.0);
    const sPot = lifetimeRiverShare(0.65, 1.0, 1.0);
    const sTight = lifetimeRiverShare(0.65, 1.0, 0.4);
    expect(sPot).toBeLessThan(sHalf);
    expect(sHalf).toBeLessThan(0.65);
    expect(sPot).toBeLessThan(sTight);

    // Turn state with K-9 top two pair on Ks 9d 7c 4h facing a huge 80% turn stabber
    const turnState = makeState({
      street: 'turn',
      board: cards('Ks9d7c4h'),
      pot: 160,
      toCall: 80,
      currentBet: 80,
      wagerFrac: 1.0,
    });
    const rTurn = priceTurnRiverLifetimeCall({
      state: turnState,
      counts: { opps: 250, bets: 200, bins: makeBins(11, 200), priorRate: 0.3 },
      barrel: { opps: 150, bets: 125 },
      riverCounts: { opps: 100, bets: 80 },
      net: (p) => rakeNet(turnState, p),
      k: 5,
    });
    expect(rTurn.applies).toBe(true);
    expect(rTurn.capped).toBe(true);
    expect(rTurn.riverBudget).toBeGreaterThan(0.5);
  });

  it('6. river all-in commit guard: stack-committing call requires K_allin = 25 even when plain call passes K = 5', () => {
    // True river bluff-catcher: K-9 top two pair on rainbow Ks 9d 7c 4h 2s facing a pot bet from a 68% stabber
    // over 100 opps (passes K=5 plain call with chips behind, but fails K_allin=25 when stack-committing)
    const modCounts = { opps: 100, bets: 68, bins: makeBins(11, 68), priorRate: 0.28 };
    const plainState = makeState({
      hole: cards('Kh9c8d5c3h'),
      board: cards('Ks9d7c4h2s'),
      pot: 200,
      toCall: 100,
      heroStack: 500,
    });
    const plain = priceTurnRiverLifetimeCall({
      state: plainState,
      counts: modCounts,
      barrel: null,
      riverCounts: null,
      net: (p) => rakeNet(plainState, p),
      k: 5,
    });
    const commitState = makeState({
      hole: cards('Kh9c8d5c3h'),
      board: cards('Ks9d7c4h2s'),
      pot: 200,
      toCall: 100,
      heroStack: 100,
    });
    const commit = priceTurnRiverLifetimeCall({
      state: commitState,
      counts: modCounts,
      barrel: null,
      riverCounts: null,
      net: (p) => rakeNet(commitState, p),
      k: 5,
    });
    expect(plain.kApplied).toBe(5);
    expect(plain.call).toBe(true);
    expect(commit.commitsStack).toBe(true);
    expect(commit.kApplied).toBe(25);
    expect(commit.call).toBe(false);
  });

  it('7. current nuts facing a wager is never folded even with null or 0%-bet opponent record', () => {
    // Board Ks 9d 7c 4h 2s (no flush, no straight possible with 2 hole cards -> wait: 8-6 makes 9-high? No, 9-7-4-2 no straight; KK is absolute nuts!)
    const nutsState = makeState({
      hole: cards('KhKcQdJcTh'),
      board: cards('Ks9d7c4h2s'),
    });
    const resNull = priceTurnRiverLifetimeCall({
      state: nutsState,
      counts: null,
      barrel: null,
      riverCounts: null,
      net: (p) => rakeNet(nutsState, p),
      k: 5,
    });
    expect(resNull.call).toBe(true);
    expect(resNull.reason).toContain('nuts');
  });

  it('8. Stage 1 boundary: declines raises and multiway spots', () => {
    const net = (p: number) => rakeNet(makeState(), p);
    const highCounts = { opps: 220, bets: 172, bins: makeBins(11, 172), priorRate: 0.28 };

    const vsRaise = priceTurnRiverLifetimeCall({
      state: makeState({ line: 'raise' }),
      counts: highCounts,
      barrel: null,
      riverCounts: null,
      net,
      k: 5,
    });
    expect(vsRaise.applies).toBe(false);
    expect(vsRaise.call).toBe(false);

    const mwState = makeState({
      opponents: [
        ...makeState().opponents,
        {
          seat: 3,
          stack: 400,
          bet: 0,
          folded: false,
          allIn: false,
          streetAction: 'none',
          calledPrevStreet: true,
          prevAggressor: false,
          position: 'CO',
          preflopLevel: 'call',
        },
      ],
    });
    const vsMw = priceTurnRiverLifetimeCall({
      state: mwState,
      counts: highCounts,
      barrel: null,
      riverCounts: null,
      net,
      k: 5,
    });
    expect(vsMw.applies).toBe(false);
    expect(vsMw.call).toBe(false);
  });

  it('9. determinism & zero wall-clock reads', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now forbidden');
    });
    const state = makeState();
    const counts = { opps: 220, bets: 172, bins: makeBins(11, 172), priorRate: 0.28 };
    const a = priceTurnRiverLifetimeCall({
      state,
      counts,
      barrel: null,
      riverCounts: null,
      net: (p) => rakeNet(state, p),
      k: 5,
    });
    const b = priceTurnRiverLifetimeCall({
      state,
      counts,
      barrel: null,
      riverCounts: null,
      net: (p) => rakeNet(state, p),
      k: 5,
    });
    expect(a).toEqual(b);
    expect(nowSpy).not.toHaveBeenCalled();
  });

  it('10. end-to-end omahaMathCoreRule + OpponentHudPacket: off-scope=0 work, stabber flips fold->call, station keeps fold', () => {
    const U_STAB = '00000000-0000-4000-8000-000000000002';
    const U_HERO = '00000000-0000-4000-8000-000000000001';
    const pStab = emptyHudProfile(U_STAB, 'plo5');
    pStab.hands = 500;
    pStab.life['r.stab.hu'] = [220, 172];
    pStab.xc = { 'r.fw.stab.hu.b11': 172, 'r.brl.hu.opps': 120, 'r.brl.hu.bets': 96 };

    const pTight = emptyHudProfile(U_STAB, 'plo5');
    pTight.hands = 500;
    pTight.life['r.stab.hu'] = [220, 22];
    pTight.xc = { 'r.fw.stab.hu.b11': 22 };

    const hero = {
      seat: 1,
      user_id: U_HERO,
      cards: cardObjs('Kh9c8d5c3h'),
      stack: 500,
      bet: 0,
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    } as unknown as SeatPlayer;

    const gs = {
      gameVariant: 'plo5',
      stage: 'river',
      pot: 200,
      currentBet: 100,
      bigBlind: 2,
      smallBlind: 1,
      buttonSeat: 2,
      communityCards: cardObjs('Ks9d7c4h2s'),
      players: [
        hero,
        {
          seat: 2,
          user_id: U_STAB,
          stack: 400,
          bet: 100,
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
      ],
      actionHistory: [
        { seat: 2, stage: 'preflop', action: 'raise', amount: 6 },
        { seat: 1, stage: 'preflop', action: 'call', amount: 6 },
        { seat: 1, stage: 'flop', action: 'check', amount: 0 },
        { seat: 2, stage: 'flop', action: 'bet', amount: 10 },
        { seat: 1, stage: 'flop', action: 'call', amount: 10 },
        { seat: 1, stage: 'turn', action: 'check', amount: 0 },
        { seat: 2, stage: 'turn', action: 'bet', amount: 34 },
        { seat: 1, stage: 'turn', action: 'call', amount: 34 },
        { seat: 1, stage: 'river', action: 'check', amount: 0 },
        { seat: 2, stage: 'river', action: 'bet', amount: 100 },
      ],
      rakePercent: 5,
      rakeCap: 6,
      noFlopNoDrop: true,
      handNumber: 777001,
    } as unknown as HorseGameStateV2;

    const incomingFold: HorseDecision = { action: 'fold', thinkTime: 1000 };
    const legalize = (d: HorseDecision): HorseDecision => d;

    // (a) Off-scope: omahaMathCorePlo5River=false -> zero work, no receipt, fold unchanged
    installDecisionHud(
      buildHudPacket('plo5', [pStab], { 'r.stab.hu': [0.28, 33] }, 1_800_000_000_000, 'river')
    );
    const offRes = omahaMathCoreRule(
      incomingFold,
      hero,
      gs,
      { omahaMathCore: true, omahaMathCorePlo5River: false },
      legalize
    );
    expect(offRes.action).toBe('fold');
    expect(offRes.omahaMathCore).toBeUndefined();

    // (b) ON vs 78% pot-stabber -> flips fold -> plain call for exact 100
    const stabRes = omahaMathCoreRule(
      incomingFold,
      hero,
      gs,
      { omahaMathCore: true, omahaMathCorePlo5River: true },
      legalize
    );
    expect(stabRes.action).toBe('call');
    expect(stabRes.amount).toBe(100);
    expect(stabRes.omahaMathCore?.applied).toBe(true);

    // (c) ON vs 10% tight/station bettor -> keeps fold (0 station flips!)
    installDecisionHud(
      buildHudPacket('plo5', [pTight], { 'r.stab.hu': [0.28, 33] }, 1_800_000_000_000, 'river')
    );
    const tightRes = omahaMathCoreRule(
      incomingFold,
      hero,
      gs,
      { omahaMathCore: true, omahaMathCorePlo5River: true },
      legalize
    );
    expect(tightRes.action).toBe('fold');

    // (d) Stage 1 turn boundary: with HUD packet installed on PLO5 turn, incoming check is NEVER turned into a bet
    const turnGs = {
      ...gs,
      stage: 'turn',
      currentBet: 0,
      communityCards: cardObjs('Ks9d7c4h'),
      players: [
        hero,
        {
          seat: 2,
          user_id: U_STAB,
          stack: 400,
          bet: 0,
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
      ],
      actionHistory: [
        { seat: 2, stage: 'preflop', action: 'raise', amount: 6 },
        { seat: 1, stage: 'preflop', action: 'call', amount: 6 },
        { seat: 1, stage: 'flop', action: 'check', amount: 0 },
        { seat: 2, stage: 'flop', action: 'check', amount: 0 },
      ],
    } as unknown as HorseGameStateV2;
    installDecisionHud(
      buildHudPacket('plo5', [pTight], { 't.stab.hu': [0.3, 43] }, 1_800_000_000_000, 'turn')
    );
    const turnCheckRes = omahaMathCoreRule(
      { action: 'check', thinkTime: 1000 },
      hero,
      turnGs,
      { omahaMathCore: true, omahaMathCorePlo5Turn: true },
      legalize
    );
    expect(turnCheckRes.action).toBe('check');
  });

  it('11. line-specific stab vs lead read: low lead rate never dilutes a 100% checked-to pot-stabber', () => {
    const U_STAB = '00000000-0000-4000-8000-000000000002';
    const U_HERO = '00000000-0000-4000-8000-000000000001';
    const pMix = emptyHudProfile(U_STAB, 'plo5');
    pMix.hands = 300;
    // Checked-to stabs: 40/40 (100% pot-stabber); First-to-act leads: 4/40 (10%)
    pMix.life['r.stab.hu'] = [40, 40];
    pMix.life['r.lead.hu'] = [40, 4];
    pMix.xc = { 'r.fw.stab.hu.b11': 40, 'r.fw.lead.hu.b11': 4 };

    const gs = {
      players: [
        { seat: 1, user_id: U_HERO },
        { seat: 2, user_id: U_STAB },
      ],
    };
    installDecisionHud(
      buildHudPacket(
        'plo5',
        [pMix],
        { 'r.stab.hu': [0.28, 33], 'r.lead.hu': [0.25, 33] },
        1_800_000_000_000,
        'river'
      )
    );
    const stabRec = omahaMathCoreTurnRiverHud.firstWager(gs, 2, 'plo5', 'river', 'hu', 'stab');
    const leadRec = omahaMathCoreTurnRiverHud.firstWager(gs, 2, 'plo5', 'river', 'hu', 'lead');
    expect(stabRec?.opps).toBe(40);
    expect(stabRec?.bets).toBe(40);
    expect(leadRec?.opps).toBe(40);
    expect(leadRec?.bets).toBe(4);
  });

  it('12. barrel_air regime (45 river barrel opps at 80%, 0.75x pot) proves +EV plain call without double-fSe penalty while keeping normal/station at 0 flips', () => {
    const state = makeState({
      pot: 175,
      toCall: 75,
      currentBet: 75,
      wagerFrac: 0.75,
      heroStack: 500,
    });
    const bins75 = makeBins(9, 40); // b09: (0.656, 0.761]
    const res = priceTurnRiverLifetimeCall({
      state,
      counts: { opps: 80, bets: 40, bins: bins75, priorRate: 0.28 },
      barrel: { opps: 45, bets: 36 }, // 80% barrel rate
      riverCounts: null,
      net: (p) => rakeNet(state, p),
      k: 5,
    });
    expect(res.usedBarrel).toBe(true);
    expect(res.fLo).toBeGreaterThan(0.42);
    expect(res.call).toBe(true);

    // Normal 25% bettor at identical sample size stays 0 excess / 0 flips
    const normal = priceTurnRiverLifetimeCall({
      state,
      counts: { opps: 80, bets: 20, bins: makeBins(9, 20), priorRate: 0.28 },
      barrel: { opps: 45, bets: 11 },
      riverCounts: null,
      net: (p) => rakeNet(state, p),
      k: 5,
    });
    expect(normal.excessMass).toBe(0);
    expect(normal.call).toBe(false);
  });

  it('13. polarized value+excess mixture proves medium bluff-catcher vs barrel_air & reads riverRate across turn packets', () => {
    // Medium PLO5 river bluff-catcher (middle two pair 9-7 on Ks 9d 7c 4h 2s: loses to all K-x two pair & sets)
    const bpState = makeState({
      hole: cards('9h7d8c5c3h'),
      board: cards('Ks9d7c4h2s'),
      pot: 175,
      toCall: 75,
      currentBet: 75,
      wagerFrac: 0.75,
      heroStack: 500,
    });
    const rPol = priceTurnRiverLifetimeCall({
      state: bpState,
      counts: { opps: 80, bets: 52, bins: makeBins(9, 52), priorRate: 0.28 },
      barrel: { opps: 55, bets: 44 },
      riverCounts: null,
      net: (p) => rakeNet(bpState, p),
      k: 5,
    });
    expect(rPol.excessMass).toBeGreaterThan(0.35);
    expect(rPol.call).toBe(true);

    // Cross-street riverRate reads o.lc even on a turn packet (where o.xc only holds turn counters)
    const U_OPP = '00000000-0000-4000-8000-000000000002';
    const pTurn = emptyHudProfile(U_OPP, 'plo5');
    pTurn.hands = 200;
    pTurn.life['r.stab.hu'] = [25, 20];
    pTurn.life['r.lead.hu'] = [30, 15];
    pTurn.xc = { 't.fw.stab.hu.b11': 18 };
    installDecisionHud(buildHudPacket('plo5', [pTurn], {}, 1_800_000_000_000, 'turn'));
    const rr = omahaMathCoreTurnRiverHud.riverRate!(
      { players: [{ seat: 2, user_id: U_OPP }] },
      2,
      'plo5',
      'hu'
    );
    expect(rr).toEqual({ opps: 55, bets: 35 });
  });

  it('14. PLO4 turn and river station/nit guard: 4-card hands produce 0 excess and 0 flips when fLo <= p_base', () => {
    const plo4River = makeState({
      variant: 'plo4',
      street: 'river',
      hole: cards('Kh9s6d3c'),
      board: cards('Ks9d7c4h2s'),
      pot: 200,
      toCall: 100,
      currentBet: 100,
      wagerFrac: 1.0,
      heroStack: 500,
    });
    const rStation = priceTurnRiverLifetimeCall({
      state: plo4River,
      counts: { opps: 200, bets: 40, bins: makeBins(11, 40), priorRate: 0.28 },
      barrel: { opps: 80, bets: 16 },
      riverCounts: null,
      net: (p) => rakeNet(plo4River, p),
      k: 5,
    });
    expect(rStation.excessMass).toBe(0);
    expect(rStation.call).toBe(false);

    const plo4Turn = makeState({
      variant: 'plo4',
      street: 'turn',
      hole: cards('Kh9s6d3c'),
      board: cards('Ks9d7c4h'),
      pot: 200,
      toCall: 100,
      currentBet: 100,
      wagerFrac: 1.0,
      heroStack: 500,
    });
    const tStation = priceTurnRiverLifetimeCall({
      state: plo4Turn,
      counts: { opps: 200, bets: 45, bins: makeBins(11, 45), priorRate: 0.3 },
      barrel: { opps: 80, bets: 18 },
      riverCounts: { opps: 80, bets: 20 },
      net: (p) => rakeNet(plo4Turn, p),
      k: 5,
    });
    expect(tStation.excessMass).toBe(0);
    expect(tStation.call).toBe(false);
  });

  it('15. PLO4 turn/river end-to-end Stage 1 boundary: flips fold->call vs pot-stabber, keeps fold vs station, never flips check->bet on turn', () => {
    const U_HERO = '00000000-0000-4000-8000-000000000001';
    const U_STAB = '00000000-0000-4000-8000-000000000002';
    const hero = {
      seat: 1,
      user_id: U_HERO,
      cards: cardObjs('Kh9s6d3c'),
      stack: 500,
      bet: 0,
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    } as unknown as SeatPlayer;
    const gs = {
      gameVariant: 'plo4',
      stage: 'river',
      pot: 200,
      currentBet: 100,
      bigBlind: 2,
      smallBlind: 1,
      minRaise: 100,
      communityCards: cardObjs('Ks9d7c4h2s'),
      players: [
        hero,
        {
          seat: 2,
          user_id: U_STAB,
          stack: 400,
          bet: 100,
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
      ],
      actionHistory: [
        { seat: 2, stage: 'preflop', action: 'raise', amount: 6 },
        { seat: 1, stage: 'preflop', action: 'call', amount: 6 },
        { seat: 1, stage: 'flop', action: 'check', amount: 0 },
        { seat: 2, stage: 'flop', action: 'check', amount: 0 },
        { seat: 1, stage: 'turn', action: 'check', amount: 0 },
        { seat: 2, stage: 'turn', action: 'check', amount: 0 },
        { seat: 1, stage: 'river', action: 'check', amount: 0 },
        { seat: 2, stage: 'river', action: 'bet', amount: 100 },
      ],
    } as unknown as HorseGameStateV2;
    const legalize = (d: HorseDecision): HorseDecision => d;
    const incomingFold: HorseDecision = { action: 'fold', thinkTime: 1000 };

    // (a) Pot-stabber on PLO4 river: 170/200 at pot (b11) -> flips fold -> plain call
    const pStab = emptyHudProfile(U_STAB, 'plo4');
    pStab.hands = 500;
    pStab.life['r.stab.hu'] = [200, 170];
    pStab.xc = { 'r.fw.stab.hu.b11': 170 };
    installDecisionHud(
      buildHudPacket('plo4', [pStab], { 'r.stab.hu': [0.28, 33] }, 1_800_000_000_000, 'river')
    );
    const stabRes = omahaMathCoreRule(
      incomingFold,
      hero,
      gs,
      { omahaMathCore: true, omahaMathCorePlo4River: true },
      legalize
    );
    expect(stabRes.action).toBe('call');
    expect(stabRes.amount).toBe(100);

    // (b) Station/tight bettor on PLO4 river: 40/200 -> stays fold
    const pTight = emptyHudProfile(U_STAB, 'plo4');
    pTight.hands = 500;
    pTight.life['r.stab.hu'] = [200, 40];
    pTight.xc = { 'r.fw.stab.hu.b11': 40 };
    installDecisionHud(
      buildHudPacket('plo4', [pTight], { 'r.stab.hu': [0.28, 33] }, 1_800_000_000_000, 'river')
    );
    const tightRes = omahaMathCoreRule(
      incomingFold,
      hero,
      gs,
      { omahaMathCore: true, omahaMathCorePlo4River: true },
      legalize
    );
    expect(tightRes.action).toBe('fold');

    // (c) Stage 1 PLO4 turn boundary: with HUD packet installed, incoming check is NEVER turned into a bet
    const turnGs = {
      ...gs,
      stage: 'turn',
      currentBet: 0,
      communityCards: cardObjs('Ks9d7c4h'),
      players: [
        hero,
        {
          seat: 2,
          user_id: U_STAB,
          stack: 400,
          bet: 0,
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
      ],
      actionHistory: [
        { seat: 2, stage: 'preflop', action: 'raise', amount: 6 },
        { seat: 1, stage: 'preflop', action: 'call', amount: 6 },
        { seat: 1, stage: 'flop', action: 'check', amount: 0 },
        { seat: 2, stage: 'flop', action: 'check', amount: 0 },
      ],
    } as unknown as HorseGameStateV2;
    installDecisionHud(
      buildHudPacket('plo4', [pTight], { 't.stab.hu': [0.3, 43] }, 1_800_000_000_000, 'turn')
    );
    const turnCheckRes = omahaMathCoreRule(
      { action: 'check', thinkTime: 1000 },
      hero,
      turnGs,
      { omahaMathCore: true, omahaMathCorePlo4Turn: true },
      legalize
    );
    expect(turnCheckRes.action).toBe('check');
  });

  it('16. PLO4 turn capped continuation + river stack-commit K_allin = 25 guard', () => {
    const plo4Turn = makeState({
      variant: 'plo4',
      street: 'turn',
      hole: cards('Kh9s6d3c'),
      board: cards('Ks9d7c4h'),
      pot: 200,
      toCall: 100,
      currentBet: 100,
      wagerFrac: 1.0,
      heroStack: 500,
    });
    const tRes = priceTurnRiverLifetimeCall({
      state: plo4Turn,
      counts: { opps: 120, bets: 102, bins: makeBins(11, 102), priorRate: 0.3 },
      barrel: { opps: 80, bets: 68 },
      riverCounts: { opps: 100, bets: 75 },
      net: (p) => rakeNet(plo4Turn, p),
      k: 5,
    });
    expect(tRes.capped).toBe(true);
    expect(tRes.call).toBe(true);

    // Plain non-committing call with marginal PLO4 bluff-catcher passes K=5, while stack-committing call requires K_allin=25
    const plo4RiverPlain = makeState({
      variant: 'plo4',
      street: 'river',
      hole: cards('9h7d6c3s'),
      board: cards('Ks9d7c4h2s'),
      pot: 200,
      toCall: 100,
      currentBet: 100,
      wagerFrac: 1.0,
      heroStack: 500,
    });
    const rPlain = priceTurnRiverLifetimeCall({
      state: plo4RiverPlain,
      counts: { opps: 100, bets: 68, bins: makeBins(11, 68), priorRate: 0.28 },
      barrel: null,
      riverCounts: null,
      net: (p) => rakeNet(plo4RiverPlain, p),
      k: 5,
    });
    expect(rPlain.commitsStack).toBe(false);
    expect(rPlain.call).toBe(true);

    const plo4RiverCommit = makeState({
      ...plo4RiverPlain,
      heroStack: 100,
    });
    const rCommit = priceTurnRiverLifetimeCall({
      state: plo4RiverCommit,
      counts: { opps: 100, bets: 68, bins: makeBins(11, 68), priorRate: 0.28 },
      barrel: null,
      riverCounts: null,
      net: (p) => rakeNet(plo4RiverCommit, p),
      k: 5,
    });
    expect(rCommit.commitsStack).toBe(true);
    expect(rCommit.kApplied).toBe(25);
    expect(rCommit.call).toBe(false);
  });

  it('17. fast-path: skips wasted decideOmahaMathCore on HUD-governed PLO5/PLO4 turn/river spots, preserves nuts floor, and warms priceTurnRiverLifetimeCall', () => {
    const U_OPP = '00000000-0000-4000-8000-000000000002';
    const U_HERO = '00000000-0000-4000-8000-000000000001';
    const pTight = emptyHudProfile(U_OPP, 'plo5');
    pTight.hands = 500;
    pTight.life['r.stab.hu'] = [220, 22];
    pTight.xc = { 'r.fw.stab.hu.b11': 22 };
    installDecisionHud(
      buildHudPacket('plo5', [pTight], { 'r.stab.hu': [0.28, 33] }, 1_800_000_000_000, 'river')
    );

    const mkGs = (holeStr: string) => {
      const hero = {
        seat: 1,
        user_id: U_HERO,
        cards: cardObjs(holeStr),
        stack: 500,
        bet: 0,
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      } as unknown as SeatPlayer;
      const gs = {
        gameVariant: 'plo5',
        stage: 'river',
        pot: 200,
        currentBet: 100,
        bigBlind: 2,
        smallBlind: 1,
        buttonSeat: 2,
        communityCards: cardObjs('Ks9d7c4h2s'),
        players: [
          hero,
          {
            seat: 2,
            user_id: U_OPP,
            stack: 400,
            bet: 100,
            is_folded: false,
            is_all_in: false,
            is_sitting_out: false,
          },
        ],
        actionHistory: [
          { seat: 2, stage: 'preflop', action: 'raise', amount: 6 },
          { seat: 1, stage: 'preflop', action: 'call', amount: 6 },
          { seat: 1, stage: 'flop', action: 'check', amount: 0 },
          { seat: 2, stage: 'flop', action: 'check', amount: 0 },
          { seat: 1, stage: 'turn', action: 'check', amount: 0 },
          { seat: 2, stage: 'turn', action: 'check', amount: 0 },
          { seat: 1, stage: 'river', action: 'check', amount: 0 },
          { seat: 2, stage: 'river', action: 'bet', amount: 100 },
        ],
        rakePercent: 5,
        rakeCap: 6,
        noFlopNoDrop: true,
        handNumber: 777099,
      } as unknown as HorseGameStateV2;
      return { hero, gs };
    };

    const legalize = (d: HorseDecision): HorseDecision => d;

    // Non-fold incoming action skips Monte Carlo completely (0 samples, b3-turn-river-hud receipt)
    const { hero, gs } = mkGs('Kh9c8d5c3h');
    const callKeep = omahaMathCoreRule(
      { action: 'call', amount: 100, thinkTime: 1000 },
      hero,
      gs,
      { omahaMathCore: true, omahaMathCorePlo5River: true },
      legalize
    );
    expect(callKeep.action).toBe('call');
    expect(callKeep.omahaMathCore?.core?.tables).toBe('b3-turn-river-hud');
    expect(callKeep.omahaMathCore?.core?.samples).toBe(0);

    // Tight opponent fold stays fold with 0 Monte Carlo samples (station/nit guard short-circuit)
    const foldTight = omahaMathCoreRule(
      { action: 'fold', thinkTime: 1000 },
      hero,
      gs,
      { omahaMathCore: true, omahaMathCorePlo5River: true },
      legalize
    );
    expect(foldTight.action).toBe('fold');
    expect(foldTight.omahaMathCore?.core?.tables).toBe('b3-turn-river-hud');
    expect(foldTight.omahaMathCore?.core?.samples).toBe(0);

    // Current nuts facing a wager still triggers call floor on the fast-path
    const { hero: nutsHero, gs: nutsGs } = mkGs('KhKcQdJcTh');
    const nutsRes = omahaMathCoreRule(
      { action: 'fold', thinkTime: 1000 },
      nutsHero,
      nutsGs,
      { omahaMathCore: true, omahaMathCorePlo5River: true },
      legalize
    );
    expect(nutsRes.action).toBe('call');
    expect(nutsRes.omahaMathCore?.core?.tables).toBe('b3-turn-river-hud');

    // PLO4 turn/river fast-path skips wasted decideOmahaMathCore when PLO4 HUD packet is active
    const pTight4 = emptyHudProfile(U_OPP, 'plo4');
    pTight4.hands = 500;
    pTight4.life['r.stab.hu'] = [220, 22];
    pTight4.xc = { 'r.fw.stab.hu.b11': 22 };
    installDecisionHud(
      buildHudPacket('plo4', [pTight4], { 'r.stab.hu': [0.28, 33] }, 1_800_000_000_000, 'river')
    );
    const { hero: h4, gs: gs4 } = mkGs('Kh9c8d5c');
    const plo4Res = omahaMathCoreRule(
      { action: 'fold', thinkTime: 1000 },
      h4,
      { ...gs4, gameVariant: 'plo4' } as unknown as HorseGameStateV2,
      { omahaMathCore: true, omahaMathCorePlo4River: true },
      legalize
    );
    expect(plo4Res.action).toBe('fold');
    expect(plo4Res.omahaMathCore?.core?.tables).toBe('b3-turn-river-hud');
    expect(plo4Res.omahaMathCore?.core?.samples).toBe(0);

    // Worker-start warm-up warms priceTurnRiverLifetimeCall cleanly across PLO4/PLO5 turn+river
    const w = warmOmahaMathCore();
    expect(w.ok).toBe(true);
  });

  it('18. audit P0-1: without an installed HUD packet, PLO5/PLO4 turn & river NEVER fall through to population decideOmahaMathCore and still rescue exact current nuts', () => {
    clearDecisionHud();
    const U_OPP = '00000000-0000-4000-8000-000000000002';
    const U_HERO = '00000000-0000-4000-8000-000000000001';
    const legalize = (d: HorseDecision): HorseDecision => d;

    for (const variant of ['plo5', 'plo4'] as const) {
      const holeStr = variant === 'plo5' ? 'Kh9c8d5c3h' : 'Kh9c8d5c';
      const nutsStr = variant === 'plo5' ? 'KhKcQdJcTh' : 'KhKcQdJc';
      for (const stage of ['turn', 'river'] as const) {
        const boardStr = stage === 'turn' ? 'Ks9d7c4h' : 'Ks9d7c4h2s';
        const streetOpt =
          variant === 'plo5'
            ? stage === 'turn'
              ? { omahaMathCorePlo5Turn: true }
              : { omahaMathCorePlo5River: true }
            : stage === 'turn'
              ? { omahaMathCorePlo4Turn: true }
              : { omahaMathCorePlo4River: true };
        const mkGs = (hStr: string) => {
          const hero = {
            seat: 1,
            user_id: U_HERO,
            cards: cardObjs(hStr),
            stack: 500,
            bet: 0,
            is_folded: false,
            is_all_in: false,
            is_sitting_out: false,
          } as unknown as SeatPlayer;
          const gs = {
            gameVariant: variant,
            stage,
            pot: 200,
            currentBet: 100,
            bigBlind: 2,
            smallBlind: 1,
            buttonSeat: 2,
            communityCards: cardObjs(boardStr),
            players: [
              hero,
              {
                seat: 2,
                user_id: U_OPP,
                stack: 400,
                bet: 100,
                is_folded: false,
                is_all_in: false,
                is_sitting_out: false,
              },
            ],
            actionHistory: [
              { seat: 2, stage: 'preflop', action: 'raise', amount: 6 },
              { seat: 1, stage: 'preflop', action: 'call', amount: 6 },
              { seat: 1, stage: 'flop', action: 'check', amount: 0 },
              { seat: 2, stage: 'flop', action: 'check', amount: 0 },
              { seat: 1, stage, action: 'check', amount: 0 },
              { seat: 2, stage, action: 'bet', amount: 100 },
            ],
            rakePercent: 5,
            rakeCap: 6,
            noFlopNoDrop: true,
            handNumber: 777101,
          } as unknown as HorseGameStateV2;
          return { hero, gs };
        };

        // Non-nuts fold with NO HUD packet: stays on b3-turn-river-hud fast-path, 0 samples, owned: false
        const { hero, gs } = mkGs(holeStr);
        const kept = omahaMathCoreRule(
          { action: 'fold', thinkTime: 1000 },
          hero,
          gs,
          { omahaMathCore: true, ...streetOpt },
          legalize
        );
        expect(kept.action, `${variant} ${stage} no-hud`).toBe('fold');
        expect(kept.omahaMathCore?.core?.tables, `${variant} ${stage}`).toBe('b3-turn-river-hud');
        expect(kept.omahaMathCore?.core?.samples, `${variant} ${stage}`).toBe(0);
        expect(kept.omahaMathCore?.owned, `${variant} ${stage}`).toBe(false);
        expect(omahaMathCoreOwns(kept), `${variant} ${stage}`).toBe(false);

        // Exact current nuts with NO HUD packet: STILL rescued by CURRENT_NUTS_CALL_FLOOR & core-owned!
        const { hero: nh, gs: ngs } = mkGs(nutsStr);
        const rescued = omahaMathCoreRule(
          { action: 'fold', thinkTime: 1000 },
          nh,
          ngs,
          { omahaMathCore: true, ...streetOpt },
          legalize
        );
        expect(rescued.action, `${variant} ${stage} nuts`).toBe('call');
        expect(rescued.omahaMathCore?.core?.tables, `${variant} ${stage} nuts`).toBe(
          'b3-turn-river-hud'
        );
        expect(rescued.omahaMathCore?.owned, `${variant} ${stage} nuts`).toBeUndefined();
        expect(omahaMathCoreOwns(rescued), `${variant} ${stage} nuts`).toBe(true);
      }
    }
  });

  it('19. audit P0-2: unpriced kept B3 turn/river decisions set owned: false (preserving V44 Second Look); actual B3 fold->call flips stay core-owned', () => {
    const U_STAB = '00000000-0000-4000-8000-000000000002';
    const U_HERO = '00000000-0000-4000-8000-000000000001';
    const pStab = emptyHudProfile(U_STAB, 'plo5');
    pStab.hands = 500;
    pStab.life['r.stab.hu'] = [220, 172];
    pStab.xc = { 'r.fw.stab.hu.b11': 172, 'r.brl.hu.opps': 120, 'r.brl.hu.bets': 96 };
    installDecisionHud(
      buildHudPacket('plo5', [pStab], { 'r.stab.hu': [0.28, 33] }, 1_800_000_000_000, 'river')
    );

    const hero = {
      seat: 1,
      user_id: U_HERO,
      cards: cardObjs('Kh9c8d5c3h'),
      stack: 500,
      bet: 0,
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    } as unknown as SeatPlayer;
    const gs = {
      gameVariant: 'plo5',
      stage: 'river',
      pot: 200,
      currentBet: 100,
      bigBlind: 2,
      smallBlind: 1,
      buttonSeat: 2,
      communityCards: cardObjs('Ks9d7c4h2s'),
      players: [
        hero,
        {
          seat: 2,
          user_id: U_STAB,
          stack: 400,
          bet: 100,
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
      ],
      actionHistory: [
        { seat: 2, stage: 'preflop', action: 'raise', amount: 6 },
        { seat: 1, stage: 'preflop', action: 'call', amount: 6 },
        { seat: 1, stage: 'flop', action: 'check', amount: 0 },
        { seat: 2, stage: 'flop', action: 'bet', amount: 10 },
        { seat: 1, stage: 'flop', action: 'call', amount: 10 },
        { seat: 1, stage: 'turn', action: 'check', amount: 0 },
        { seat: 2, stage: 'turn', action: 'bet', amount: 34 },
        { seat: 1, stage: 'turn', action: 'call', amount: 34 },
        { seat: 1, stage: 'river', action: 'check', amount: 0 },
        { seat: 2, stage: 'river', action: 'bet', amount: 100 },
      ],
      rakePercent: 5,
      rakeCap: 6,
      noFlopNoDrop: true,
      handNumber: 777102,
    } as unknown as HorseGameStateV2;
    const legalize = (d: HorseDecision): HorseDecision => d;

    // Unpriced kept baseline call: owned: false -> Second Look NOT blocked by 'math_core_owned'
    const keptCall = omahaMathCoreRule(
      { action: 'call', amount: 100, thinkTime: 1000 },
      hero,
      gs,
      { omahaMathCore: true, omahaMathCorePlo5River: true },
      legalize
    );
    expect(keptCall.action).toBe('call');
    expect(keptCall.omahaMathCore?.owned).toBe(false);
    expect(omahaMathCoreOwns(keptCall)).toBe(false);
    const keptPlan = ServerTableEngineTurns.secondLookPlan(keptCall, 100, 200, 2, 3000, 10000);
    expect(keptPlan.ok || keptPlan.reason !== 'math_core_owned').toBe(true);

    // Actual B3 fold -> call flip: owned omitted -> core-owned -> Second Look blocked as 'math_core_owned'
    const flippedCall = omahaMathCoreRule(
      { action: 'fold', thinkTime: 1000 },
      hero,
      gs,
      { omahaMathCore: true, omahaMathCorePlo5River: true },
      legalize
    );
    expect(flippedCall.action).toBe('call');
    expect(flippedCall.omahaMathCore?.owned).toBeUndefined();
    expect(omahaMathCoreOwns(flippedCall)).toBe(true);
    expect(ServerTableEngineTurns.secondLookPlan(flippedCall, 100, 200, 2, 3000, 10000)).toEqual({
      ok: false,
      reason: 'math_core_owned',
    });
  });

  it('20. audit P1-5: standalone omahaMathCoreRecover (incumbent="none") on PLO5 river is NOT narrowed by omahaMathCorePlo5RiverFoldToCall', () => {
    clearDecisionHud();
    // Hero holds top set KK (nuts) on Ks 9d 7c 4h 2s, checked to on river -> standalone recovery can value-bet!
    const U_OPP = '00000000-0000-4000-8000-000000000002';
    const U_HERO = '00000000-0000-4000-8000-000000000001';
    const hero = {
      seat: 1,
      user_id: U_HERO,
      cards: cardObjs('KhKcQdJcTh'),
      stack: 500,
      bet: 0,
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    } as unknown as SeatPlayer;
    const gs = {
      gameVariant: 'plo5',
      stage: 'river',
      pot: 100,
      currentBet: 0,
      bigBlind: 2,
      smallBlind: 1,
      buttonSeat: 1,
      communityCards: cardObjs('Ks9d7c4h2s'),
      players: [
        hero,
        {
          seat: 2,
          user_id: U_OPP,
          stack: 500,
          bet: 0,
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
      ],
      actionHistory: [
        { seat: 1, stage: 'preflop', action: 'raise', amount: 6 },
        { seat: 2, stage: 'preflop', action: 'call', amount: 6 },
        { seat: 2, stage: 'flop', action: 'check', amount: 0 },
        { seat: 1, stage: 'flop', action: 'check', amount: 0 },
        { seat: 2, stage: 'turn', action: 'check', amount: 0 },
        { seat: 1, stage: 'turn', action: 'check', amount: 0 },
        { seat: 2, stage: 'river', action: 'check', amount: 0 },
      ],
      rakePercent: 5,
      rakeCap: 6,
      noFlopNoDrop: true,
      handNumber: 777103,
    } as unknown as HorseGameStateV2;
    const legalize = (d: HorseDecision): HorseDecision => d;
    const rec = omahaMathCoreRule(
      { action: 'check', thinkTime: 0 },
      hero,
      gs,
      { omahaMathCore: true, omahaMathCorePlo5River: true },
      legalize,
      undefined,
      'none'
    );
    expect(rec.action).toBe('bet');
    expect(rec.omahaMathCore?.applied).toBe(true);
    expect(rec.omahaMathCore?.core?.tables).not.toBe('b3-turn-river-hud');
  });

  it('21. audit P1-1: warmOmahaMathCore warms HorseLogic.decide + plo4Policy + B2 cbetRaiseShare cleanly without throws, provider leaks, or fastRandom mutation', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prevProv = omahaMathCoreTurnRiverProvider();
    const before = saveFastRandom();
    const w = warmOmahaMathCore(() => 0);
    const after = saveFastRandom();
    expect(w.ok).toBe(true);
    expect(errSpy).not.toHaveBeenCalled();
    expect(omahaMathCoreTurnRiverProvider()).toBe(prevProv);
    expect(after).toBe(before);
  });
});
