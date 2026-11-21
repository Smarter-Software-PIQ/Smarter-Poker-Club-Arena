/**
 * A VALUE-LEADER FIELD IS READ AS VALUE LEADERS (2026-11-20, Horse SWITCH lane,
 * task #6)
 *
 * The *VsValueLeader rules (omahaMadeHandDefenseVsValueLeader and the overpair /
 * paired-board rules, all ON live) act only when the opponent is a MEASURED
 * postflop value leader (HorseOmahaReadConditional: the maniac presumption
 * disproved by his own preflop raising, enough postflop opportunities, he does
 * not over-bet when checked to, folds to bets at least as often as the Horse
 * mean and calls rivers no more). Horse self-play never produces one, so the
 * league could not grade them. OMAHA_VALUE_LEADER_FIELD_PERSONA plays that
 * way; this law pins that:
 *  1. the label is EARNED: read straight off the hero's sandbox counters with
 *     the engine's own omahaReadConditional, most field seats are measured value
 *     leaders against the persona, and none is against the calibrated field on
 *     the same deals (nothing forces it);
 *  2. the live rules then act: omaha_value_leader_defense_applied fires, and
 *     never fires against the calibrated field;
 *  3. the table is clean (no illegal action, cut-off street or brain fallback);
 *  4. every value-leader card names the persona, both arms carry the live set
 *     and arm B differs from arm A in its one rule only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/supabase.js', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

import { drainFires, enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import { HorseMind } from '../engine/HorseMind.js';
import { omahaReadConditional } from '../engine/HorseOmahaReadConditional.js';
import { opponentExploitRead } from '../engine/HorseOpponentExploit.js';
import {
  DEVELOPMENT_LEAGUE_CARDS,
  LEAGUE_MATCHUPS,
  OMAHA_LIVE_OPTIONS_20261120,
  UNMEASURABLE_MATCHUPS,
  VALUE_LEADER_FIELD_CARDS,
  VALUE_LEADER_FIELD_RULES,
  runMatchup,
  type LeagueMatchup,
} from './HorseLeague.js';
import { LeagueCardRefusal, leagueCardPairs, resolveLeagueCard } from './HorseLeagueCard.js';
import {
  HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID,
  OMAHA_VALUE_LEADER_FIELD_PERSONA,
} from './HorseLeagueHumanField.js';

const PAIRS = 1500;
const SEED = 4;

async function play(persona: boolean) {
  const boxes: ReturnType<typeof HorseMind.createSandbox>[] = [];
  const create = HorseMind.createSandbox.bind(HorseMind);
  const spy = vi.spyOn(HorseMind, 'createSandbox').mockImplementation(() => {
    const b = create();
    boxes.push(b);
    return b;
  });
  const m: LeagueMatchup = {
    name: `plo5_value_leader_field_law_${persona ? 'persona' : 'calibrated'}`,
    variant: 'plo5',
    pairs: PAIRS,
    opponentPopulation: HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID,
    ...(persona ? { humanPersona: OMAHA_VALUE_LEADER_FIELD_PERSONA } : {}),
    a: { ...OMAHA_LIVE_OPTIONS_20261120, telemetry: true },
    b: { ...OMAHA_LIVE_OPTIONS_20261120, telemetry: true },
  };
  drainFires();
  const r = await runMatchup(m, PAIRS, SEED);
  const fires = drainFires();
  spy.mockRestore();
  const box = boxes[0]!;
  const seats = [...box.exploit.entries()].filter(([k]) => k.includes('|league-human-'));
  const reads = seats.map(([k, c]) => {
    const scope = k.split('|')[0] as Parameters<typeof omahaReadConditional>[1];
    return omahaReadConditional(c, scope, 'plo5', opponentExploitRead(c, scope, 'plo5'));
  });
  const applied = fires
    .filter((f) => f.feature === 'omaha_value_leader_defense_applied')
    .reduce((n, f) => n + f.fires, 0);
  return {
    r,
    seats: seats.length,
    leaders: reads.filter((x) => x?.valueLeader === true).length,
    applied,
  };
}

describe('a value-leader field is read as value leaders', () => {
  afterEach(() => vi.restoreAllMocks());

  it('earns the label on measured play, and the live rules act against it', async () => {
    enableBrainTelemetry();
    const field = await play(true);
    const calibrated = await play(false);
    expect(field.seats).toBe(5);
    expect(field.leaders).toBeGreaterThanOrEqual(3);
    expect(calibrated.leaders).toBe(0);
    expect(field.applied).toBeGreaterThan(0);
    expect(calibrated.applied).toBe(0);
    for (const run of [field.r, calibrated.r]) {
      expect(run.illegalActions).toBe(0);
      expect(run.truncatedStreets).toBe(0);
      expect(run.brainExceptionFallbacks ?? 0).toBe(0);
    }
  }, 600_000);

  it('every value-leader card seats the persona and differs from B in its one rule', () => {
    expect(VALUE_LEADER_FIELD_CARDS).toHaveLength(VALUE_LEADER_FIELD_RULES.length * 2);
    for (const card of VALUE_LEADER_FIELD_CARDS) {
      expect(card.humanPersona).toBe(OMAHA_VALUE_LEADER_FIELD_PERSONA);
      expect(card.opponentPopulation).toBe(HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID);
      const diff = Object.keys({ ...card.a, ...card.b }).filter(
        (k) => (card.a as Record<string, unknown>)[k] !== (card.b as Record<string, unknown>)[k]
      );
      expect(diff).toHaveLength(1);
      expect(VALUE_LEADER_FIELD_RULES).toContain(diff[0]);
      expect((card.a as Record<string, unknown>)[diff[0]!]).toBe(true);
    }
  });

  it('the cards are dealt by name for a grade run and are never on the nightly card', () => {
    const nightly = new Set(LEAGUE_MATCHUPS.map((m) => m.name));
    const dealable = [...LEAGUE_MATCHUPS, ...DEVELOPMENT_LEAGUE_CARDS];
    expect(new Set(dealable.map((m) => m.name)).size).toBe(dealable.length);
    for (const card of VALUE_LEADER_FIELD_CARDS) {
      expect(nightly.has(card.name), card.name).toBe(false);
      expect(DEVELOPMENT_LEAGUE_CARDS).toContain(card);
      // What src/scripts/horseLeagueCard.ts --card=<name> resolves and deals.
      expect(resolveLeagueCard(card.name, dealable, UNMEASURABLE_MATCHUPS)).toBe(card);
      expect(leagueCardPairs(card, null)).toBe(6000);
      expect(() => resolveLeagueCard(card.name, LEAGUE_MATCHUPS, UNMEASURABLE_MATCHUPS)).toThrow(
        LeagueCardRefusal
      );
    }
    for (const m of LEAGUE_MATCHUPS)
      expect(m.humanPersona, m.name).not.toBe(OMAHA_VALUE_LEADER_FIELD_PERSONA);
  });
});
