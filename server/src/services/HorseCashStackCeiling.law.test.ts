/**
 * LAW: THE HORSE CASH STACK CEILING (runtime setting horse.cashStackCeilingBB, compiled default 0 = off).
 *
 * 1. OFF IS IDENTICAL: at the compiled default every bank-the-win verdict (table and Lightning), every buy-in and
 *    every fleet admission is exactly what it was.
 * 2. PLO4/PLO5 CASH ONLY: PLO6, PLO8, hold'em and tournaments get no ceiling at any value.
 * 3. A ceiling exit is the existing exit: before the next big blind, after the orbit owed for a big pot, through
 *    the ordinary voluntary door (no rathole), and never when it would thin the game.
 * 4. NO RATHOLE BOTH WAYS: a Horse whose floor in a game is above the ceiling is not a buyer there.
 * 5. A table model run with the real verdict functions keeps every table running with the same Horse seat-hands.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { sliceEnclosingBlock, sliceMethod } from '../testHelpers/sourceWindow.js';
import {
  HORSE_CASH_STACK_CEILING_COMPILED_BB,
  HORSE_CASH_STACK_CEILING_KEY,
  ceilingExitKeepsTheGame,
  horseCashStackCeilingChips,
  isStackCeilingVariant,
  rejoinFloorIsAboveCeiling,
  stackIsAboveCeiling,
} from './HorseCashStackCeiling.js';
import { bankTheWinMultiple, shouldBankTheWin } from './HorseBankTheWin.js';
import {
  decideLightningBankTheWin,
  noteLightningHandForBankTheWin,
  onLightningBankTheWin,
  resetLightningBankTheWin,
  type LightningBankReading,
} from '../lightning/LightningBankTheWin.js';
import { horseCashStackCeilingBBFrom } from '../engine/runtimeSettings/apply.js';
import { RUNTIME_SETTINGS_REGISTRY } from '../engine/runtimeSettings/registry.js';
import {
  COMPILED_RUNTIME_SETTINGS,
  parseRuntimeSettings,
} from '../engine/runtimeSettings/snapshot.js';

const src = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const VARIANTS = ['nlh', 'plo4', 'plo5', 'plo6', 'plo8', 'short_deck', 'pineapple', 'flh', 'flo8'];

/** Deterministic generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

afterEach(() => resetLightningBankTheWin());

describe('the setting', () => {
  it('is registered, a whole number of big blinds, and off by default', () => {
    const spec = RUNTIME_SETTINGS_REGISTRY.find((s) => s.key === HORSE_CASH_STACK_CEILING_KEY);
    expect(spec).toBeDefined();
    expect(spec!.kind).toBe('integer');
    expect(spec!.compiledDefault).toBe(HORSE_CASH_STACK_CEILING_COMPILED_BB);
    expect(HORSE_CASH_STACK_CEILING_COMPILED_BB).toBe(0);
    expect(horseCashStackCeilingBBFrom(COMPILED_RUNTIME_SETTINGS)).toBe(0);
    expect(horseCashStackCeilingBBFrom(undefined)).toBe(0);
  });

  it('a published value reaches the reader, and a version without the key stays off', () => {
    const on = parseRuntimeSettings({
      version: 7,
      settings: { [HORSE_CASH_STACK_CEILING_KEY]: 250 },
    });
    expect(on.ok && horseCashStackCeilingBBFrom(on.snapshot)).toBe(250);
    const without = parseRuntimeSettings({
      version: 8,
      settings: { 'horse.v65TurnShadeCap': 0.12 },
    });
    expect(without.ok && horseCashStackCeilingBBFrom(without.snapshot)).toBe(0);
    expect(
      parseRuntimeSettings({ version: 9, settings: { [HORSE_CASH_STACK_CEILING_KEY]: 250.5 } }).ok
    ).toBe(false);
    expect(
      parseRuntimeSettings({ version: 9, settings: { [HORSE_CASH_STACK_CEILING_KEY]: -1 } }).ok
    ).toBe(false);
  });
});

describe('scope: PLO4 and PLO5 cash only', () => {
  it('off gives no ceiling in any game', () => {
    for (const variant of VARIANTS)
      for (const ceilingBB of [0, undefined, null, NaN, -5])
        expect(
          horseCashStackCeilingChips({ ceilingBB, variant, bigBlind: 2, maxBuyIn: 400 })
        ).toBeNull();
  });

  it("on gives a ceiling at PLO4 and PLO5 cash and nowhere else (PLO6, PLO8 and hold'em are untouched)", () => {
    for (const variant of VARIANTS) {
      const chips = horseCashStackCeilingChips({
        ceilingBB: 250,
        variant,
        bigBlind: 2,
        maxBuyIn: 400,
      });
      if (variant === 'plo4' || variant === 'plo5') expect(chips).toBe(500);
      else expect(chips, variant).toBeNull();
      expect(isStackCeilingVariant(variant)).toBe(variant === 'plo4' || variant === 'plo5');
    }
    for (const variant of ['plo4', 'plo5'])
      expect(
        horseCashStackCeilingChips({
          ceilingBB: 250,
          variant,
          bigBlind: 2,
          maxBuyIn: 400,
          isTournament: true,
        })
      ).toBeNull();
    expect(horseCashStackCeilingChips({ ceilingBB: 250, variant: 'plo5', bigBlind: 0 })).toBeNull();
    expect(horseCashStackCeilingChips({ ceilingBB: 250, variant: 6, bigBlind: 2 })).toBeNull();
  });

  it('is never below the table maximum buy-in: a Horse on a normal buy-in is never over it', () => {
    expect(
      horseCashStackCeilingChips({ ceilingBB: 150, variant: 'plo5', bigBlind: 2, maxBuyIn: 400 })
    ).toBe(400);
    expect(
      horseCashStackCeilingChips({ ceilingBB: 250, variant: 'plo5', bigBlind: 2, maxBuyIn: 1000 })
    ).toBe(1000);
    expect(stackIsAboveCeiling(400, 400)).toBe(false);
    expect(stackIsAboveCeiling(400.01, 400)).toBe(true);
    expect(stackIsAboveCeiling(9999, null)).toBe(false);
  });
});

describe('the table exit', () => {
  const base = {
    horseId: 'horse-ceiling-1',
    startingStack: 400,
    handsSinceBigPot: undefined as number | undefined,
    playersAtTable: 6,
    nextHandIsBigBlind: true,
  };

  it('off is identical: without a ceiling every verdict is the owner line alone', () => {
    const r = rng(11);
    for (let i = 0; i < 5000; i++) {
      const o = {
        horseId: `h-${Math.floor(r() * 50)}`,
        stack: Math.round(r() * 300000) / 100,
        startingStack: [0, 100, 400, 1000][Math.floor(r() * 4)]!,
        handsSinceBigPot: r() < 0.5 ? undefined : Math.floor(r() * 9),
        playersAtTable: 2 + Math.floor(r() * 8),
        nextHandIsBigBlind: r() < 0.5,
      };
      const line =
        o.startingStack > 0 && o.stack >= bankTheWinMultiple(o.horseId) * o.startingStack;
      const orbit = Math.max(2, o.playersAtTable);
      const owed = o.handsSinceBigPot === undefined ? 0 : Math.max(0, orbit - o.handsSinceBigPot);
      const expected = o.nextHandIsBigBlind && line && owed === 0;
      expect(shouldBankTheWin(o)).toBe(expected);
      expect(shouldBankTheWin({ ...o, stackCeiling: null })).toBe(expected);
      expect(shouldBankTheWin({ ...o, stackCeiling: undefined })).toBe(expected);
    }
  });

  it('above the ceiling it leaves before its next big blind, and not otherwise', () => {
    expect(shouldBankTheWin({ ...base, stack: 501, stackCeiling: 500 })).toBe(true);
    expect(shouldBankTheWin({ ...base, stack: 500, stackCeiling: 500 })).toBe(false);
    expect(
      shouldBankTheWin({ ...base, stack: 501, stackCeiling: 500, nextHandIsBigBlind: false })
    ).toBe(false);
    // the owner line is not weakened by a ceiling above it
    const line = bankTheWinMultiple(base.horseId) * 400;
    expect(shouldBankTheWin({ ...base, stack: line, stackCeiling: 100000 })).toBe(true);
  });

  it('never the hand after a big pot: the orbit owed is played first', () => {
    for (let since = 0; since < 6; since++)
      expect(
        shouldBankTheWin({ ...base, stack: 900, stackCeiling: 500, handsSinceBigPot: since })
      ).toBe(false);
    expect(shouldBankTheWin({ ...base, stack: 900, stackCeiling: 500, handsSinceBigPot: 6 })).toBe(
      true
    );
  });

  it('never thins a game: at least max(3, seats - 2) players stay seated', () => {
    for (let seats = 2; seats <= 10; seats++)
      for (let now = 0; now <= 10; now++) {
        const ok = ceilingExitKeepsTheGame(now, seats);
        expect(ok).toBe(now - 1 >= Math.max(3, seats - 2));
        if (ok) expect(now - 1).toBeGreaterThanOrEqual(3);
      }
    expect(ceilingExitKeepsTheGame(6, 6)).toBe(true);
    expect(ceilingExitKeepsTheGame(5, 6)).toBe(true);
    expect(ceilingExitKeepsTheGame(4, 6)).toBe(false);
    expect(ceilingExitKeepsTheGame(2, 6)).toBe(false);
  });

  it('settlement asks the owner line first, then the ceiling with the game guard, and leaves by the same door', () => {
    const s = src('engine/ServerTableEngineSettlement.ts');
    const at = s.indexOf('if (shouldBankTheWin(bank)) return true;');
    expect(at).toBeGreaterThan(0);
    // the filter callback that holds the owner line, bounded by its own braces
    const block = sliceEnclosingBlock(s, 'if (shouldBankTheWin(bank)) return true;');
    const tail = block.slice(block.indexOf('if (shouldBankTheWin(bank)) return true;'));
    expect(tail).toContain('if (stackCeiling === null) return false;');
    expect(tail).toMatch(
      /shouldBankTheWin\(\{ \.\.\.bank, stackCeiling \}\) &&\s*ceilingExitKeepsTheGame\(/
    );
    expect(s).toMatch(
      /horseCashStackCeilingChips\(\{\s*ceilingBB: horseCashStackCeilingBBFrom\(snap\.runtimeSettings\),\s*variant: this\.tableInfo\?\.game_variant,/
    );
    // the hit-and-run count still comes first, and the exit is the ordinary voluntary door (no rathole)
    const filter = s.slice(s.indexOf('const cashedOutHorses = players.filter'), at);
    expect(filter).toContain('if (row && hitRunHandsRemaining(row, p.stack) > 0) return false;');
    const exit = sliceMethod(s, 'protected async bankTheWinExit(');
    expect(exit).toContain('await this.cashoutVoluntaryStay(horse)');
    // tournaments and Diamond cash never reach it
    const step = s.slice(s.indexOf("runStep('horse_cashouts'"), at);
    expect(step).toContain(
      'if (!isDiamondCash && !this.isTournamentTable() && players.length >= 2)'
    );
  });
});

describe('no rathole, both ways', () => {
  it('a floor above the ceiling keeps the Horse out; a floor at or under it, or no floor, does not', () => {
    expect(rejoinFloorIsAboveCeiling(650, 500)).toBe(true);
    expect(rejoinFloorIsAboveCeiling(500, 500)).toBe(false);
    expect(rejoinFloorIsAboveCeiling(undefined, 500)).toBe(false);
    expect(rejoinFloorIsAboveCeiling(650, null)).toBe(false);
  });

  it('the one buy-in sizing refuses it before any purchase, for both callers', () => {
    const f = src('services/HorseFleetManager.ts');
    const body = f.slice(
      f.indexOf('private computeHorseBuyIn('),
      f.indexOf('private async seatHorse(')
    );
    expect(body).toMatch(
      /rejoinFloorIsAboveCeiling\(\s*rejoinFloor,\s*horseCashStackCeilingChips\(\{\s*ceilingBB: horseCashStackCeilingBBFrom\(engineRuntimeSettings\(\)\.current\(\)\),\s*variant: table\.game_variant,/
    );
    expect(body.indexOf('rejoinFloorIsAboveCeiling(')).toBeLessThan(
      body.indexOf('if (bankrollsLoaded)')
    );
    // the buy-in itself is unchanged: the table maximum (inside the measured band at every live PLO4/PLO5 game)
    expect(body).toContain('const buyIn = horseMaximumBuyIn(minB, maxB);');
  });
});

describe('Lightning pools', () => {
  const HORSE = 'horse-ceiling-L';
  const reading = (over: Partial<LightningBankReading> = {}): LightningBankReading => ({
    found: true,
    table_id: 't',
    stack: 520,
    leave_pending: false,
    start_basis: 400,
    hands_since_big_pot: null,
    hands_owed: 0,
    blind_rank: 1,
    pool_players: 6,
    players_per_hand: 6,
    ...over,
  });

  it('off is identical: no ceiling argument, null and undefined all give the owner line verdict', () => {
    const r = rng(23);
    for (let i = 0; i < 5000; i++) {
      const facts = reading({
        found: r() < 0.95,
        leave_pending: r() < 0.05,
        stack: Math.round(r() * 400000) / 100,
        start_basis: [0, 100, 400][Math.floor(r() * 3)]!,
        hands_since_big_pot: r() < 0.5 ? null : Math.floor(r() * 8),
        hands_owed: r() < 0.7 ? 0 : 3,
        blind_rank: r() < 0.1 ? null : 1 + Math.floor(r() * 6),
        pool_players: Math.floor(r() * 14),
        players_per_hand: 2 + Math.floor(r() * 5),
      });
      const id = `h-${Math.floor(r() * 40)}`;
      const a = decideLightningBankTheWin(id, facts);
      expect(decideLightningBankTheWin(id, facts, null)).toBe(a);
      expect(decideLightningBankTheWin(id, facts, undefined)).toBe(a);
      if (a === 'leave')
        expect(Number(facts.stack)).toBeGreaterThanOrEqual(
          bankTheWinMultiple(id) * Number(facts.start_basis)
        );
    }
  });

  it('above the ceiling it leaves when its big blind is due, under every existing rule', () => {
    expect(decideLightningBankTheWin(HORSE, reading())).toBe('not_ready');
    expect(decideLightningBankTheWin(HORSE, reading(), 500)).toBe('leave');
    expect(decideLightningBankTheWin(HORSE, reading({ stack: 500 }), 500)).toBe('not_ready');
    expect(decideLightningBankTheWin(HORSE, reading({ hands_owed: 2 }), 500)).toBe('not_ready');
    expect(decideLightningBankTheWin(HORSE, reading({ hands_since_big_pot: 3 }), 500)).toBe(
      'not_ready'
    );
    expect(decideLightningBankTheWin(HORSE, reading({ blind_rank: 4 }), 500)).toBe('not_ready');
    expect(decideLightningBankTheWin(HORSE, reading({ blind_rank: null }), 500)).toBe('not_ready');
    expect(decideLightningBankTheWin(HORSE, reading({ leave_pending: true }), 500)).toBe('done');
  });

  it('never thins a pool: a short pool keeps its Horse until the refill arrives', () => {
    expect(decideLightningBankTheWin(HORSE, reading({ pool_players: 4 }), 500)).toBe('not_ready');
    expect(decideLightningBankTheWin(HORSE, reading({ pool_players: 5 }), 500)).toBe('leave');
    // the owner line itself is not held by the pool guard (unchanged behaviour)
    expect(decideLightningBankTheWin(HORSE, reading({ pool_players: 4, stack: 2400 }), 500)).toBe(
      'leave'
    );
  });

  it('the pre-filter asks about a stack above the ceiling, and the ask carries the ceiling', () => {
    const asks: Array<number | null> = [];
    onLightningBankTheWin((req) => {
      asks.push(req.stackCeiling);
      req.settle('not_ready', 400);
    });
    const note = (after: number, stackCeiling?: number | null) =>
      noteLightningHandForBankTheWin({
        clusterId: 'c',
        maxBuyIn: 400,
        stackCeiling,
        participants: [
          {
            playerId: HORSE,
            poolSessionId: 'ps',
            isHorse: true,
            blindRole: 'none',
            stackBefore: 400,
          },
        ],
        stacksAfter: new Map([[HORSE, after]]),
      });
    expect(note(400)).toEqual([HORSE]); // learns the basis
    expect(note(520)).toEqual([]); // off: under the owner line, not asked
    expect(note(520, null)).toEqual([]);
    expect(note(520, 500)).toEqual([HORSE]);
    expect(note(500, 500)).toEqual([]);
    expect(asks).toEqual([null, 500]);
  });

  it('the host gives the pool its ceiling from the pinned settings and the pool game', () => {
    const h = src('lightning/LightningHandHost.ts');
    expect(h).toMatch(
      /stackCeiling: horseCashStackCeilingChips\(\{\s*ceilingBB: horseCashStackCeilingBBFrom\(this\.runtimeSettings\),\s*variant: this\.rules\?\.game_variant,/
    );
    const d = src('services/LightningBankTheWinDoor.ts');
    expect(d).toContain('decideLightningBankTheWin(playerId, facts, stackCeiling)');
  });
});

/**
 * A TABLE MODEL built on the real verdict functions: six-max PLO5 1/2 tables (maximum buy-in 400), one person and
 * five Horses each, a fleet cycle that fills at most two empty seats per table from a stable of Horses (every hand
 * by default: the live cycle is 30 seconds, under one six-max hand), each Horse's stack a random walk. The same seed is run with the setting off and at 250 bb.
 */
function runTableModel(ceilingBB: number, seed: number, fleetEveryHands = 1) {
  const r = rng(seed);
  const BB = 2;
  const MAX = 400;
  const SEATS = 6;
  const TABLES = 8;
  const HANDS = 6000;
  const WINDOW = 1500; // hands a rejoin floor holds (about two hours)
  const ceiling = horseCashStackCeilingChips({
    ceilingBB,
    variant: 'plo5',
    bigBlind: BB,
    maxBuyIn: MAX,
  });
  type Seat = { id: string; horse: boolean; stack: number; since: number | undefined } | null;
  const tables: Seat[][] = [];
  const floors = new Map<string, { stack: number; until: number }>(); // `${horse}|${table}`
  const seated = new Set<string>();
  let nextHorse = 0;
  const stable = 400;
  const pick = (t: number, hand: number): string | null => {
    for (let tries = 0; tries < stable; tries++) {
      const id = `horse-${(nextHorse++ % stable).toString().padStart(3, '0')}`;
      if (seated.has(id)) continue;
      const f = floors.get(`${id}|${t}`);
      const floor = f && f.until > hand ? f.stack : undefined;
      if (rejoinFloorIsAboveCeiling(floor, ceiling)) continue; // not a buyer in this game
      return id;
    }
    return null;
  };
  for (let t = 0; t < TABLES; t++) {
    const row: Seat[] = [{ id: `person-${t}`, horse: false, stack: MAX, since: undefined }];
    for (let s = 1; s < SEATS; s++) {
      const id = pick(t, 0)!;
      seated.add(id);
      row.push({ id, horse: true, stack: MAX, since: undefined });
    }
    tables.push(row);
  }
  const out = {
    horseSeatHands: 0,
    minPlayers: SEATS,
    handsUnderFour: 0,
    personAlone: 0,
    exits: 0,
    ceilingExits: 0,
    handsAboveCeiling: 0,
    horseHands: 0,
    maxRunAbove: 0,
    returnedInsideWindow: 0,
    seatMoves: 0,
  };
  const runAbove = new Map<string, number>();
  for (let hand = 1; hand <= HANDS; hand++) {
    for (let t = 0; t < TABLES; t++) {
      const row = tables[t]!;
      const live = row.filter((s): s is NonNullable<Seat> => s !== null);
      out.minPlayers = Math.min(out.minPlayers, live.length);
      if (live.length < 4) out.handsUnderFour++;
      if (live.length < 2) out.personAlone++;
      // the hand: a zero-sum swing between two seats, sometimes a big pot
      if (live.length >= 2) {
        const a = live[Math.floor(r() * live.length)]!;
        let b = live[Math.floor(r() * live.length)]!;
        if (a === b) b = live[(live.indexOf(a) + 1) % live.length]!;
        const size = r() < 0.06 ? 150 + r() * 250 : r() * 40;
        const pot = Math.min(size, b.stack);
        a.stack += pot;
        b.stack -= pot;
        for (const s of live) {
          if (s === a && pot >= 0.5 * MAX) s.since = 0;
          else if (s.since !== undefined)
            s.since = s.since + 1 >= live.length ? undefined : s.since + 1;
          if (s.stack < 0.4 * MAX) s.stack = MAX; // top-up / rebuy to the table maximum
          if (s.horse) {
            out.horseSeatHands++;
            out.horseHands++;
            if (stackIsAboveCeiling(s.stack, ceilingBB > 0 ? ceiling : 250 * BB)) {
              out.handsAboveCeiling++;
              const n = (runAbove.get(s.id) ?? 0) + 1;
              runAbove.set(s.id, n);
              if (ceilingBB > 0) out.maxRunAbove = Math.max(out.maxRunAbove, n);
            } else runAbove.delete(s.id);
          }
        }
      }
      // the boundary: the next big blind (rotating seat) may book its win
      const bbSeat = hand % SEATS;
      const p = row[bbSeat];
      if (p && p.horse) {
        const bank = {
          horseId: p.id,
          stack: p.stack,
          startingStack: MAX,
          handsSinceBigPot: p.since,
          playersAtTable: live.length,
          nextHandIsBigBlind: true,
        };
        const owner = shouldBankTheWin(bank);
        const byCeiling =
          !owner &&
          ceiling !== null &&
          shouldBankTheWin({ ...bank, stackCeiling: ceiling }) &&
          ceilingExitKeepsTheGame(live.length, SEATS);
        if (owner || byCeiling) {
          floors.set(`${p.id}|${t}`, { stack: p.stack, until: hand + WINDOW });
          seated.delete(p.id);
          runAbove.delete(p.id);
          row[bbSeat] = null;
          out.exits++;
          if (byCeiling) out.ceilingExits++;
        }
      }
      // the fleet cycle: at most two empty seats filled per table, nobody else moves
      if (hand % fleetEveryHands === t % fleetEveryHands) {
        let filled = 0;
        for (let s = 0; s < SEATS && filled < 2; s++) {
          if (row[s] !== null) continue;
          const id = pick(t, hand);
          if (!id) break;
          const f = floors.get(`${id}|${t}`);
          const floor = f && f.until > hand ? f.stack : undefined;
          if (rejoinFloorIsAboveCeiling(floor, ceiling)) out.returnedInsideWindow++;
          seated.add(id);
          row[s] = { id, horse: true, stack: Math.max(MAX, floor ?? 0), since: undefined };
          filled++;
        }
      }
      if (row[0]?.id !== `person-${t}`) out.seatMoves++;
    }
  }
  return out;
}

describe('table model: the games keep running and the Horse seat-hands are unchanged', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: off against a 250 bb ceiling`, () => {
      const off = runTableModel(0, seed);
      const on = runTableModel(250, seed);
      // every table kept at least four players at every hand, the person was never alone, nobody was moved
      expect(on.minPlayers).toBeGreaterThanOrEqual(4);
      expect(on.handsUnderFour).toBe(0);
      expect(on.personAlone).toBe(0);
      expect(on.seatMoves).toBe(0);
      expect(off.seatMoves).toBe(0);
      // Horse seat-hands within 2% of the run without the setting
      expect(on.horseSeatHands / off.horseSeatHands).toBeGreaterThan(0.98);
      // the ceiling did its work: far fewer Horse hands above 250 bb, and no long stay above it
      expect(on.ceilingExits).toBeGreaterThan(0);
      expect(on.handsAboveCeiling / on.horseHands).toBeLessThan(
        0.5 * (off.handsAboveCeiling / off.horseHands)
      );
      // no rathole: nobody came back to a game inside its window while its floor was above the ceiling
      expect(on.returnedInsideWindow).toBe(0);
    });
  }

  it('reports the model numbers', () => {
    const off = runTableModel(0, 1);
    const on = runTableModel(250, 1);
    console.log('[stack ceiling model] off', JSON.stringify(off));
    console.log('[stack ceiling model] on250', JSON.stringify(on));
    // sensitivity: a fleet that only refills every 20 hands still never thins a game below four
    const slowOff = runTableModel(0, 1, 20);
    const slowOn = runTableModel(250, 1, 20);
    console.log('[stack ceiling model] slow fleet off', JSON.stringify(slowOff));
    console.log('[stack ceiling model] slow fleet on250', JSON.stringify(slowOn));
    expect(slowOn.minPlayers).toBeGreaterThanOrEqual(4);
    expect(slowOn.personAlone).toBe(0);
    expect(on.horseHands).toBeGreaterThan(0);
  });
});
