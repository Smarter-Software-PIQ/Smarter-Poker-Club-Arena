import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Telemetry = typeof import('./BrainTelemetry.js');
type Evidence = typeof import('./HorseUpgradeEvidence.js');

const H1 = '11111111-1111-4111-8111-111111111111';
const H2 = '22222222-2222-4222-8222-222222222222';
const DROPPED = 'per_horse_evidence_cell_dropped_seen';

let telemetry: Telemetry;
let evidence: Evidence;

/** A fresh module graph per test: the aggregate and the scope are module state. */
async function load(arm = true): Promise<void> {
  vi.resetModules();
  telemetry = await import('./BrainTelemetry.js');
  evidence = await import('./HorseUpgradeEvidence.js');
  telemetry.enableBrainTelemetry();
  if (arm) evidence.enableHorseUpgradeEvidence();
}
const fires = (): Record<string, number> =>
  Object.fromEntries(telemetry.drainFires().map((r) => [r.feature, r.fires]));
const cell = (
  rows: ReturnType<Evidence['drainHorseUpgradeEvidence']>,
  horse: string,
  upgrade: string
) => rows.find((r) => r.horseUserId === horse && r.upgradeId === upgrade);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-14T12:00:00.000Z'));
  await load();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the per-decision fire scope', () => {
  it('collects exactly the counters fired inside it, and counts them for the fleet as before', () => {
    telemetry.noteFire('before_scope');
    const scoped = telemetry.withDecisionFireScope(() => {
      telemetry.noteFire('upgrade02_card_removal_scored');
      telemetry.noteFire('upgrade02_card_removal_scored');
      telemetry.noteFire('decide_postflop');
      return 7;
    });
    telemetry.noteFire('after_scope');
    expect(scoped.value).toBe(7);
    expect([...scoped.fired].sort()).toEqual(['decide_postflop', 'upgrade02_card_removal_scored']);
    expect(fires()).toEqual({
      before_scope: 1,
      upgrade02_card_removal_scored: 2,
      decide_postflop: 1,
      after_scope: 1,
    });
  });

  it('collects nothing from a suspended evaluation or with telemetry off', async () => {
    const scoped = telemetry.withDecisionFireScope(() => {
      telemetry.withBrainTelemetrySuspended(() => telemetry.noteFire('shadow_only'));
      telemetry.noteFire('counted');
    });
    expect([...scoped.fired]).toEqual(['counted']);

    vi.resetModules();
    const off = await import('./BrainTelemetry.js');
    expect([...off.withDecisionFireScope(() => off.noteFire('never_enabled')).fired]).toEqual([]);
  });

  it('restores the outer scope after a nested call, hands it the inner keys, and after a throw', () => {
    const outer = telemetry.withDecisionFireScope(() => {
      telemetry.noteFire('outer_before');
      const inner = telemetry.withDecisionFireScope(() => telemetry.noteFire('inner_key'));
      expect([...inner.fired]).toEqual(['inner_key']);
      expect(() =>
        telemetry.withDecisionFireScope(() => {
          telemetry.noteFire('thrown_key');
          throw new Error('brain threw');
        })
      ).toThrow('brain threw');
      // the scope is the outer one again: this lands in it, not in a scope a throw left open
      telemetry.noteFire('outer_after');
    });
    expect([...outer.fired].sort()).toEqual([
      'inner_key',
      'outer_after',
      'outer_before',
      'thrown_key',
    ]);
  });

  it('leaves no scope open after a throw at the top level', () => {
    let leaked: ReadonlySet<string> | undefined;
    expect(() =>
      telemetry.withDecisionFireScope(() => {
        throw new Error('brain threw');
      })
    ).toThrow('brain threw');
    // A scope left open would be the `outer` of the next one and receive its keys in the finally.
    const first = telemetry.withDecisionFireScope(() => telemetry.noteFire('first'));
    leaked = first.fired;
    telemetry.noteFire('outside');
    const second = telemetry.withDecisionFireScope(() => telemetry.noteFire('second'));
    expect([...leaked]).toEqual(['first']);
    expect([...second.fired]).toEqual(['second']);
  });
});

describe('the per-Horse upgrade aggregate', () => {
  it('gives every declared upgrade the decision and only the fired ones the invocation', () => {
    evidence.noteHorseUpgradeDecision(H1, 'nlh', 'cash', [
      'upgrade01_action_line_posterior',
      'upgrade02_card_removal_scored',
      'decide_postflop',
    ]);
    evidence.noteHorseUpgradeDecision(H1, 'nlh', 'cash', ['upgrade01_action_line_posterior']);
    const rows = evidence.drainHorseUpgradeEvidence();
    expect(
      new Set(rows.map((r) => `${r.day}|${r.horseUserId}|${r.gameVariant}|${r.lane}`))
    ).toEqual(new Set([`2026-11-14|${H1}|nlh|cash`]));
    expect(cell(rows, H1, 'upgrade_01_range_posteriors')).toMatchObject({
      decisions: 2,
      invoked: 2,
    });
    expect(cell(rows, H1, 'upgrade_02_card_removal_blockers')).toMatchObject({
      decisions: 2,
      invoked: 1,
    });
    // declared for hold'em cash, never fired: the baseline with no invocation
    expect(cell(rows, H1, 'upgrade_06_public_timing_pacing')).toMatchObject({
      decisions: 2,
      invoked: 0,
    });
    // not declared for hold'em cash and not fired: no cell at all
    expect(cell(rows, H1, 'upgrade_07_tournament_cover_and_bounty')).toBeUndefined();
    expect(cell(rows, H1, 'upgrade_12_specialty_variants')).toBeUndefined();
    for (const row of rows) expect(row.invoked).toBeLessThanOrEqual(row.decisions);
    expect(evidence.drainHorseUpgradeEvidence()).toEqual([]);
  });

  it('keeps Horses, variants, lanes and days apart, and normalises variant and mode like the watchcounters', () => {
    evidence.noteHorseUpgradeDecision(H1, 'PLO_5', 'mtt', ['phase7_tournament_utility']);
    evidence.noteHorseUpgradeDecision(H2.toUpperCase(), undefined, undefined, []);
    vi.setSystemTime(new Date('2026-11-15T00:00:01.000Z'));
    evidence.noteHorseUpgradeDecision(H1, 'plo5', 'tournament', []);
    const rows = evidence.drainHorseUpgradeEvidence();
    const seven = rows.filter((r) => r.upgradeId === 'upgrade_07_tournament_cover_and_bounty');
    expect(seven).toEqual([
      expect.objectContaining({
        day: '2026-11-14',
        horseUserId: H1,
        gameVariant: 'plo5',
        lane: 'tournament',
        decisions: 1,
        invoked: 1,
      }),
      expect.objectContaining({
        day: '2026-11-15',
        horseUserId: H1,
        gameVariant: 'plo5',
        lane: 'tournament',
        decisions: 1,
        invoked: 0,
      }),
    ]);
    expect(
      rows
        .filter((r) => r.horseUserId === H2)
        .every((r) => r.gameVariant === 'nlh' && r.lane === 'cash')
    ).toBe(true);
    expect(rows.some((r) => r.horseUserId === H2)).toBe(true);
  });

  it('records an upgrade that fired where the manifest does not declare it, as it happened', () => {
    // upgrade 07 is tournament-only; a cash decision that fired it is one decision and one invocation
    evidence.noteHorseUpgradeDecision(H1, 'nlh', 'cash', ['phase7_tournament_utility']);
    evidence.noteHorseUpgradeDecision(H1, 'nlh', 'cash', []);
    const rows = evidence.drainHorseUpgradeEvidence();
    expect(cell(rows, H1, 'upgrade_07_tournament_cover_and_bounty')).toMatchObject({
      decisions: 1,
      invoked: 1,
    });
  });

  it('counts a host-side event as its own opportunity and ignores an unknown upgrade', () => {
    evidence.noteHorseUpgradeEvent(H1, 'plo4', 'cash', 'upgrade_08_side_games_integration');
    evidence.noteHorseUpgradeEvent(H1, 'plo4', 'cash', 'upgrade_08_side_games_integration');
    evidence.noteHorseUpgradeEvent(H1, 'plo4', 'cash', 'upgrade_99_not_in_the_manifest');
    expect(evidence.drainHorseUpgradeEvidence()).toEqual([
      {
        day: '2026-11-14',
        horseUserId: H1,
        gameVariant: 'plo4',
        lane: 'cash',
        upgradeId: 'upgrade_08_side_games_integration',
        decisions: 2,
        invoked: 2,
      },
    ]);
  });

  it('adds worker decisions and host opportunities into one cell without reporting either twice', () => {
    // three brain decisions in a cash game; the brain read a side game in one of them
    evidence.noteHorseUpgradeDecision(H1, 'nlh', 'cash', ['upgrade08_seven_deuce_overlay_seen']);
    evidence.noteHorseUpgradeDecision(H1, 'nlh', 'cash', []);
    evidence.noteHorseUpgradeDecision(H1, 'nlh', 'cash', []);
    // two host-side opportunities outside any decision: an insurance offer and a run-it-twice answer
    evidence.noteHorseUpgradeEvent(H1, 'nlh', 'cash', 'upgrade_08_side_games_integration');
    evidence.noteHorseUpgradeEvent(H1, 'nlh', 'cash', 'upgrade_08_side_games_integration');
    // one purged pre-action
    evidence.noteHorseUpgradeEvent(H1, 'nlh', 'cash', 'upgrade_09_preaction_purge');
    const rows = evidence.drainHorseUpgradeEvidence();
    // decisions = 3 brain decisions + 2 host opportunities; invoked = 1 brain read + 2 host opportunities
    expect(cell(rows, H1, 'upgrade_08_side_games_integration')).toMatchObject({
      decisions: 5,
      invoked: 3,
    });
    expect(cell(rows, H1, 'upgrade_09_preaction_purge')).toMatchObject({
      decisions: 4,
      invoked: 1,
    });
    // an upgrade with no host source is untouched by the events
    expect(cell(rows, H1, 'upgrade_01_range_posteriors')).toMatchObject({
      decisions: 3,
      invoked: 0,
    });
    for (const row of rows) expect(row.invoked).toBeLessThanOrEqual(row.decisions);
  });

  it('says whether it is armed, so a host site does no work for an unarmed process', async () => {
    expect(evidence.horseUpgradeEvidenceArmed()).toBe(true);
    await load(false);
    expect(evidence.horseUpgradeEvidenceArmed()).toBe(false);
  });

  it('refuses an identity the writer could not store, and counts it', () => {
    evidence.noteHorseUpgradeDecision('horse-7', 'nlh', 'cash', [
      'upgrade01_action_line_posterior',
    ]);
    evidence.noteHorseUpgradeEvent('', 'nlh', 'cash', 'upgrade_08_side_games_integration');
    expect(evidence.drainHorseUpgradeEvidence()).toEqual([]);
    expect(fires().per_horse_evidence_identity_refused_seen).toBe(2);
  });

  it('accumulates nothing until the flush service arms it', async () => {
    await load(false);
    evidence.noteHorseUpgradeDecision(H1, 'nlh', 'cash', ['upgrade01_action_line_posterior']);
    evidence.noteHorseUpgradeEvent(H1, 'nlh', 'cash', 'upgrade_08_side_games_integration');
    expect(evidence.drainHorseUpgradeEvidence()).toEqual([]);
  });

  it('holds at most the cell cap: an increment that would open a cell beyond it is dropped and counted', () => {
    const horse = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
    for (let n = 0; n < evidence.HORSE_UPGRADE_EVIDENCE_MAX_CELLS; n++)
      evidence.noteHorseUpgradeEvent(horse(n), 'nlh', 'cash', 'upgrade_08_side_games_integration');
    expect(fires()[DROPPED]).toBeUndefined();
    // a cell that already exists still counts at the cap
    evidence.noteHorseUpgradeEvent(horse(0), 'nlh', 'cash', 'upgrade_08_side_games_integration');
    expect(fires()[DROPPED]).toBeUndefined();
    // a new Horse, and a new upgrade for a known Horse, are both beyond it
    evidence.noteHorseUpgradeEvent(
      horse(999_999),
      'nlh',
      'cash',
      'upgrade_08_side_games_integration'
    );
    evidence.noteHorseUpgradeEvent(horse(0), 'nlh', 'cash', 'upgrade_09_preaction_purge');
    expect(fires()[DROPPED]).toBe(2);
    const rows = evidence.drainHorseUpgradeEvidence();
    expect(rows).toHaveLength(evidence.HORSE_UPGRADE_EVIDENCE_MAX_CELLS);
    expect(rows.reduce((n, r) => n + r.decisions, 0)).toBe(
      evidence.HORSE_UPGRADE_EVIDENCE_MAX_CELLS + 1
    );
    expect(rows.some((r) => r.horseUserId === horse(999_999))).toBe(false);
    // the drain frees the cap
    evidence.noteHorseUpgradeEvent(
      horse(999_999),
      'nlh',
      'cash',
      'upgrade_08_side_games_integration'
    );
    expect(evidence.drainHorseUpgradeEvidence()).toHaveLength(1);
  });

  it('restores drained rows additively, beside what has counted since', () => {
    evidence.noteHorseUpgradeDecision(H1, 'nlh', 'cash', ['upgrade02_card_removal_scored']);
    const drained = evidence.drainHorseUpgradeEvidence();
    evidence.noteHorseUpgradeDecision(H1, 'nlh', 'cash', []);
    evidence.restoreHorseUpgradeEvidence(drained);
    evidence.restoreHorseUpgradeEvidence([
      { ...drained[0]!, upgradeId: 'upgrade_99_not_in_the_manifest' },
      { ...drained[0]!, decisions: 0, invoked: 0 },
    ]);
    const rows = evidence.drainHorseUpgradeEvidence();
    expect(rows).toHaveLength(drained.length);
    expect(cell(rows, H1, 'upgrade_02_card_removal_blockers')).toMatchObject({
      decisions: 2,
      invoked: 1,
    });
    expect(cell(rows, H1, 'upgrade_01_range_posteriors')).toMatchObject({
      decisions: 2,
      invoked: 0,
    });
  });

  it('keeps the cap on a restore', () => {
    const horse = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`;
    evidence.noteHorseUpgradeEvent(H1, 'nlh', 'cash', 'upgrade_08_side_games_integration');
    const held = evidence.drainHorseUpgradeEvidence();
    for (let n = 0; n < evidence.HORSE_UPGRADE_EVIDENCE_MAX_CELLS; n++)
      evidence.noteHorseUpgradeEvent(horse(n), 'nlh', 'cash', 'upgrade_08_side_games_integration');
    evidence.restoreHorseUpgradeEvidence(held);
    expect(fires()[DROPPED]).toBe(1);
    expect(evidence.drainHorseUpgradeEvidence()).toHaveLength(
      evidence.HORSE_UPGRADE_EVIDENCE_MAX_CELLS
    );
  });
});
