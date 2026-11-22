/**
 * LAW: OPPONENT HUD SUPPORTS 'nlh' ALONGSIDE 'plo4' AND 'plo5' WITH ZERO HOLE-CARD LEAKAGE AND ZERO DECISION CHANGE
 * (2026-11-22, Horse SWITCH Wave 2 Enhancement 2.1).
 *
 *  1. HUD_FAMILIES includes 'plo4', 'plo5', and 'nlh'; familyForVariant maps them canonically and rejects unsupported
 *     variants (plo6, plo8, flh, flo8, short_deck, pineapple, holdem). Double-board bomb pots remain refused.
 *  2. NLH cash, NLH tournament, and NLH Lightning hands extract exact public-only counts (f.fb.sm.hu, t.fb.sm.hu,
 *     r.fRaise, vs.r.lead.sm/bg, f/t/r.betCk) with zero dealt hole-card leakage; mucked showdowns reveal nothing.
 *  3. OpponentHudStore warms, catches up, updates, persists, reconciles, and packages 'nlh' profiles cleanly alongside
 *     'plo4' and 'plo5' with strict cross-family isolation.
 *  4. PLO4 and PLO5 extraction, digests, and profiles remain 100% preserved.
 *  5. Installing an 'nlh' OpponentHudPacket changes ZERO live Horse decisions (HorseMind.opponentRead is identical).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  HUD_FAMILIES,
  applyHudHand,
  emptyHudProfile,
  extractHandDeltas,
  familyForVariant,
  handRecordFromRow,
  hudHandDigest,
  isHudFamily,
  validHudProfile,
  type HudFamily,
  type HudHandRecord,
} from './OpponentHudProfile.js';
import {
  buildHudPacket,
  clearDecisionHud,
  hudLifetimeCount,
  hudStat,
  hudStatIn,
  installDecisionHud,
  validHudPacket,
} from './OpponentHud.js';
import { OpponentHudAsOf } from './OpponentHudAsOf.js';
import {
  OpponentHudStore,
  type HudStoredRow,
  type OpponentHudStoreDeps,
} from '../../services/OpponentHudStore.js';
import { HorseMind } from '../HorseMind.js';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = 1_800_000_000_000;
const CARD = /\b([2-9TJQKA][shdc])\b|hearts|spades|diamonds|clubs/i;

type Act = [
  stage: 'preflop' | 'flop' | 'turn' | 'river',
  seat: number,
  action: string,
  amount: number,
];

function makeRow(opts: {
  id: number;
  variant?: string;
  tournamentId?: string | null;
  at?: number;
  bb?: number;
  seats?: [seat: number, user: number, stack?: number][];
  acts: Act[];
  board?: string[];
  showdown?: [seat: number, user: number, mucked: boolean, handName: string | null][];
  winners?: [user: number, amount: number][];
  extra?: Record<string, unknown>;
}) {
  const seats = opts.seats ?? [
    [1, 1, 400],
    [2, 2, 400],
  ];
  const atIso = new Date(opts.at ?? T0 + opts.id * 60_000).toISOString();
  return {
    id: H(opts.id),
    created_at: atIso,
    ended_at: atIso,
    game_variant: opts.variant ?? 'nlh',
    tournament_id: opts.tournamentId ?? null,
    big_blind: opts.bb ?? 2,
    button_seat: seats[0][0],
    players: seats.map(([seat, user, stack]) => ({
      seat,
      userId: U(user),
      username: `p${user}`,
      stack: stack ?? 400,
      cards: seat === 1 ? ['As', 'Kh'] : ['2c', '7d'],
    })),
    hole_cards: { [U(seats[0][1])]: ['As', 'Kh'], [U(seats[1][1])]: ['2c', '7d'] },
    actions: opts.acts.map(([stage, seat, action, amount]) => {
      const user = seats.find((s) => s[0] === seat)?.[1];
      return { seat, userId: user ? U(user) : null, stage, action, amount };
    }),
    community_cards: opts.board ?? ['9h', '8d', '3s', 'Qc', '4h'],
    showdown: (opts.showdown ?? []).map(([seat, user, mucked, handName], i) => ({
      seat,
      user_id: U(user),
      mucked,
      hand_name: handName,
      reveal_order: i,
    })),
    winners: (opts.winners ?? [[seats[0][1], 20]]).map(([user, amount]) => ({
      userId: U(user),
      amount,
    })),
    ...opts.extra,
  };
}

const flush = async (n = 12) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
  clearDecisionHud();
});

describe('law: NLH family registration, canonical mapping, and scope boundaries', () => {
  it('registers plo4, plo5, and nlh; rejects unsupported variants and double-board bomb pots', () => {
    expect([...HUD_FAMILIES]).toEqual(['plo4', 'plo5', 'nlh']);
    expect(familyForVariant('nlh')).toBe('nlh');
    expect(familyForVariant('NLH')).toBe('nlh');
    expect(familyForVariant('plo4')).toBe('plo4');
    expect(familyForVariant('plo5')).toBe('plo5');
    for (const bad of [
      'plo6',
      'plo8',
      'flh',
      'flo8',
      'short_deck',
      'pineapple',
      'holdem',
      'nlhe',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(familyForVariant(bad)).toBeNull();
    }
    expect(isHudFamily('nlh')).toBe(true);
    expect(isHudFamily('plo4')).toBe(true);
    expect(isHudFamily('plo5')).toBe(true);
    expect(isHudFamily('NLH')).toBe(false);
    expect(isHudFamily('plo6')).toBe(false);

    const baseActs: Act[] = [
      ['preflop', 1, 'sb', 1],
      ['preflop', 2, 'bb', 2],
      ['preflop', 1, 'raise', 6],
      ['preflop', 2, 'fold', 0],
    ];
    for (const unsupported of ['plo6', 'plo8', 'flh', 'flo8', 'short_deck', 'pineapple']) {
      expect(handRecordFromRow(makeRow({ id: 1, variant: unsupported, acts: baseActs }))).toBe(
        'not_plo45'
      );
    }
    expect(
      handRecordFromRow(
        makeRow({ id: 2, variant: 'nlh', acts: baseActs, extra: { community_cards2: ['Ah'] } })
      )
    ).toBe('multi_board');
    expect(
      handRecordFromRow(
        makeRow({
          id: 3,
          variant: 'nlh',
          acts: baseActs,
          extra: { bomb_pot: { ante_amount: 2, board_count: 2 } },
        })
      )
    ).toBe('multi_board');
  });
});

describe('law: NLH cash, tournament, and Lightning extract exact public-only counts with zero hole-card leakage', () => {
  it('extracts f.fb.sm.hu, t.fb.sm.hu, r.fRaise, vs.r.lead.*, and f/t/r.betCk with zero card leakage', () => {
    // Hand 1 (NLH cash): pot after preflop = 12. Flop: seat 2 checks, seat 1 bets 4 (0.33 pot -> sm), seat 2 folds -> f.fb.sm.hu [1,1], f.betCk
    const h1 = makeRow({
      id: 10,
      acts: [
        ['preflop', 1, 'sb', 1],
        ['preflop', 2, 'bb', 2],
        ['preflop', 1, 'raise', 6],
        ['preflop', 2, 'call', 4],
        ['flop', 2, 'check', 0],
        ['flop', 1, 'bet', 4],
        ['flop', 2, 'fold', 0],
      ],
      board: ['9h', '8d', '3s'],
    });
    // Hand 2 (NLH cash): flop check/check; turn: seat 2 checks, seat 1 bets 4 into 12 (0.33 pot -> sm), seat 2 folds -> t.fb.sm.hu [1,1], t.betCk
    const h2 = makeRow({
      id: 11,
      acts: [
        ['preflop', 1, 'sb', 1],
        ['preflop', 2, 'bb', 2],
        ['preflop', 1, 'raise', 6],
        ['preflop', 2, 'call', 4],
        ['flop', 2, 'check', 0],
        ['flop', 1, 'check', 0],
        ['turn', 2, 'check', 0],
        ['turn', 1, 'bet', 4],
        ['turn', 2, 'fold', 0],
      ],
      board: ['9h', '8d', '3s', 'Qc'],
    });
    // Hand 3 (NLH cash): river lead small (4 into 12 = 0.33) by seat 2, raised to 16 by seat 1, seat 2 folds -> r.fRaise [1,1], r.betCk
    const h3 = makeRow({
      id: 12,
      acts: [
        ['preflop', 1, 'sb', 1],
        ['preflop', 2, 'bb', 2],
        ['preflop', 1, 'raise', 6],
        ['preflop', 2, 'call', 4],
        ['flop', 2, 'check', 0],
        ['flop', 1, 'check', 0],
        ['turn', 2, 'check', 0],
        ['turn', 1, 'check', 0],
        ['river', 2, 'bet', 4],
        ['river', 1, 'raise', 16],
        ['river', 2, 'fold', 0],
      ],
    });
    // Hand 4 (NLH cash showdown): river lead small (4 into 12) by seat 2 called by seat 1; seat 2 shows Straight -> vs.r.lead.sm [1,1]
    const h4 = makeRow({
      id: 13,
      acts: [
        ['preflop', 1, 'sb', 1],
        ['preflop', 2, 'bb', 2],
        ['preflop', 1, 'raise', 6],
        ['preflop', 2, 'call', 4],
        ['flop', 2, 'check', 0],
        ['flop', 1, 'check', 0],
        ['turn', 2, 'check', 0],
        ['turn', 1, 'check', 0],
        ['river', 2, 'bet', 4],
        ['river', 1, 'call', 4],
      ],
      showdown: [
        [2, 2, false, 'Straight'],
        [1, 1, false, 'Pair'],
      ],
      winners: [[2, 20]],
    });
    // Hand 5 (NLH cash showdown): river lead big (12 into 12 = 1.0 pot) by seat 2 called by seat 1; seat 2 shows Pair -> vs.r.lead.bg [1,0]
    const h5 = makeRow({
      id: 14,
      acts: [
        ['preflop', 1, 'sb', 1],
        ['preflop', 2, 'bb', 2],
        ['preflop', 1, 'raise', 6],
        ['preflop', 2, 'call', 4],
        ['flop', 2, 'check', 0],
        ['flop', 1, 'check', 0],
        ['turn', 2, 'check', 0],
        ['turn', 1, 'check', 0],
        ['river', 2, 'bet', 12],
        ['river', 1, 'call', 12],
      ],
      showdown: [
        [2, 2, false, 'Pair'],
        [1, 1, false, 'Two Pair'],
      ],
      winners: [[1, 36]],
    });
    // Hand 6 (NLH cash mucked showdown): seat 2 leads big and mucks -> must NOT add to vs.r.lead.bg
    const h6 = makeRow({
      id: 15,
      acts: [
        ['preflop', 1, 'sb', 1],
        ['preflop', 2, 'bb', 2],
        ['preflop', 1, 'raise', 6],
        ['preflop', 2, 'call', 4],
        ['flop', 2, 'check', 0],
        ['flop', 1, 'check', 0],
        ['turn', 2, 'check', 0],
        ['turn', 1, 'check', 0],
        ['river', 2, 'bet', 12],
        ['river', 1, 'call', 12],
      ],
      showdown: [
        [2, 2, true, 'Full House'],
        [1, 1, false, 'Two Pair'],
      ],
      winners: [[1, 36]],
    });

    const p1 = emptyHudProfile(U(1), 'nlh');
    const p2 = emptyHudProfile(U(2), 'nlh');
    for (const raw of [h1, h2, h3, h4, h5, h6]) {
      const rec = handRecordFromRow(raw) as HudHandRecord;
      expect(typeof rec).toBe('object');
      expect(rec.family).toBe('nlh');
      const recJson = JSON.stringify(rec);
      expect(recJson).not.toMatch(/"cards"|hole_cards/);
      const nonBoard = recJson.replace(JSON.stringify(rec.board), '');
      expect(nonBoard).not.toMatch(CARD);
      expect(applyHudHand(p1, rec)).toBeNull();
      expect(applyHudHand(p2, rec)).toBeNull();
    }

    expect(JSON.stringify(p1)).not.toMatch(CARD);
    expect(JSON.stringify(p2)).not.toMatch(CARD);
    expect(validHudProfile(p1)).toBe(true);
    expect(validHudProfile(p2)).toBe(true);

    // Seat 2 (responder on flop/turn, river bettor facing raise & leading to showdown)
    expect(p2.life['f.fb.sm.hu']).toEqual([1, 1]);
    expect(p2.life['t.fb.sm.hu']).toEqual([1, 1]);
    expect(p2.life['r.fRaise']).toEqual([1, 1]);
    expect(p2.life['vs.r.lead.sm']).toEqual([1, 1]);
    expect(p2.life['vs.r.lead.bg']).toEqual([1, 0]); // mucked h6 did NOT leak!
    expect(p2.life['f.betCk']).toEqual([6, 0]);
    expect(p2.life['t.betCk']).toEqual([5, 0]);
    expect(p2.life['r.betCk']).toEqual([4, 4]);

    // Seat 1 (bettor on flop/turn)
    expect(p1.life['f.betCk']).toEqual([6, 1]);
    expect(p1.life['t.betCk']).toEqual([5, 1]);

    // Packet validation & accessor reads for 'nlh'
    const pk = buildHudPacket('nlh', [p1, p2], { 'f.fb.sm.hu': [0.35, 20] }, T0 + 1e7, 'flop');
    expect(validHudPacket(pk)).toBe(true);
    installDecisionHud(pk);
    expect(
      hudLifetimeCount(U(2), 'nlh', 'x.foldToBet.small', { street: 'flop', players: 'hu' })
    ).toEqual({
      n: 1,
      hits: 1,
      stat: 'f.fb.sm.hu',
    });
    expect(
      hudStatIn(
        U(2),
        'nlh',
        'x.valueShare',
        { street: 'river', line: 'lead', size: 'small' },
        0.5,
        false
      ).source
    ).toBe('lifetime');
    // Cross-family read returns prior, never leaks 'nlh' into 'plo5'
    expect(hudStat(U(2), 'plo5', 'f.fb.sm.hu', 0.35, false)).toMatchObject({
      source: 'prior',
      n: 0,
      p: 0.35,
    });
  });

  it('counts NLH tournament and NLH Lightning hands cleanly through OpponentHudStore and OpponentHudAsOf', async () => {
    const stored = new Map<string, HudStoredRow>();
    stored.set('nlh|*', {
      user_id: '*',
      family: 'nlh',
      version: 1,
      hands: 0,
      wm_ms: T0,
      profile: {
        family: { 'f.fb.sm.hu': [0.38, 20] },
        stakes: { b5: { 'f.fb.sm.hu': [0.55, 500] } },
      },
    });
    const history: ReturnType<typeof makeRow>[] = [];
    const deps: OpponentHudStoreDeps = {
      async read(ids, family) {
        return ids.flatMap((u) => {
          const r = stored.get(`${family}|${u}`);
          return r ? [structuredClone(r)] : [];
        });
      },
      async recent(family) {
        return [...stored.values()]
          .filter((r) => r.family === family)
          .map((r) => structuredClone(r));
      },
      async upsert(rows) {
        const refused: string[] = [];
        for (const r of rows as (HudStoredRow & { base_rev?: number })[]) {
          const k = `${r.family}|${r.user_id}`;
          const cur = stored.get(k);
          const special = r.user_id === '*' || r.user_id === '#sync';
          if (!special && (r.base_rev ?? -1) !== (cur?.rev ?? 0)) refused.push(k);
          else stored.set(k, { ...structuredClone(r), rev: (cur?.rev ?? 0) + 1 });
        }
        return refused;
      },
      async handsPage(afterAt, afterId, limit, _sig, until) {
        return history
          .filter(
            (h) =>
              (h.created_at > afterAt || (h.created_at === afterAt && h.id > afterId)) &&
              (!until || h.created_at <= until)
          )
          .slice(0, limit)
          .map((h) => structuredClone(h));
      },
      now: () => T0 + 10 * 60_000,
      sleep: async () => undefined,
    };

    const tourneyRow = makeRow({
      id: 20,
      variant: 'nlh',
      tournamentId: H(999),
      bb: 400,
      at: T0 + 60_000,
      acts: [
        ['preflop', 1, 'sb', 200],
        ['preflop', 2, 'bb', 400],
        ['preflop', 1, 'raise', 1000],
        ['preflop', 2, 'call', 600],
        ['flop', 2, 'check', 0],
        ['flop', 1, 'bet', 600],
        ['flop', 2, 'fold', 0],
      ],
      board: ['Ah', '7d', '2c'],
    });
    // Lightning shape (ended_at, no created_at until settlement)
    const lightningRow = {
      ...makeRow({
        id: 21,
        variant: 'nlh',
        bb: 2,
        at: T0 + 120_000,
        acts: [
          ['preflop', 1, 'sb', 1],
          ['preflop', 2, 'bb', 2],
          ['preflop', 1, 'raise', 6],
          ['preflop', 2, 'call', 4],
          ['flop', 2, 'check', 0],
          ['flop', 1, 'bet', 4],
          ['flop', 2, 'fold', 0],
        ],
        board: ['Kh', '7d', '2c'],
      }),
    };
    const plo5Row = makeRow({
      id: 22,
      variant: 'plo5',
      bb: 2,
      at: T0 + 180_000,
      acts: [
        ['preflop', 1, 'sb', 1],
        ['preflop', 2, 'bb', 2],
        ['preflop', 1, 'raise', 6],
        ['preflop', 2, 'fold', 0],
      ],
    });
    history.push(tourneyRow, plo5Row);

    const store = new OpponentHudStore(deps);
    store.setArmed(true);
    for (let i = 0; i < 40 && !store.lastActivation; i++) await flush(2);
    expect(store.lastActivation).toMatchObject({ applied: 4, capped: false });
    expect(store.profile(U(2), 'nlh')!.hands).toBe(1);
    expect(store.profile(U(2), 'nlh')!.life['f.fb.sm.hu']).toEqual([1, 1]);
    expect(store.profile(U(2), 'plo5')!.hands).toBe(1);
    expect(store.profile(U(2), 'plo5')!.life['f.fb.sm.hu']).toBeUndefined();

    // Lightning NLH warm + onAcceptedHand (once-only)
    store.warm([U(1), U(2)], 'nlh', 'lightning');
    await flush();
    expect(store.onAcceptedHand(lightningRow)).toBe(2);
    expect(store.onAcceptedHand(lightningRow)).toBe(0);
    expect(store.profile(U(2), 'nlh')!.hands).toBe(2);
    expect(store.profile(U(2), 'nlh')!.life['f.fb.sm.hu']).toEqual([2, 2]);
    // Tournament NLH packet uses family prior (0.38), NOT stake band b5 (0.55); cash bb=5 uses b5 (0.55)
    const tourneyPk = store.packetFor({
      family: 'nlh',
      cash: false,
      heroId: U(1),
      opponentIds: [U(2)],
      street: 'flop',
      atMs: T0 + 180_000,
      bigBlind: 400,
    }).opponentHud!;
    expect(tourneyPk.family).toBe('nlh');
    expect(tourneyPk.pri['f.fb.sm.hu']).toEqual([0.38, 20]);
    expect(tourneyPk.opp[U(2)].hands).toBe(2);
    const cashPk = store.packetFor({
      family: 'nlh',
      cash: true,
      heroId: U(1),
      opponentIds: [U(2)],
      street: 'flop',
      atMs: T0 + 180_000,
      bigBlind: 5,
    }).opponentHud!;
    expect(cashPk.pri['f.fb.sm.hu']).toEqual([0.55, 20]);

    // Persist writes nlh rows with family='nlh'
    await store.persist();
    expect(stored.get(`nlh|${U(2)}`)!.hands).toBe(2);
    expect(stored.get(`plo5|${U(2)}`)!.hands).toBe(1);

    // OpponentHudAsOf builds identical strict-before counts for NLH
    const asOf = new OpponentHudAsOf([tourneyRow, lightningRow, plo5Row]);
    expect(asOf.countsBefore(H(21), 'nlh', [U(2)], ['f.fb.sm.hu'])).toEqual({
      [U(2)]: { 'f.fb.sm.hu': [1, 1] },
    });
  });
});

describe('law: PLO4 and PLO5 remain 100% preserved and an NLH packet changes no live decision', () => {
  it('PLO4, PLO5, and NLH produce identical digests for identical public action histories and never mix families', () => {
    const acts: Act[] = [
      ['preflop', 1, 'sb', 1],
      ['preflop', 2, 'bb', 2],
      ['preflop', 1, 'raise', 6],
      ['preflop', 2, 'call', 4],
      ['flop', 2, 'check', 0],
      ['flop', 1, 'bet', 4],
      ['flop', 2, 'call', 4],
      ['turn', 2, 'check', 0],
      ['turn', 1, 'bet', 10],
      ['turn', 2, 'fold', 0],
    ];
    const digests: Record<HudFamily, number> = {} as Record<HudFamily, number>;
    for (const fam of HUD_FAMILIES) {
      const rec = handRecordFromRow(makeRow({ id: 30, variant: fam, acts })) as HudHandRecord;
      expect(rec.family).toBe(fam);
      const deltas = extractHandDeltas(rec);
      digests[fam] = hudHandDigest(U(2), rec, deltas)!;
      const p = emptyHudProfile(U(2), fam);
      expect(applyHudHand(p, rec)).toBeNull();
      // Refuses wrong family
      const other: HudFamily = fam === 'nlh' ? 'plo5' : 'nlh';
      expect(applyHudHand(emptyHudProfile(U(2), other), rec)).toBe('family');
    }
    expect(digests.plo4).toBe(digests.plo5);
    expect(digests.nlh).toBe(digests.plo5);
  });

  it('installing an NLH lifetime packet changes no Holdem opponentRead in HorseMind', () => {
    const OPP = '50000000-0000-4000-8000-0000000000c2';
    HorseMind.setDecisionScope('holdem:full', 'nlh', 'cash');
    const before = HorseMind.opponentRead(OPP);
    const p = emptyHudProfile(OPP, 'nlh');
    p.hands = 300;
    p.life['pf.vpip'] = [300, 290];
    p.life['pf.pfr'] = [300, 10];
    p.life['f.fb.sm.hu'] = [100, 95];
    installDecisionHud(buildHudPacket('nlh', [p], {}, 1_800_000_000_000, 'flop'));
    expect(HorseMind.opponentRead(OPP)).toEqual(before);
  });
});
