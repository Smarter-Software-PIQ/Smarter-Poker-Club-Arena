/**
 * LAW: an option's authority doc states the switch state production is in.
 *
 * Twice on 2026-11-22 an authority doc said the opposite of production (holdemTournamentAllInCallIsPriced said
 * LIVE ON after audit #181 rolled it back; holdemValueAndCallsArePriced said OFF after audit #185 turned it on),
 * and on 2026-11-23 holdemTournamentAllInCallIsPriced still said OFF after audit #186 turned it back on.
 * docs/horse-option-switch-state.json is the committed copy of public.ca_horse_style_switch as the last verified
 * write saw it: `scripts/ops/horse-option-switch.mjs set` rewrites it in the operator's checkout after the readback,
 * and `... snapshot` rewrites it from the live rows. This law fails when a doc's machine-read State
 * (`**State: ...**`) disagrees with that snapshot, so a switch write and its doc land in one PR.
 * CI never reads the database: the snapshot is what the operator last saw.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SWITCH_STATE_FILE,
  SWITCH_STATE_SCHEMA,
  applySwitchStateChange,
  findAuthorityDocStateDrift,
  findUnjudgedLiveAuthorityDocs,
  formatSwitchStateSnapshot,
  parseAuthorityDocState,
  snapshotFromRows,
} from '../scripts/ops/horse-option-switch-lib.mjs';
import { runCli } from '../scripts/ops/horse-option-switch.mjs';

const ROOT = resolve(__dirname, '..');
const AUTH_DIR = join(ROOT, 'docs/horse-option-authority.d');

function registeredAuthorityDocs(): Record<string, string> {
  const docs: Record<string, string> = {};
  for (const f of readdirSync(AUTH_DIR)) {
    if (!f.endsWith('.md')) continue;
    const name = f.slice(0, -3);
    if (name.includes('.')) continue; // <option>.UNREGISTERED.md and other suffixed files are not live docs
    docs[name] = readFileSync(join(AUTH_DIR, f), 'utf8');
  }
  return docs;
}

/**
 * Live options whose authority doc was written before the machine-read `**State: ...**` token existed
 * (2026-11-15 to 2026-11-21 formats, most of them PLO-OWNER docs), read 2026-11-24 against the live rows
 * (audit max 196). The drift check cannot judge them, so this list may only shrink: a doc that gains a readable
 * State leaves it, and any other live option without one fails the law. The case that made this law:
 * cashDefenceTrimColdCalls went live at audit #193 while its doc read "default OFF in source", which
 * parsed as unknown and was never judged.
 */
const DOCS_WRITTEN_BEFORE_THE_STATE_TOKEN: readonly string[] = [
  'horseActionTimeIsPublicOnly',
  'lightningVpipFloorLimpOnly',
  'omahaBareOverpairOopFlopCheck',
  'omahaBigBetIsPotShare',
  'omahaBigDrawAggression',
  'omahaBlanketRowsOffInPlo45Cash',
  'omahaBluffCatcherFoldVsValueLeader',
  'omahaBluffShareFromBetRate',
  'omahaCardImpact',
  'omahaEliteContinuesVsMeasuredWideThreeBettor',
  'omahaEvFoldModelHeadsUp',
  'omahaFacingBetEv',
  'omahaFlopFacingBetEv',
  'omahaMadeHandDefenseVsValueLeader',
  'omahaManiacReRaiseWidthMeasured',
  'omahaMathCorePlo5Flop',
  'omahaNoCallColdFourBetWithoutPremium',
  'omahaNoDrawRaiseOutOfPosition',
  'omahaOopReraisedPotStrongRange',
  'omahaOopTurnCheckAfterFlopCall',
  'omahaOpponentLifetimeHud',
  'omahaOverpairNoOopBarrelVsValueLeader',
  'omahaPairedBoardFoldRespectsPrice',
  'omahaPairedRiverNoThinLeadVsValueLeader',
  'omahaPairedTurnNoBarrelWithoutBoatVsValueLeader',
  'omahaPreflopReraiseDefencePricedInPosition',
  'omahaPressureNeedsPostflopAggression',
  'omahaReraiseRangeEarlyPosition',
  'omahaReraiseRangeOutOfPosition',
  'omahaReraisedPotFlopContinueNeedsEquityShape',
  'omahaRiverCurrentNutsCallFloor',
  'omahaRiverMediumBetStrongHandCalls',
  'omahaRiverNutBlockerBluffReachable',
  'omahaSmallBetIsPriced',
  'omahaStabDefenceIsPriced',
  'omahaStrategyInTournaments',
  'omahaStreetPlan',
  'omahaStrongHandSlowplayMix',
  'omahaStrongHandValue',
  'omahaTurnBetNeedsRiverPlan',
  'omahaTurnRiverRaiseIsPriced',
  'omahaTurnRiverRaiseNeedsNuts',
  'omahaUnderpairNoMultiwayFlopContinue',
  'omahaValueSizeIsUnreadable',
  'omahaVpipFloorByLimp',
  'vpipFloorLimpOnly',
];

describe('an authority doc states the live switch', () => {
  const snapshot = JSON.parse(readFileSync(join(ROOT, SWITCH_STATE_FILE), 'utf8'));

  it('the committed snapshot is well formed and sorted as the tool writes it', () => {
    expect(snapshot.schema).toBe(SWITCH_STATE_SCHEMA);
    expect(typeof snapshot.asOfUtc).toBe('string');
    expect(Object.keys(snapshot.rows).length).toBeGreaterThan(0);
    for (const [option, row] of Object.entries(
      snapshot.rows as Record<string, { state: string }>
    )) {
      expect(option).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
      expect(['on', 'off', 'shadow', 'on_shadow', 'canary']).toContain(row.state);
    }
    expect(readFileSync(join(ROOT, SWITCH_STATE_FILE), 'utf8')).toBe(
      formatSwitchStateSnapshot(snapshot)
    );
  });

  it('no authority doc states a switch state the snapshot does not hold', () => {
    const drift = findAuthorityDocStateDrift({ snapshot, docs: registeredAuthorityDocs() });
    expect(
      drift,
      `authority docs out of step with ${SWITCH_STATE_FILE}: ${JSON.stringify(drift)}`
    ).toEqual([]);
  });

  it('every option with a live row has a doc State the drift check can read', () => {
    const unjudged = findUnjudgedLiveAuthorityDocs({ snapshot, docs: registeredAuthorityDocs() });
    const fresh = unjudged.filter((u) => !DOCS_WRITTEN_BEFORE_THE_STATE_TOKEN.includes(u.option));
    expect(
      fresh,
      `authority docs of live options whose State cannot be judged (add a **State: ...** token): ${JSON.stringify(fresh)}`
    ).toEqual([]);
  });

  it('the docs written before the State token only leave that list', () => {
    const docs = registeredAuthorityDocs();
    const nowReadable = DOCS_WRITTEN_BEFORE_THE_STATE_TOKEN.filter((o) => {
      const parsed = parseAuthorityDocState(docs[o]);
      return parsed !== null && parsed.state !== 'unknown';
    });
    expect(
      nowReadable,
      `these docs now carry a readable State: remove them from DOCS_WRITTEN_BEFORE_THE_STATE_TOKEN`
    ).toEqual([]);
    expect([...DOCS_WRITTEN_BEFORE_THE_STATE_TOKEN].sort()).toEqual(
      DOCS_WRITTEN_BEFORE_THE_STATE_TOKEN
    );
  });

  it('fails a live option whose doc State cannot be read, and leaves no-row options alone', () => {
    const snap = snapshotFromRows(
      [
        {
          option: 'liveUnknown',
          state: 'on',
          updated_at: '2026-11-24 08:18:04+00',
          audit_id: 193,
          audit_max: 193,
        },
        {
          option: 'liveNoToken',
          state: 'off',
          updated_at: '2026-11-24 08:18:04+00',
          audit_id: 190,
          audit_max: 193,
        },
        {
          option: 'liveRead',
          state: 'on',
          updated_at: '2026-11-24 08:18:04+00',
          audit_id: 191,
          audit_max: 193,
        },
      ],
      '2026-11-24T09:00:00Z'
    );
    expect(
      findUnjudgedLiveAuthorityDocs({
        snapshot: snap,
        docs: {
          liveUnknown: '**State: pending review**',
          liveNoToken: 'no machine-readable state',
          liveRead: '**State: LIVE ON** since audit #191',
          noRow: '**State: pending review**',
        },
      })
    ).toEqual([
      { option: 'liveNoToken', docStateText: null, liveState: 'off' },
      { option: 'liveUnknown', docStateText: 'pending review', liveState: 'on' },
    ]);
  });

  it('reads the State token the docs use', () => {
    expect(parseAuthorityDocState('x **State: LIVE ON** in production since ...')).toEqual({
      raw: 'LIVE ON',
      state: 'on',
    });
    expect(parseAuthorityDocState('**State: OFF** (dark): source default OFF')?.state).toBe('off');
    expect(parseAuthorityDocState('**State: SHADOW** since ...')?.state).toBe('shadow');
    expect(parseAuthorityDocState('**State: ON_SHADOW** since ...')?.state).toBe('on_shadow');
    expect(parseAuthorityDocState('no state here')).toBeNull();
    expect(parseAuthorityDocState('**State: pending review**')?.state).toBe('unknown');
    expect(
      parseAuthorityDocState('**State: default OFF in source (x); Evidence MET.**')?.state
    ).toBe('off');
  });

  it('judges each pairing of doc State and live row', () => {
    const snap = snapshotFromRows(
      [
        {
          option: 'aOn',
          state: 'on',
          updated_at: '2026-11-23 01:25:29+00',
          audit_id: 186,
          audit_max: 189,
        },
        {
          option: 'bOff',
          state: 'off',
          updated_at: '2026-11-22 19:51:28+00',
          audit_id: 181,
          audit_max: 189,
        },
      ],
      '2026-11-23T05:05:00Z'
    );
    const docs = {
      aOn: '**State: OFF** since ...', // production on, doc says off -> drift
      bOff: '**State: OFF** rolled back', // fine
      cDefault: '**State: OFF** (dark)', // no row = release default -> fine for OFF
      dDefault: '**State: LIVE ON** ...', // doc says on, no row -> drift
      eNoState: 'nothing machine-readable', // not judged
    };
    expect(findAuthorityDocStateDrift({ snapshot: snap, docs })).toEqual([
      { option: 'aOn', docState: 'off', docStateText: 'OFF', liveState: 'on' },
      { option: 'dDefault', docState: 'on', docStateText: 'LIVE ON', liveState: 'default' },
    ]);
  });

  it('a verified write updates one row, and a cleared row goes back to the release default', () => {
    const base = snapshotFromRows(
      [
        {
          option: 'v79TopPairWeakKicker',
          state: 'off',
          updated_at: '2026-11-23 02:26:33+00',
          audit_id: 187,
          audit_max: 187,
        },
      ],
      '2026-11-23T02:30:00Z'
    );
    const on = applySwitchStateChange(base, {
      option: 'holdemTournamentAllInCallIsPriced',
      state: 'on',
      auditId: 186,
      changedAt: '2026-11-23T01:25:29Z',
    });
    expect(on.rows.holdemTournamentAllInCallIsPriced).toEqual({
      state: 'on',
      auditId: 186,
      changedAt: '2026-11-23T01:25:29.000Z',
    });
    expect(on.auditMax).toBe(187);
    const cleared = applySwitchStateChange(on, {
      option: 'v79TopPairWeakKicker',
      state: 'default',
      auditId: 188,
      changedAt: '2026-11-23T04:17:47Z',
    });
    expect(cleared.rows.v79TopPairWeakKicker).toBeUndefined();
    expect(cleared.auditMax).toBe(188);
    expect(base.rows.v79TopPairWeakKicker.state).toBe('off'); // pure: the input is not mutated
  });

  it('`snapshot` writes the live rows through the injected writer, and writes nothing on --dry-run', async () => {
    const writes: Array<{ file: string; text: string }> = [];
    const deps = {
      queryDb: () => [
        {
          option: 'zLast',
          state: 'off',
          updated_at: '2026-11-23 04:17:47+00',
          audit_id: 188,
          audit_max: 189,
        },
        {
          option: 'aFirst',
          state: 'on',
          updated_at: '2026-11-23 01:25:29+00',
          audit_id: 186,
          audit_max: 189,
        },
      ],
      writeStateFile: (file: string, text: string) => writes.push({ file, text }),
      now: () => new Date('2026-11-23T05:05:00Z'),
      stdout: () => {},
      stderr: () => {},
    };
    const res = await runCli(['snapshot', '--json'], deps);
    expect(res.exitCode).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0].file).toBe(SWITCH_STATE_FILE);
    const written = JSON.parse(writes[0].text);
    expect(Object.keys(written.rows)).toEqual(['aFirst', 'zLast']);
    expect(written.auditMax).toBe(189);
    const dry = await runCli(['snapshot', '--dry-run', '--json'], deps);
    expect(dry.data.written).toBe(false);
    expect(writes).toHaveLength(1);
  });
});
