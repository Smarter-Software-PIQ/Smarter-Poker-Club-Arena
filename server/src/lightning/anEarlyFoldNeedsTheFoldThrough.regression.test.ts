/**
 * REGRESSION (beyond ledger L-017, 2026-11-15). RED before the decision option
 * HorseDecideOpts.lightningEarlyFoldNeedsFoldThrough existed, green with it on.
 * The option is DEFAULT OFF; its live switch is the Horse option switch (ledger
 * flag lightningEarlyFoldNeedsFoldThrough).
 *
 * THE DEFECT. A Horse's early look (LightningHandHost.offerHorseEarlyLooks) is
 * priced on the table as it stands, while seats before it on the street still
 * have to act, and its fold is final. The probe (PROBE-BEYOND-BB.md, development
 * seeds, all-Horse tables) measured the real turn continuing where that fold
 * had been final: small blind 2.9 / 10.3 / 8.3 VPIP points (NLH / PLO4 / PLO5),
 * the small blind folded to continuing in about 30% of those folds.
 *
 * THE CORRECT BEHAVIOUR pinned here, through the real host and the real
 * HorseLogic.decide entry, with the option on: "already folding" means folding
 * in every spot the Horse can still reach. Before the river, an early look that
 * folds while a live seat before it still acts is checked once more on the
 * FOLD-THROUGH frame (those seats folded; public state and the Horse's own
 * cards only). A fold there too is pressed right away, as today (trash still
 * folds right away). Anything else drops the early fold: the Horse decides
 * afresh on its own turn. River early looks are unchanged. Option absent:
 * today's early look.
 *
 * The inner policy is scripted (HorseLogic's decideCaptured): fold on the table
 * as it stands at an early look, the case's answer on the fold-through frame and
 * on the Horse's own turn. People act 3 s into each turn (long after a Horse's
 * look-and-press time).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access in the Lightning host fixture');
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC in the Lightning host fixture');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), describeError: String }));

const kit = await import('../testing/lightningHostTestKit.js');
const { lightningHorseFastFoldReactionMs } = await import('./LightningHorse.js');
const { HorseLogic } = await import('../engine/HorseLogic.js');
const { Deck } = await import('../engine/PokerEngine.js');
const { hasRiverNuts } = await import('../engine/HorseRiverNuts.js');

const BB = 2;
const DECISIONS = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all_in']);
const hosts: any[] = [];
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.abort('test_complete').catch(() => undefined);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type Act = 'fold' | 'call' | 'raise' | 'check';
type Person = { action: string; amount?: number } | null;
interface Ask {
  kind: 'early' | 'fold_through' | 'turn';
  stage: string;
  toCall: number;
  /** seats the snapshot shows folded / seats the table really has folded. */
  snapFolded: number[];
  realFolded: number[];
  /** fold records the snapshot carries for this street. */
  streetFolds: number[];
  otherCards: number;
  heroCards: number;
  potsNameAFolder: boolean;
  board: number;
  riverNuts: boolean;
}

/**
 * Six-handed NLH, big-blind ante, 100 bb; one Horse (seat 1 SB, 2 BB, 3 UTG,
 * 4 HJ, 5 CO, 6 BTN). `person` scripts the people (null: check if free, else
 * fold). `option`: undefined = absent; true = on for the Horse.
 */
async function hand(opts: {
  base: number;
  horseSeat: 2 | 6;
  person: (seat: number, stage: string) => Person;
  foldThrough: Act;
  turn: (toCall: number) => Act;
  option?: boolean;
}) {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  // Host delay RNG does not seed the cryptographic deck. Keep the canonical
  // legal 52-card deck so the real final river-nuts rule cannot turn this
  // scripted non-nut check into a bet and change the scenario being tested.
  vi.spyOn(Deck.prototype, 'shuffle').mockImplementation(() => {});
  const formed = kit.formedHand(6, opts.base);
  const others = formed.players.filter((p) => p !== formed.bb && p !== formed.sb);
  const horseId = opts.horseSeat === 2 ? formed.bb : others[opts.horseSeat - 3]!;
  const t = kit.buildHost(
    formed,
    formed.players.map(() => 100 * BB),
    {
      horses: new Set([horseId]),
      rules: {
        game_variant: 'nlh',
        big_blind: BB,
        small_blind: 1,
        ante_enabled: true,
        ante: BB,
        big_blind_ante_enabled: true,
      },
      deps: { random: () => 0.5 },
    }
  );
  hosts.push(t.host);
  const host = t.host as any;
  const asked: Ask[] = [];
  // The inner policy (HorseLogic.decideCaptured), scripted by what it is shown.
  vi.spyOn(HorseLogic as any, 'decideCaptured').mockImplementation((...args: any[]) => {
    const [player, gs] = args;
    const st = host.hc.getState();
    const folded = (players: any[]) =>
      players
        .filter((p: any) => p.is_folded)
        .map((p: any) => p.seat)
        .sort();
    const snapFolded = folded(gs.players);
    const realFolded = folded(st.players);
    const frame = snapFolded.some((seat: number) => !realFolded.includes(seat));
    const offTurn = st.currentPlayerSeat !== player.seat;
    const kind: Ask['kind'] = frame ? 'fold_through' : offTurn ? 'early' : 'turn';
    asked.push({
      kind,
      stage: gs.stage,
      toCall: gs.toCall,
      snapFolded,
      realFolded,
      streetFolds: gs.actionHistory
        .filter((a: any) => a.stage === gs.stage && a.action === 'fold')
        .map((a: any) => a.seat)
        .sort(),
      otherCards: gs.players
        .filter((p: any) => p.seat !== gs.heroSeat)
        .reduce((n: number, p: any) => n + (p.cards?.length ?? 0), 0),
      heroCards: player.cards.length,
      potsNameAFolder: gs.pots.some((pot: any) =>
        pot.eligiblePlayers.some(
          (id: string) => gs.players.find((p: any) => p.user_id === id)?.is_folded
        )
      ),
      board: gs.communityCards.length,
      riverNuts: hasRiverNuts(player, gs, true),
    });
    const action: Act =
      kind === 'early' ? 'fold' : kind === 'fold_through' ? opts.foldThrough : opts.turn(gs.toCall);
    const amount = action === 'call' ? gs.toCall : action === 'raise' ? gs.minRaiseTo : undefined;
    return { action, amount, thinkTime: 1_500 };
  });
  t.horseLane.raw.decideFast.mockImplementation(async (snap: any) => {
    // The worker's call: the real decision entry, the option as this case sets it.
    const decision = HorseLogic.decide(
      snap.player,
      snap.gameState,
      snap.style,
      snap.mods ?? {},
      opts.option === undefined
        ? { telemetry: false }
        : { telemetry: false, lightningEarlyFoldNeedsFoldThrough: opts.option }
    );
    return {
      type: 'FAST_RESULT',
      requestId: 1,
      planBinding: null,
      planIssueDisposition: 'no_effects',
      generation: snap.generation,
      fence: snap.fence,
      decision,
      rngBefore: 0,
      rngAfter: 0,
      computeMs: 1,
      governorScale: 1,
      effects: [],
    } as never;
  });
  await t.host.start();
  const startedAt = Date.now();
  let firstFastFoldAt = -1;
  let firstPersonActionAt = -1;
  for (let i = 0; i < 2_000 && t.host.lifecycle === 'dealing'; i++) {
    await vi.advanceTimersByTimeAsync(50);
    if (firstFastFoldAt < 0 && t.calls.fastFold.some((f: any) => f.playerId === horseId))
      firstFastFoldAt = Date.now() - startedAt;
    const st = t.host.peekState();
    if (!st) continue;
    const cur = st.players.find((p: any) => p.seat === st.currentPlayerSeat);
    if (!cur || cur.user_id === horseId) continue;
    if (host.turnUser !== cur.user_id || Date.now() - host.turnStartMs < 3_000) continue;
    const owes = st.currentBet > cur.bet + 0.005;
    const a = opts.person(cur.seat, st.stage) ?? { action: owes ? 'fold' : 'check' };
    if (firstPersonActionAt < 0) firstPersonActionAt = Date.now() - startedAt;
    t.host.handlePlayerAction(cur.user_id, a.action, a.amount);
  }
  const horseActions = (stage: string) =>
    (host.actions as any[])
      .filter((a) => a.userId === horseId && a.stage === stage && a.origin !== 'forced')
      // the decisions only (an uncalled bet's 'return' is the table's, not the Horse's)
      .filter((a) => DECISIONS.has(String(a.action)))
      .map((a) => a.action);
  const fastFolds = t.calls.fastFold
    .filter((f: any) => f.playerId === horseId)
    .map((f: any) => f.foldType);
  const reactionMs = lightningHorseFastFoldReactionMs({ userId: horseId, random: () => 0.5 });
  return { asked, horseActions, fastFolds, firstFastFoldAt, firstPersonActionAt, reactionMs };
}

/** Folded round to the button: UTG, HJ and CO fold. */
const foldedToTheButton = () => null;

/** UTG opens to 3 bb and HJ calls; on `betStreet` UTG bets 6 (HJ then folds); else checks. */
const openCallThenBet =
  (betStreet: 'flop' | 'river') =>
  (seat: number, stage: string): Person => {
    if (stage === 'preflop')
      return seat === 3
        ? { action: 'raise', amount: 3 * BB }
        : seat === 4
          ? { action: 'call' }
          : null;
    if (stage === betStreet) return seat === 3 ? { action: 'bet', amount: 6 } : null;
    return null;
  };
const callOrCheck = (toCall: number): Act => (toCall > 0.005 ? 'call' : 'check');

describe('an early fold needs the fold-through (beyond L-017; option on)', () => {
  it('a button that folds in the early look but opens when folded to does not fold early; it opens on its turn', async () => {
    const { asked, horseActions, fastFolds } = await hand({
      base: 5_200,
      horseSeat: 6,
      person: foldedToTheButton,
      foldThrough: 'raise',
      turn: () => 'raise',
      option: true,
    });
    const preflop = asked.filter((a) => a.stage === 'preflop').map((a) => a.kind);
    expect(preflop, JSON.stringify(asked)).toEqual(['early', 'fold_through', 'turn']);
    expect(horseActions('preflop')).toEqual(['raise']);
    expect(fastFolds).toEqual([]);
  });

  it('the fold-through frame is the public table with the seats before folded, and nothing else', async () => {
    const { asked } = await hand({
      base: 5_300,
      horseSeat: 6,
      person: foldedToTheButton,
      foldThrough: 'raise',
      turn: () => 'raise',
      option: true,
    });
    const early = asked.find((a) => a.kind === 'early')!;
    const ft = asked.find((a) => a.kind === 'fold_through')!;
    expect(ft, JSON.stringify(asked)).toMatchObject({
      stage: 'preflop',
      // UTG, HJ and CO folded in the frame; nobody has really folded yet.
      snapFolded: [3, 4, 5],
      streetFolds: [3, 4, 5],
      otherCards: 0,
      heroCards: 2,
      potsNameAFolder: false,
      board: 0,
      // the Horse's own price is the early look's
      toCall: early.toCall,
    });
    expect(ft.realFolded.length).toBeLessThan(3);
  });

  it('a trash hand still folds right away: the fold-through folds too, and the press lands before UTG acts', async () => {
    const { asked, horseActions, fastFolds, firstFastFoldAt, firstPersonActionAt, reactionMs } =
      await hand({
        base: 5_400,
        horseSeat: 6,
        person: foldedToTheButton,
        foldThrough: 'fold',
        turn: () => 'raise',
        option: true,
      });
    expect(
      asked.map((a) => a.kind),
      JSON.stringify(asked)
    ).toEqual(['early', 'fold_through']);
    expect(fastFolds).toEqual(['fast']);
    expect(horseActions('preflop')).toEqual(['fold']);
    expect(firstFastFoldAt).toBeGreaterThan(0);
    expect(firstFastFoldAt).toBeLessThan(firstPersonActionAt);
    // at a person's look-and-press time, as today (50 ms steps)
    expect(Math.abs(firstFastFoldAt - reactionMs)).toBeLessThanOrEqual(60);
  });

  it('a flop early fold the seat between can undo waits: fold-through calls, the turn calls heads up', async () => {
    const { asked, horseActions, fastFolds } = await hand({
      base: 5_500,
      horseSeat: 2,
      person: openCallThenBet('flop'),
      foldThrough: 'call',
      turn: callOrCheck,
      option: true,
    });
    const flop = asked.filter((a) => a.stage === 'flop');
    expect(
      flop.map((a) => a.kind),
      JSON.stringify(flop)
    ).toEqual(['turn', 'early', 'fold_through', 'turn']);
    expect(flop[2]).toMatchObject({ snapFolded: expect.arrayContaining([4]), toCall: 6 });
    expect(horseActions('flop')).toEqual(['check', 'call']);
    expect(fastFolds).toEqual([]);
  });

  it('the river early look is unchanged: no fold-through, the fold is a Lightning Fold', async () => {
    const { asked, horseActions, fastFolds } = await hand({
      base: 5_600,
      horseSeat: 2,
      person: openCallThenBet('river'),
      foldThrough: 'call',
      turn: callOrCheck,
      option: true,
    });
    const river = asked.filter((a) => a.stage === 'river');
    expect(
      river.map((a) => a.riverNuts),
      JSON.stringify(river)
    ).toEqual([false, false]);
    expect(
      river.map((a) => a.kind),
      JSON.stringify(river)
    ).toEqual(['turn', 'early']);
    expect(horseActions('river')).toEqual(['check', 'fold']);
    expect(fastFolds).toEqual(['fast']);
  });
});

describe('an early fold needs the fold-through: default OFF', () => {
  it('with the option absent, the button folds early with no second ask, as today', async () => {
    const { asked, horseActions, fastFolds } = await hand({
      base: 5_700,
      horseSeat: 6,
      person: foldedToTheButton,
      foldThrough: 'raise',
      turn: () => 'raise',
    });
    expect(
      asked.map((a) => a.kind),
      JSON.stringify(asked)
    ).toEqual(['early']);
    expect(horseActions('preflop')).toEqual(['fold']);
    expect(fastFolds).toEqual(['fast']);
  });
});
