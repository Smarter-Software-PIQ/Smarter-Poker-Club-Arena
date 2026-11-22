import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  FastHorseDecisionResult,
  LiveHorseDecisionLane,
  LiveHorseDecisionSnapshot,
} from '../engine/horseDecision/index.js';
import type { HorseDecision } from '../types.js';

vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access in LightningPoolVpipJudge test');
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC in LightningPoolVpipJudge test');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));

const {
  DEFAULT_LIGHTNING_POOL_VPIP_POLICY,
  LIGHTNING_POOL_VPIP_DEFAULT_FLOOR_PCT,
  LIGHTNING_POOL_VPIP_DEFAULT_GRACE_HANDS,
  LIGHTNING_POOL_VPIP_DEFAULT_WINDOW_HANDS,
  LIGHTNING_POOL_VPIP_MAX_EVICT_ATTEMPTS,
  LightningPoolVpipJudge,
  classifyLightningPreflopParticipation,
  isLightningPoolVpipJudgeEnabled,
  resolveLightningPoolVpipPolicy,
} = await import('./LightningPoolVpipJudge.js');
const { LightningSupervisor } = await import('./LightningSupervisor.js');
const { LightningRegistry } = await import('./LightningRegistry.js');
const kit = await import('../testing/lightningHostTestKit.js');

afterEach(() => {
  vi.useRealTimers();
});

const forced = (userId: string, action: string, dead = false) => ({
  userId,
  action,
  stage: 'preflop',
  origin: 'forced',
  dead,
});
const act = (userId: string, action: string, stage = 'preflop') => ({ userId, action, stage });

const CLUSTER_A = '11111111-1111-4111-8111-111111111111';
const CLUSTER_B = '22222222-2222-4222-8222-222222222222';
const HOST_TABLE = '33333333-3333-4333-8333-333333333333';

describe('classifyLightningPreflopParticipation', () => {
  it('classifies voluntary preflop entry (call, bet, raise, all_in), including limp-then-fold', () => {
    for (const action of ['call', 'bet', 'raise', 'all_in']) {
      expect(classifyLightningPreflopParticipation('p1', [act('p1', action)])).toEqual({
        hadOpportunity: true,
        entered: true,
      });
    }
    expect(
      classifyLightningPreflopParticipation('p1', [
        act('p1', 'call'),
        act('p2', 'raise'),
        act('p1', 'fold'),
      ])
    ).toEqual({ hadOpportunity: true, entered: true });
  });

  it('classifies preflop fold and BB option check as opportunity without VPIP entry', () => {
    expect(
      classifyLightningPreflopParticipation('p1', [forced('p1', 'sb'), act('p1', 'fold')])
    ).toEqual({ hadOpportunity: true, entered: false });
    expect(
      classifyLightningPreflopParticipation('p1', [
        forced('p1', 'bb'),
        forced('p1', 'ante', true),
        act('p1', 'check'),
      ])
    ).toEqual({ hadOpportunity: true, entered: false });
  });

  it('excludes walks and forced-only blind/ante postings (no voluntary preflop action)', () => {
    // Walk: everyone folds to BB, so BB has only forced postings and no voluntary action.
    expect(
      classifyLightningPreflopParticipation('bb', [
        forced('sb', 'sb'),
        forced('bb', 'bb'),
        forced('bb', 'ante', true),
        act('utg', 'fold'),
        act('sb', 'fold'),
      ])
    ).toEqual({ hadOpportunity: false, entered: false });

    // Uncalled bet returns and postflop actions never count as preflop participation.
    expect(
      classifyLightningPreflopParticipation('p1', [
        forced('p1', 'bb'),
        { userId: 'p1', action: 'return', stage: 'preflop' },
        act('p1', 'bet', 'flop'),
      ])
    ).toEqual({ hadOpportunity: false, entered: false });

    // Letting the action clock expire (timeout fold/check) still counts as a missed opportunity
    // so a player cannot dodge the VPIP floor by timing out on weak hands.
    expect(classifyLightningPreflopParticipation('p1', [forced('p1', 'fold')])).toEqual({
      hadOpportunity: true,
      entered: false,
    });
  });
});

describe('resolveLightningPoolVpipPolicy and feature gate', () => {
  it('defaults to 25% floor / 30-hand rolling window / 10 grace hands for floored Lightning tables', () => {
    expect(DEFAULT_LIGHTNING_POOL_VPIP_POLICY).toEqual({
      floorPct: 25,
      windowHands: 30,
      graceHands: 10,
    });
    expect(LIGHTNING_POOL_VPIP_DEFAULT_FLOOR_PCT).toBe(25);
    expect(LIGHTNING_POOL_VPIP_DEFAULT_WINDOW_HANDS).toBe(30);
    expect(LIGHTNING_POOL_VPIP_DEFAULT_GRACE_HANDS).toBe(10);

    expect(
      resolveLightningPoolVpipPolicy({
        nit_game: true,
        maintain_percent_min: 25,
        maintain_hands: 10,
      })
    ).toEqual({ floorPct: 25, windowHands: 30, graceHands: 10 });

    // Respects explicit pool window/grace overrides and table floor overrides.
    expect(
      resolveLightningPoolVpipPolicy({
        nit_game: true,
        maintain_percent_min: 30,
        ruleset_snapshot: { lightning_vpip_window: 40, lightning_vpip_grace_hands: 12 },
      })
    ).toEqual({ floorPct: 30, windowHands: 40, graceHands: 12 });
  });

  it('returns null when nit_game is false/absent or floor is zero', () => {
    expect(
      resolveLightningPoolVpipPolicy({ nit_game: false, maintain_percent_min: 25 })
    ).toBeNull();
    expect(resolveLightningPoolVpipPolicy({ nit_game: true, maintain_percent_min: 0 })).toBeNull();
    expect(resolveLightningPoolVpipPolicy(null)).toBeNull();
  });

  it('honors the LIGHTNING_POOL_VPIP_JUDGE feature gate', () => {
    expect(isLightningPoolVpipJudgeEnabled({})).toBe(true);
    expect(isLightningPoolVpipJudgeEnabled({ LIGHTNING_POOL_VPIP_JUDGE: 'true' })).toBe(true);
    expect(isLightningPoolVpipJudgeEnabled({ LIGHTNING_POOL_VPIP_JUDGE: 'false' })).toBe(false);

    const disabledJudge = new LightningPoolVpipJudge({ enabled: () => false });
    const res = disabledJudge.recordHand({
      clusterId: CLUSTER_A,
      poolSessionId: 'sess-disabled',
      playerId: 'p1',
      handNumber: 1,
      hadOpportunity: true,
      entered: false,
      policy: DEFAULT_LIGHTNING_POOL_VPIP_POLICY,
    });
    expect(res.verdict).toBe('disabled');
  });
});

describe('LightningPoolVpipJudge rolling 30/10/25% state machine', () => {
  const policy = DEFAULT_LIGHTNING_POOL_VPIP_POLICY;

  it('under 10 grace hands: never warns or removes even at 0% VPIP, and excludes walks', () => {
    const judge = new LightningPoolVpipJudge({ enabled: () => true });
    // Feed 5 walks + 9 voluntary folds -> still only 9 eligible hands (< 10 grace).
    for (let i = 1; i <= 5; i++) {
      const w = judge.recordHand({
        clusterId: CLUSTER_A,
        poolSessionId: 's-grace',
        playerId: 'p1',
        handNumber: i,
        hadOpportunity: false,
        entered: false,
        policy,
      });
      expect(w.verdict).toBe('skipped');
      expect(w.hands).toBe(0);
      expect(w.warned).toBe(false);
    }
    for (let i = 6; i <= 14; i++) {
      const r = judge.recordHand({
        clusterId: CLUSTER_A,
        poolSessionId: 's-grace',
        playerId: 'p1',
        handNumber: i,
        hadOpportunity: true,
        entered: false,
        policy,
      });
      expect(r.verdict).toBe('grace');
      expect(r.warned).toBe(false);
      expect(r.evictPending).toBe(false);
      expect(r.vpipPct).toBe(0);
    }
    expect(judge.getStatus('s-grace', policy)?.hands).toBe(9);
  });

  it('at >=10 hands and VPIP < 25%: warns first, counts down 10 grace hands, then evicts once violation persists', () => {
    const judge = new LightningPoolVpipJudge({ enabled: () => true });
    for (let h = 1; h <= 9; h++) {
      expect(
        judge.recordHand({
          clusterId: CLUSTER_A,
          poolSessionId: 's-boot',
          playerId: 'p1',
          handNumber: h,
          hadOpportunity: true,
          entered: false,
          policy,
        }).verdict
      ).toBe('grace');
    }
    // Hand 10: first lapse -> warning opened, NOT evicted.
    const hand10 = judge.recordHand({
      clusterId: CLUSTER_A,
      poolSessionId: 's-boot',
      playerId: 'p1',
      handNumber: 10,
      hadOpportunity: true,
      entered: false,
      policy,
    });
    expect(hand10.verdict).toBe('warn');
    expect(hand10.warningOpened).toBe(true);
    expect(hand10.warned).toBe(true);
    expect(hand10.graceRemaining).toBe(10);
    expect(hand10.evictPending).toBe(false);

    // Hands 11..19: still below floor, grace counts down 9..1, no eviction yet.
    for (let h = 11; h <= 19; h++) {
      const r = judge.recordHand({
        clusterId: CLUSTER_A,
        poolSessionId: 's-boot',
        playerId: 'p1',
        handNumber: h,
        hadOpportunity: true,
        entered: false,
        policy,
      });
      expect(r.verdict).toBe('warn');
      expect(r.warningOpened).toBe(false);
      expect(r.graceRemaining).toBe(20 - h);
      expect(r.evictPending).toBe(false);
    }

    // Hand 20: grace exhausted while still at 0% < 25% -> eviction due!
    const hand20 = judge.recordHand({
      clusterId: CLUSTER_A,
      poolSessionId: 's-boot',
      playerId: 'p1',
      handNumber: 20,
      hadOpportunity: true,
      entered: false,
      policy,
    });
    expect(hand20.verdict).toBe('evict');
    expect(hand20.graceRemaining).toBe(0);
    expect(hand20.evictPending).toBe(true);
  });

  it('recovers cleanly during warning grace and grants a fresh warning on any later lapse', () => {
    const judge = new LightningPoolVpipJudge({ enabled: () => true });
    for (let h = 1; h <= 10; h++) {
      judge.recordHand({
        clusterId: CLUSTER_A,
        poolSessionId: 's-rec',
        playerId: 'p1',
        handNumber: h,
        hadOpportunity: true,
        entered: false,
        policy,
      });
    }
    expect(judge.getStatus('s-rec', policy)?.warned).toBe(true);

    // Hands 11..14: enter 4 in a row -> 4/14 = 28.6% >= 25% -> recovered!
    for (let h = 11; h <= 13; h++) {
      const r = judge.recordHand({
        clusterId: CLUSTER_A,
        poolSessionId: 's-rec',
        playerId: 'p1',
        handNumber: h,
        hadOpportunity: true,
        entered: true,
        policy,
      });
      expect(r.verdict).toBe('warn');
    }
    const rec = judge.recordHand({
      clusterId: CLUSTER_A,
      poolSessionId: 's-rec',
      playerId: 'p1',
      handNumber: 14,
      hadOpportunity: true,
      entered: true,
      policy,
    });
    expect(rec.verdict).toBe('recovered');
    expect(rec.warned).toBe(false);
    expect(rec.graceRemaining).toBeNull();

    // Exact 25% boundary at hand 16 (4/16 = 25.0%) passes without warning.
    for (let h = 15; h <= 16; h++) {
      const r = judge.recordHand({
        clusterId: CLUSTER_A,
        poolSessionId: 's-rec',
        playerId: 'p1',
        handNumber: h,
        hadOpportunity: true,
        entered: false,
        policy,
      });
      expect(r.verdict).toBe('ok');
      expect(r.vpipPct).toBe(h === 16 ? 25 : 26.7);
    }

    // Hand 17: drops to 4/17 = 23.5% < 25% -> fresh warning with full 10-hand grace!
    const lapse2 = judge.recordHand({
      clusterId: CLUSTER_A,
      poolSessionId: 's-rec',
      playerId: 'p1',
      handNumber: 17,
      hadOpportunity: true,
      entered: false,
      policy,
    });
    expect(lapse2.verdict).toBe('warn');
    expect(lapse2.warningOpened).toBe(true);
    expect(lapse2.graceRemaining).toBe(10);
  });

  it('rolling 30-hand window: old folds age out after 30 hands so an active player recovers cleanly', () => {
    const judge = new LightningPoolVpipJudge({ enabled: () => true });
    // Build a 30-hand sequence where hands 1..10 are folds, and hands 11..30 contain 7 VPIPs:
    // Hands 1..9: folds (grace). Hand 10: fold -> warned (0/10).
    // Hands 11..14: 4 VPIPs -> recovers at hand 14 (4/14 = 28.6%).
    // Hands 15..29: 3 VPIPs (at 16, 20, 24) + 12 folds -> at hand 29: 7/29 = 24.1% (warned at 29).
    // Hand 30: fold -> rolling 30-hand window (hands 1..30) is 7/30 = 23.3% (still warned, graceRemaining 9).
    const vpipHands = new Set([11, 12, 13, 14, 16, 20, 24]);
    for (let h = 1; h <= 30; h++) {
      judge.recordHand({
        clusterId: CLUSTER_A,
        poolSessionId: 's-roll',
        playerId: 'p1',
        handNumber: h,
        hadOpportunity: true,
        entered: vpipHands.has(h),
        policy,
      });
    }
    const at30 = judge.getStatus('s-roll', policy)!;
    expect(at30.hands).toBe(30);
    expect(at30.vpipHands).toBe(7);
    expect(at30.vpipPct).toBe(23.3);
    expect(at30.warned).toBe(true);

    // Hand 31: player enters the pot. Hand 1 (which was a FOLD!) ages out of the 30-hand window!
    // Rolling window (hands 2..31) is now 8/30 = 26.7% >= 25% -> RECOVERED!
    const at31 = judge.recordHand({
      clusterId: CLUSTER_A,
      poolSessionId: 's-roll',
      playerId: 'p1',
      handNumber: 31,
      hadOpportunity: true,
      entered: true,
      policy,
    });
    expect(at31.hands).toBe(30);
    expect(at31.vpipHands).toBe(8);
    expect(at31.vpipPct).toBe(26.7);
    expect(at31.verdict).toBe('recovered');
    expect(at31.warned).toBe(false);
    expect(at31.graceRemaining).toBeNull();
  });

  it('deduplicates replayed hand numbers so a settlement retry never double-counts', () => {
    const judge = new LightningPoolVpipJudge({ enabled: () => true });
    const first = judge.recordHand({
      clusterId: CLUSTER_A,
      poolSessionId: 's-dup',
      playerId: 'p1',
      handNumber: 500,
      hadOpportunity: true,
      entered: false,
      policy,
    });
    const replay = judge.recordHand({
      clusterId: CLUSTER_A,
      poolSessionId: 's-dup',
      playerId: 'p1',
      handNumber: 500,
      hadOpportunity: true,
      entered: false,
      policy,
    });
    expect(first.hands).toBe(1);
    expect(replay.verdict).toBe('duplicate');
    expect(replay.hands).toBe(1);
  });

  it('handles deferred evictions without burning retry budget and caps failed attempts', async () => {
    const outcomes: Array<'deferred' | 'failed' | 'evicted'> = [
      'deferred',
      'deferred',
      'failed',
      'evicted',
    ];
    const evictHandler = vi.fn(async () => outcomes.shift()!);
    const judge = new LightningPoolVpipJudge({ enabled: () => true, evictHandler });
    for (let h = 1; h <= 20; h++) {
      judge.recordHand({
        clusterId: CLUSTER_A,
        poolSessionId: 's-defer',
        playerId: 'p1',
        handNumber: h,
        hadOpportunity: true,
        entered: false,
        policy,
      });
    }
    const req = {
      clusterId: CLUSTER_A,
      hostTableId: HOST_TABLE,
      poolSessionId: 's-defer',
      playerId: 'p1',
      vpip: 0,
      required: 25,
      hands: 20,
      windowHands: 30,
      graceHands: 10,
    };
    expect(await judge.requestEviction(req)).toBe('deferred');
    expect(await judge.requestEviction(req)).toBe('deferred');
    expect(await judge.requestEviction(req)).toBe('failed');
    expect(await judge.requestEviction(req)).toBe('evicted');
    // Already evicted -> exhausted, never double-evicts.
    expect(await judge.requestEviction(req)).toBe('exhausted');
    expect(evictHandler).toHaveBeenCalledTimes(4);

    // Bounded retries on persistent failures.
    const failing = vi.fn(async () => 'failed' as const);
    const judge2 = new LightningPoolVpipJudge({ enabled: () => true, evictHandler: failing });
    for (let h = 1; h <= 20; h++) {
      judge2.recordHand({
        clusterId: CLUSTER_A,
        poolSessionId: 's-fail',
        playerId: 'p2',
        handNumber: h,
        hadOpportunity: true,
        entered: false,
        policy,
      });
    }
    const req2 = { ...req, poolSessionId: 's-fail', playerId: 'p2' };
    for (let i = 0; i < LIGHTNING_POOL_VPIP_MAX_EVICT_ATTEMPTS; i++) {
      expect(await judge2.requestEviction(req2)).toBe('failed');
    }
    expect(await judge2.requestEviction(req2)).toBe('exhausted');
    expect(failing).toHaveBeenCalledTimes(LIGHTNING_POOL_VPIP_MAX_EVICT_ATTEMPTS);
  });

  it('resets sample cleanly on leave/rejoin (new poolSessionId / resetSession) and pool switch-off (resetCluster)', () => {
    const judge = new LightningPoolVpipJudge({ enabled: () => true });
    for (let h = 1; h <= 15; h++) {
      judge.recordHand({
        clusterId: CLUSTER_A,
        poolSessionId: 's-old',
        playerId: 'p1',
        handNumber: h,
        hadOpportunity: true,
        entered: false,
        policy,
      });
      judge.recordHand({
        clusterId: CLUSTER_B,
        poolSessionId: 's-other-cluster',
        playerId: 'p2',
        handNumber: h,
        hadOpportunity: true,
        entered: false,
        policy,
      });
    }
    expect(judge.getStatus('s-old', policy)?.warned).toBe(true);

    // Leave & rejoin: old session cleared, new poolSessionId starts fresh in grace.
    expect(judge.resetSession('s-old')).toBe(true);
    expect(judge.getStatus('s-old', policy)).toBeNull();
    const rejoined = judge.recordHand({
      clusterId: CLUSTER_A,
      poolSessionId: 's-rejoined',
      playerId: 'p1',
      handNumber: 100,
      hadOpportunity: true,
      entered: false,
      policy,
    });
    expect(rejoined.verdict).toBe('grace');
    expect(rejoined.hands).toBe(1);
    expect(rejoined.warned).toBe(false);

    // Pool switch-off on CLUSTER_A resets CLUSTER_A only; CLUSTER_B is untouched.
    expect(judge.resetCluster(CLUSTER_A)).toBe(1);
    expect(judge.getStatus('s-rejoined', policy)).toBeNull();
    expect(judge.getStatus('s-other-cluster', policy)?.hands).toBe(15);
  });
});

describe('LightningHandHost end-to-end pool VPIP enforcement (humans and Horses symmetrically)', () => {
  const gs = (snap: LiveHorseDecisionSnapshot) => snap.gameState as unknown as { toCall: number };

  function foldingHorseLane() {
    let reqId = 0;
    const lane = {
      decideFast: vi.fn(async (snap: LiveHorseDecisionSnapshot) => ({
        type: 'FAST_RESULT',
        requestId: ++reqId,
        generation: snap.generation,
        fence: snap.fence,
        decision: {
          action: gs(snap).toCall > 0 ? 'fold' : 'check',
          thinkTime: 200,
        } as unknown as HorseDecision,
        planBinding: null,
        planIssueDisposition: 'no_effects',
        effects: [],
        rngBefore: 0,
        rngAfter: 0,
        computeMs: 1,
        governorScale: 1,
      })) as unknown as LiveHorseDecisionLane['decideFast'],
      commitDecisionEffects: vi.fn(async () => ({ type: 'ACK' }) as never),
      runWithDispatchBarrier: vi.fn(<T>(fn: () => T): T => fn()),
      observeCompletedHand: vi.fn(async () => ({ type: 'ACK' }) as never),
    };
    return lane as unknown as LiveHorseDecisionLane;
  }

  async function playFoldedHand(opts: {
    base: number;
    handOffset: number;
    judge: InstanceType<typeof LightningPoolVpipJudge>;
    rules: Record<string, unknown>;
    horseIndex: number;
    humanIndex: number;
  }) {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    // Use stable playerIds and poolSessionIds across hands for the same sitting,
    // while giving each hand its own handId and handNumber.
    const template = kit.formedHand(3, opts.base);
    const formed = {
      ...template,
      instanceId: kit.uid(opts.base + 500 + opts.handOffset),
      handId: kit.uid(opts.base + 700 + opts.handOffset),
    };
    const horseId = formed.players[opts.horseIndex];
    const humanId = formed.players[opts.humanIndex];
    const lane = foldingHorseLane();
    const released: string[] = [];

    const t = kit.buildHost(formed, [100, 100, 100], {
      horses: new Set([horseId]),
      rules: opts.rules,
      deps: {
        horseLane: () => lane,
        random: () => 0.5,
        vpipJudge: opts.judge,
        onPlayerReleased: (pid) => released.push(pid),
      },
    });
    // Give each hand a unique deterministic ascending handNumber and stable poolSessionIds per sitting.
    t.backend.nextHandNumber = async () => 2_000_000 + opts.handOffset;
    const originalLoadParticipants = t.backend.loadParticipants.bind(t.backend);
    t.backend.loadParticipants = async (hid, expected) => {
      const parts = await originalLoadParticipants(hid, expected);
      return parts.map((p, idx) => ({ ...p, poolSessionId: kit.uid(opts.base + 900 + idx) }));
    };

    await t.host.start();
    // Drive the hand: human folds/checks on turn, horse uses foldingHorseLane.
    for (let i = 0; i < 600 && t.host.lifecycle === 'dealing'; i++) {
      const st = t.host.peekState();
      if (st && st.currentPlayerSeat !== null) {
        const actor = st.players.find((p) => p.seat === st.currentPlayerSeat);
        if (actor && actor.user_id !== horseId) {
          const toCall = Math.max(0, st.currentBet - actor.bet);
          t.host.handlePlayerAction(actor.user_id, toCall > 0 ? 'fold' : 'check');
        }
      }
      await vi.advanceTimersByTimeAsync(250);
      await kit.flush(4);
    }
    expect(t.host.lifecycle).toBe('complete');
    // Chip conservation: every settled hand conserved 100% of chips.
    expect(t.calls.settle).toHaveLength(1);
    const totalAfter = t.calls.settle[0].results.reduce((s, r) => s + r.stackAfter, 0);
    expect(totalAfter + t.calls.settle[0].rake + t.calls.settle[0].bbj).toBeCloseTo(300, 2);

    const warnings = t.hub.frames.filter(
      (f) => f.kind === 'event' && f.payload?.type === 'lightning_vpip_warning'
    );
    return { t, horseId, humanId, warnings, released };
  }

  it('treats a human player and a Horse identically: silent under 10 hands, warns at hand 10, evicts cleanly between hands at hand 20', async () => {
    const evictions: Array<{
      playerId: string;
      poolSessionId: string;
      vpip: number;
      hands: number;
    }> = [];
    const judge = new LightningPoolVpipJudge({
      enabled: () => true,
      evictHandler: async (req) => {
        evictions.push({
          playerId: req.playerId,
          poolSessionId: req.poolSessionId,
          vpip: req.vpip,
          hands: req.hands,
        });
        return 'evicted';
      },
    });
    const floored = { nit_game: true, maintain_percent_min: 25 };

    // Seat 0 is BB (gets a walk when both seat 1 [SB] and seat 2 [BTN] fold!),
    // Seat 1 is SB (Horse -> folds every hand -> voluntary preflop opportunity),
    // Seat 2 is BTN (Human -> folds every hand -> voluntary preflop opportunity).
    // Notice this simultaneously proves:
    //   - BB's walk is EXCLUDED (0 warnings, 0 evictions for BB across all 20 hands!)
    //   - Both Human (BTN) and Horse (SB) are warned at hand 10 and evicted at hand 20!
    let humanId = '';
    let horseId = '';
    let bbId = '';

    for (let h = 1; h <= 9; h++) {
      const res = await playFoldedHand({
        base: 9100,
        handOffset: h,
        judge,
        rules: floored,
        horseIndex: 1,
        humanIndex: 2,
      });
      bbId = res.t.participants[0].playerId;
      horseId = res.horseId;
      humanId = res.humanId;
      expect(res.warnings).toHaveLength(0);
      expect(evictions).toHaveLength(0);
    }

    // Hand 10: BOTH human and Horse receive lightning_vpip_warning; BB does NOT (walk excluded); ZERO evictions!
    const hand10 = await playFoldedHand({
      base: 9100,
      handOffset: 10,
      judge,
      rules: floored,
      horseIndex: 1,
      humanIndex: 2,
    });
    const warnedIds = hand10.warnings.map((w) => w.payload.player_id).sort();
    expect(warnedIds).toEqual([horseId, humanId].sort());
    expect(warnedIds).not.toContain(bbId);
    for (const w of hand10.warnings) {
      expect(w.payload).toMatchObject({
        type: 'lightning_vpip_warning',
        required: 25,
        hands: 10,
        window_hands: 30,
        grace_hands: 10,
        grace_remaining: 10,
        warning_opened: true,
      });
    }
    expect(evictions).toHaveLength(0);

    // Hands 11..19: still within 10-hand grace -> zero evictions.
    for (let h = 11; h <= 19; h++) {
      await playFoldedHand({
        base: 9100,
        handOffset: h,
        judge,
        rules: floored,
        horseIndex: 1,
        humanIndex: 2,
      });
      expect(evictions).toHaveLength(0);
    }

    // Hand 20: grace exhausted -> BOTH human and Horse are evicted cleanly AFTER settlement!
    await playFoldedHand({
      base: 9100,
      handOffset: 20,
      judge,
      rules: floored,
      horseIndex: 1,
      humanIndex: 2,
    });
    expect(evictions.map((e) => e.playerId).sort()).toEqual([horseId, humanId].sort());
    expect(evictions.every((e) => e.vpip === 0 && e.hands === 20)).toBe(true);
    // BB had 20 walks and ZERO voluntary preflop action opportunities -> never warned, never evicted!
    expect(
      judge.getStatus(kit.uid(9100 + 900 + 0), DEFAULT_LIGHTNING_POOL_VPIP_POLICY)?.hands
    ).toBe(0);
  });

  it('an abandoned hand is never recorded in the judge and never warns or evicts', async () => {
    const judge = new LightningPoolVpipJudge({ enabled: () => true });
    const formed = kit.formedHand(2, 9400);
    const t = kit.buildHost(formed, [100, 100], {
      lease: () => null,
      rules: { nit_game: true, maintain_percent_min: 25 },
      deps: { vpipJudge: judge },
    });
    await t.host.start();
    expect(t.host.lifecycle).toBe('abandoned');
    expect(judge.size()).toBe(0);
  });
});

describe('LightningSupervisor and LightningRegistry reset hooks', () => {
  it('LightningSupervisor resets the cluster VPIP sample when a pool switches off or stops', async () => {
    const judge = new LightningPoolVpipJudge({ enabled: () => true });
    for (let h = 1; h <= 15; h++) {
      judge.recordHand({
        clusterId: CLUSTER_A,
        poolSessionId: 's-switch-off',
        playerId: 'p1',
        handNumber: h,
        hadOpportunity: true,
        entered: false,
        policy: DEFAULT_LIGHTNING_POOL_VPIP_POLICY,
      });
    }
    expect(judge.getStatus('s-switch-off')?.warned).toBe(true);

    let clusters: string[] = [CLUSTER_A];
    const fakeWorker = {
      isRunning: true,
      mode: 'form' as const,
      currentHold: null,
      currentConfig: { workerMode: 'form' } as never,
      start: vi.fn(),
      stop: vi.fn(async () => undefined),
      updateConfig: vi.fn(),
      setHold: vi.fn(),
      setDraining: vi.fn(),
    };
    const supervisor = new LightningSupervisor({
      presenceSource: () => [],
      discover: async () => clusters,
      rpc: async () => ({ data: { worker_mode: 'form' }, error: null }),
      createWorker: () => fakeWorker as never,
      vpipJudge: judge,
    });

    // Starting the pool clears any stale sample from a prior run.
    supervisor.start();
    await supervisor.reconcile();
    expect(judge.getStatus('s-switch-off')).toBeNull();

    // Accumulate 15 folds while live, then switch the pool off (leaves discovery).
    for (let h = 1; h <= 15; h++) {
      judge.recordHand({
        clusterId: CLUSTER_A,
        poolSessionId: 's-live',
        playerId: 'p1',
        handNumber: h,
        hadOpportunity: true,
        entered: false,
        policy: DEFAULT_LIGHTNING_POOL_VPIP_POLICY,
      });
    }
    expect(judge.getStatus('s-live')?.hands).toBe(15);

    clusters = [];
    await supervisor.reconcile();
    expect(judge.getStatus('s-live')).toBeNull();
    await supervisor.stop();
  });

  it('LightningRegistry clears a session sample when its ended room closes', async () => {
    const judge = new LightningPoolVpipJudge({ enabled: () => true });
    const roomId = '44444444-4444-4444-8444-444444444444';
    const userId = '55555555-5555-4555-8555-555555555555';
    judge.recordHand({
      clusterId: CLUSTER_A,
      poolSessionId: roomId,
      playerId: userId,
      handNumber: 1,
      hadOpportunity: true,
      entered: false,
      policy: DEFAULT_LIGHTNING_POOL_VPIP_POLICY,
    });
    expect(judge.getStatus(roomId)?.hands).toBe(1);

    let allowed = true;
    const registry = new LightningRegistry({
      viewAccess: async () => allowed,
      roomOwner: async () => ({ playerId: userId, clusterId: CLUSTER_A }),
      clusterMode: async () => 'lightning',
      closeRoom: vi.fn(),
      vpipJudge: judge,
    });
    await registry.authorize(roomId, userId);
    registry.connect(roomId, userId);
    allowed = false;
    const closed = await registry.sweepEndedRooms();
    expect(closed).toBe(1);
    expect(judge.getStatus(roomId)).toBeNull();
  });
});
