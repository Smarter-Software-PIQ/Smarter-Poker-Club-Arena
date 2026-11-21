/**
 * LAW: UPGRADE 09 IS JUDGED AS A GUARD AND UPGRADE 04 IS COUNTED WHERE IT IS USED (2026-11-21, Horse Switch lane).
 *
 * Measured on production the same day (horse_brain_telemetry, horse_upgrade_evidence_daily, read-only):
 *  - upgrade_09_preaction_purge had 0 fires against 9.6 million brain decisions and read as a dead upgrade. It is a
 *    guard: it can act only when a person piloted a Horse account through the client, armed a pre-action and dropped
 *    off. A brain decision is never one of its opportunities.
 *  - upgrade_04_plo5_plo6_reservoir is read on every Omaha equity decision, but its only counter fired in
 *    buildOmahaReservoir, once per worker process and shape: "invoked" counted worker starts.
 *
 * Evidence only. This file holds:
 *  1. A GUARD IS JUDGED ON ITS OWN OPPORTUNITIES: upgrade 09 is in PER_HORSE_GUARD_UPGRADES, the brain decision fold
 *     credits it nothing, a host opportunity it acted on is one decision and one invocation, one it did not act on
 *     is one decision and none; a guard with no opportunity is healthy, one that acted every time is healthy, one
 *     with an opportunity it did not act on is flagged. The operations read reports the same verdict for the same
 *     guards.
 *  2. BOTH HOSTS COUNT THE OPPORTUNITY APART FROM THE ACT: the opportunity counter fires on every armed pre-action
 *     at a server-owned Horse turn, the purge counter only when the pre-action is gone after the clear, and the
 *     per-Horse event carries that outcome.
 *  3. UPGRADE 04 HAS A PER-DECISION USE RECEIPT: every reservoir read moves one integer; the worker fires
 *     upgrade04_reservoir_used_seen once for a FAST decision that moved it, after executeFast has returned; that is
 *     upgrade 04's needle and the build counter is not; nothing in a decision reads the integer.
 *  4. NO DECISION CHANGES: seeded Omaha equity, percentile and band placement return the same values with telemetry
 *     armed and disarmed and whatever the read counter stood at. (The whole FAST_RESULT with and without the fire
 *     scope is pinned by HorsePerHorseUpgradeEvidence.law.test.ts; the one-per-decision count in the eighteen
 *     variant and lane cells by HorseUpgradeManifestRuntimeParity.law.test.ts.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { disarmBrainTelemetryForTest, drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  omahaPreflopPercentile,
  omahaReservoirReadsTotal,
  placeOmahaBandCombo,
  placeOmahaPressureCombo,
  restoreFastRandom,
  saveFastRandom,
  seedFastRandom,
  simulateEquity,
  variantInfo,
} from './HorseEval.js';
import {
  HORSE_UPGRADE_LIVE_EVIDENCE,
  computeHorseUpgradeActivationManifest,
} from './HorseUpgradeActivationManifest.js';
import * as evidence from './HorseUpgradeEvidence.js';
import { RANKS, SUITS } from './PokerEngine.js';
import type { Card } from '../types.js';

const NINE = 'upgrade_09_preaction_purge';
const FOUR = 'upgrade_04_plo5_plo6_reservoir';
const USED = 'upgrade04_reservoir_used_seen';
const H1 = '11111111-1111-4111-8111-111111111111';
const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const squeezed = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ');

const cellOf = (rows: evidence.HorseUpgradeEvidenceRow[], upgradeId: string) =>
  rows.filter((r) => r.upgradeId === upgradeId);

describe('LAW 1: upgrade 09 is a guard, judged on its own opportunities', () => {
  beforeEach(() => {
    evidence.enableHorseUpgradeEvidence();
    evidence.drainHorseUpgradeEvidence();
  });

  it('is the one guard, and a guard is an enabled manifest upgrade with live evidence', () => {
    expect([...evidence.PER_HORSE_GUARD_UPGRADES]).toEqual([NINE]);
    const enabled = new Set(
      computeHorseUpgradeActivationManifest()
        .upgrades.filter((u) => u.enabled)
        .map((u) => u.id)
    );
    for (const id of evidence.PER_HORSE_GUARD_UPGRADES) {
      expect(enabled.has(id), id).toBe(true);
      expect(HORSE_UPGRADE_LIVE_EVIDENCE[id]?.length, id).toBeGreaterThan(0);
    }
  });

  it('the brain decision fold credits a guard nothing, even with its own counters in the fires', () => {
    for (const variant of ['nlh', 'plo5'])
      for (const lane of ['cash', 'tournament'])
        evidence.noteHorseUpgradeDecision(H1, variant, lane, [
          'upgrade09_preaction_purge_table_seen',
          'upgrade09_preaction_purge_lightning_seen',
          'upgrade01_action_line_posterior',
        ]);
    const rows = evidence.drainHorseUpgradeEvidence();
    expect(cellOf(rows, NINE)).toEqual([]);
    // the ordinary per-decision upgrades still count every decision
    expect(
      cellOf(rows, 'upgrade_01_range_posteriors').map((r) => [r.decisions, r.invoked])
    ).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
    expect(evidence.upgradeIdsForFires(['upgrade09_preaction_purge_table_seen'])).toEqual([]);
  });

  it('an opportunity it acted on is one decision and one invocation; one it did not act on, one and none', () => {
    evidence.noteHorseUpgradeEvent(H1, 'nlh', 'cash', NINE, true);
    evidence.noteHorseUpgradeEvent(H1, 'nlh', 'cash', NINE, false);
    evidence.noteHorseUpgradeEvent(H1, 'nlh', 'cash', NINE);
    expect(cellOf(evidence.drainHorseUpgradeEvidence(), NINE)).toMatchObject([
      { decisions: 3, invoked: 2 },
    ]);
  });

  it('healthy with no opportunity, healthy when it acted every time, flagged when it missed one', () => {
    expect(evidence.judgeHorseUpgradeEvidence(NINE, 0, 0)).toEqual({
      verdict: 'guard_idle',
      flagged: false,
    });
    expect(evidence.judgeHorseUpgradeEvidence(NINE, 4, 4)).toEqual({
      verdict: 'guard_held',
      flagged: false,
    });
    expect(evidence.judgeHorseUpgradeEvidence(NINE, 4, 0)).toEqual({
      verdict: 'guard_missed',
      flagged: true,
    });
    expect(evidence.judgeHorseUpgradeEvidence(NINE, 4, 3)).toEqual({
      verdict: 'guard_missed',
      flagged: true,
    });
    // an ordinary upgrade is not judged here: its counts are read as before
    expect(evidence.judgeHorseUpgradeEvidence('upgrade_01_range_posteriors', 9, 0)).toEqual({
      verdict: 'per_decision',
      flagged: false,
    });
  });

  it('the operations read names the same guards and the same three verdicts', () => {
    const ops = readFileSync(
      join(process.cwd(), '..', 'scripts/ops/per-horse-upgrade-evidence-daily.sql'),
      'utf8'
    );
    const values = /guards\(upgrade_id\) AS \([\s\S]*?VALUES ([^\n]+)\n/.exec(ops);
    expect(values, 'the guards CTE').not.toBeNull();
    const listed = [...values![1]!.matchAll(/\('([a-z0-9_]+)'\)/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...evidence.PER_HORSE_GUARD_UPGRADES].sort());
    const sql = squeezed(ops);
    expect(sql).toContain("WHEN g.upgrade_id IS NULL THEN 'per_decision'");
    expect(sql).toContain("WHEN coalesce(u.decisions, 0) = 0 THEN 'guard_idle'");
    expect(sql).toContain("WHEN u.invoked >= u.decisions THEN 'guard_held'");
    expect(sql).toContain("ELSE 'guard_missed' END AS verdict");
    expect(sql).toContain('FULL JOIN guards g USING (upgrade_id)');
  });
});

describe('LAW 2: both hosts count the opportunity apart from the act', () => {
  const table = squeezed(read('engine/ServerTableEngineTurns.ts'));
  const lightning = squeezed(read('lightning/LightningHandHost.ts'));

  it('the table engine: opportunity on an armed pre-action, purge only when it is gone, the event carries it', () => {
    expect(table).toContain(
      "if (stalePreAction) { noteFire('upgrade09_preaction_purge_opportunity_table_seen'); " +
        'const purged = !this.preActionEngine.getPreAction?.(this.tableId, player.user_id); ' +
        "if (purged) noteFire('upgrade09_preaction_purge_table_seen');"
    );
    expect(table).toContain("'upgrade_09_preaction_purge', purged );");
  });

  it('Lightning: the same, at a server-owned Horse turn', () => {
    expect(lightning).toContain(
      "noteFire('upgrade09_preaction_purge_opportunity_lightning_seen'); " +
        'const purged = !this.preActions.hasPreAction(this.timerKey, userId); ' +
        "if (purged) noteFire('upgrade09_preaction_purge_lightning_seen');"
    );
    expect(lightning).toContain("'upgrade_09_preaction_purge', purged );");
  });
});

/** Non-test server source, for the "nothing in a decision reads it" check. */
function sources(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== 'node_modules') walk(full);
        continue;
      }
      const file = relative(SRC, full).split('\\').join('/');
      if (!file.endsWith('.ts') || /\.test\.ts$|\.test-support\.ts$|\.d\.ts$/.test(file)) continue;
      out.push({ file, text: readFileSync(full, 'utf8') });
    }
  };
  walk(SRC);
  return out;
}

const FULL: Card[] = [];
for (const s of SUITS) for (const r of RANKS) FULL.push({ rank: r, suit: s } as Card);
const c = (rank: string, suit: string): Card => ({ rank, suit }) as Card;

describe('LAW 3: upgrade 04 has a per-decision use receipt', () => {
  it('is the needle the manifest names for upgrade 04; the build counter is a separate build receipt', () => {
    expect(HORSE_UPGRADE_LIVE_EVIDENCE[FOUR]).toEqual([`'${USED}'`]);
    expect(evidence.upgradeIdsForFires([USED])).toEqual([FOUR]);
    expect(evidence.upgradeIdsForFires(['upgrade04_omaha_reservoir_5_seen'])).toEqual([]);
    expect(read('engine/HorseEval.ts')).toContain(
      "noteFire(`upgrade04_omaha_reservoir_${holeCount}${isHiLo ? '_hilo' : ''}_seen`);"
    );
  });

  it('every reservoir read moves the integer by one, and nothing else does', () => {
    const deck = FULL.slice();
    let before = omahaReservoirReadsTotal();
    omahaPreflopPercentile(deck.slice(0, 5), false);
    expect(omahaReservoirReadsTotal()).toBe(before + 1);
    before = omahaReservoirReadsTotal();
    omahaPreflopPercentile(deck.slice(0, 2), false); // not an Omaha hand: no reservoir
    expect(omahaReservoirReadsTotal()).toBe(before);
    placeOmahaBandCombo(deck.slice(), 0, 52, [0.5, 1], 6, true);
    expect(omahaReservoirReadsTotal()).toBe(before + 1);
    placeOmahaPressureCombo(deck.slice(), 0, 52, [0.2, 0.8], 4, [], 0, 0);
    expect(omahaReservoirReadsTotal()).toBe(before + 2);
    // a banded Omaha equity call reads it once per placed opponent hand, not once per call
    const vi = variantInfo('plo5');
    const hero = deck.slice(0, 5);
    before = omahaReservoirReadsTotal();
    seedFastRandom(91);
    simulateEquity(hero, [], 2, vi, 200, [
      [0.6, 1],
      [0.3, 0.9],
    ]);
    expect(omahaReservoirReadsTotal() - before).toBeGreaterThan(1);
  });

  it('the worker fires it once, inside the scope, after executeFast has returned', () => {
    const worker = squeezed(read('engine/horseDecision/workerRuntime.ts'));
    expect(worker).toContain(
      'const reservoirReadsBefore = omahaReservoirReadsTotal(); ' +
        'const scoped = withDecisionFireScope(() => { const outcome = this.executeFast(request); ' +
        "if (omahaReservoirReadsTotal() !== reservoirReadsBefore) noteFire('upgrade04_reservoir_used_seen'); " +
        'return outcome; });'
    );
    expect(worker.split(USED)).toHaveLength(2);
  });

  it('nothing but that worker site reads the integer: no decision can see it', () => {
    const readers = sources()
      .filter(({ text }) => text.includes('omahaReservoirReadsTotal'))
      .map(({ file }) => file)
      .sort();
    expect(readers).toEqual(['engine/HorseEval.ts', 'engine/horseDecision/workerRuntime.ts']);
    const evalSource = read('engine/HorseEval.ts');
    // in HorseEval: the definition, and three increments at the three reservoir reads
    expect(evalSource.split('omahaReservoirReadsTotal')).toHaveLength(2);
    expect(evalSource.split('omahaReservoirReads++;')).toHaveLength(4);
  });
});

describe('LAW 4: no decision changes', () => {
  afterEach(() => disarmBrainTelemetryForTest());

  /** Seeded Omaha reads in each Omaha game: percentiles, band placements and banded equity. */
  function reads(): string {
    const saved = saveFastRandom();
    try {
      const out: unknown[] = [];
      for (const [variant, holeCount] of [
        ['plo4', 4],
        ['plo5', 5],
        ['plo6', 6],
        ['plo8', 4],
      ] as const) {
        const vi = variantInfo(variant);
        seedFastRandom(20261121 + holeCount);
        const deck = FULL.slice();
        out.push(omahaPreflopPercentile(deck.slice(3, 3 + holeCount), vi.isHiLo));
        const placed = deck.slice();
        out.push(placeOmahaBandCombo(placed, 10, 52, [0.7, 1], holeCount, vi.isHiLo));
        out.push(placed.slice(10, 10 + holeCount));
        const hero =
          holeCount === 4
            ? [c('A', 'spades'), c('K', 'spades'), c('Q', 'hearts'), c('J', 'hearts')]
            : deck.slice(40, 40 + holeCount);
        const board = [c('9', 'spades'), c('8', 'diamonds'), c('2', 'clubs')];
        out.push(
          simulateEquity(hero, board, 2, vi, 300, [
            [0.75, 1],
            [0.2, 0.7],
          ])
        );
      }
      return JSON.stringify(out);
    } finally {
      restoreFastRandom(saved);
    }
  }

  it('the same values with telemetry armed and disarmed, and whatever the read counter stood at', () => {
    disarmBrainTelemetryForTest();
    const off = reads();
    enableBrainTelemetry();
    drainFires();
    const on = reads();
    // the counter has moved since the first pass; read again
    const again = reads();
    expect(on).toBe(off);
    expect(again).toBe(off);
    // and the reads themselves fire no use receipt: only the worker's decision owner does
    expect(drainFires().filter((f) => f.feature === USED)).toEqual([]);
  });
});
