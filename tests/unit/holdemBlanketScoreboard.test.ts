import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TELEMETRY_DAYS,
  HOLDEM_BLANKET_CATALOG,
  NEXT_ACTIONS,
  assertReadOnlySql,
  buildHoldemBlanketScoreboard,
  buildScoreboardBatchSql,
  classifySourceRegistration,
  detectSourceCouplings,
  extractHoldemOffList,
  filterScoreboardRules,
  formatScoreboardMarkdown,
  matchTelemetryForOption,
  parseAuthorityDoc,
  parseCliArgs,
  parseDefaultOnDoc,
  parseHorseDataLedgerFlags,
  parseHorseOptionSwitchSource,
  parseSupabaseJsonOutput,
  resolveLinkedSupabaseWorkdir,
  sha256Hex,
  validateTelemetryDays,
} from '../../scripts/ops/holdem-blanket-scoreboard-lib.mjs';
import { loadLocalRepoInputs, runCli } from '../../scripts/ops/holdem-blanket-scoreboard.mjs';

const REPO_ROOT = path.resolve(__dirname, '../..');

function makeSyntheticSwitchSource(extraOff: string[] = []) {
  const offItems = [
    'holdemRiverFullHouseValue',
    'holdemRiverFullHouseValueIsPriced',
    'holdemTournamentAllInCallIsPriced',
    'huBbDefendsUnreadToPrice',
    'holdemValueAndCallsArePriced',
    'holdemCommittedNoPairIsPriced',
    'holdemDangerBoardEquityIsPriced',
    'v62RiverBettorPolarity',
    ...extraOff,
  ];
  return `
export const OPTION_SWITCH_RELEASE_DEFAULT_ON: readonly string[] = Object.freeze([
  'v80TopPairStrongKicker',
  'v79TopPairWeakKicker',
  'v68TurnAirDrawCalls',
  'v65TurnOnePairShade',
  'v57TournamentAggression',
  'v61RiverOnePairShade',
  'v67RiverBetRaisedOnePair',
  'v66BetRaisedOnePair',
  'v63LargeRiverBetShade',
  'v64RiverRaiseNeedsTwoPair',
  'v21River',
  'v69TurnCallGaps',
  'v73Vs3BetDefence',
  'v87HoldemOverhaul',
  'v87RiverBlockBetTrap',
  'v87FlopStabCheckRaise',
  'v70GtoOpeningRanges',
  'nashCallVsJam',
]);
export const OPTION_SWITCH_RELEASE_DEFAULT_OFF: readonly string[] = Object.freeze([
  ${offItems.map((n) => `'${n}'`).join(',\n  ')}
]);
export const OPTION_SWITCH_RELEASE_DEFAULT_CODE: readonly string[] = Object.freeze([]);
export const OPTION_SWITCH_HELD_PATTERN_OFF_ONLY_NAMES: readonly string[] = Object.freeze([]);
export const OPTION_SWITCH_OFF_ONLY = Object.freeze({
  holdemPersonaPreflop: hold(PREFLOP_HOLD_SOURCE, PREFLOP_HOLD_REASON),
  holdemCommittedNoPairIsPriced: Object.freeze({ status: 'harm', reason: 'measured harm', source: 'PR #11634' }),
  holdemDangerBoardEquityIsPriced: Object.freeze({ status: 'harm', reason: 'measured harm', source: 'PR #11634' }),
  v62RiverBettorPolarity: harm('-3.67 +/- 1.02'),
});
export const OPTION_SWITCH_PREFLOP_HOLD_LIFTED = Object.freeze({
  huBbDefendsUnreadToPrice: Object.freeze({ source: 'owner', file: 'f.md', sha256: 'a'.repeat(64), readAt: '2026-11-20' }),
});
export const OPTION_SWITCH_SHADOW_REFUSED = Object.freeze({
  v66BetRaisedOnePair: 'synthetic shadow refusal for test',
});
export const OPTION_SWITCH_REFUSED = Object.freeze({
  v87DeepDiveDiscipline: 'owner hold: Pillar 2 lives inside the deep-dive discipline',
  v58MadeHandCellSkip: 'defect guard (#8144)',
});
`;
}

describe('holdem-blanket-scoreboard-lib', () => {
  describe('CLI argument parsing & input validation', () => {
    it('parses flags cleanly and applies defaults', () => {
      const defaults = parseCliArgs([]);
      expect(defaults).toEqual({
        json: false,
        offline: false,
        onlyActionable: false,
        help: false,
        telemetryDays: DEFAULT_TELEMETRY_DAYS,
        supabaseWorkdir: null,
        actions: [],
      });

      const custom = parseCliArgs([
        '--json',
        '--offline',
        '--only-actionable',
        '--telemetry-days',
        '7',
        '--action',
        'READY_FOR_SHADOW',
        '--action=COUPLED_NEEDS_SPLIT',
        '--supabase-workdir=fixtures/linked',
      ]);
      expect(custom.json).toBe(true);
      expect(custom.offline).toBe(true);
      expect(custom.onlyActionable).toBe(true);
      expect(custom.telemetryDays).toBe(7);
      expect(custom.actions).toEqual(['READY_FOR_SHADOW', 'COUPLED_NEEDS_SPLIT']);
      expect(custom.supabaseWorkdir).toBe('fixtures/linked');
    });

    it('rejects invalid telemetry days, unknown actions, and unknown flags', () => {
      expect(() => validateTelemetryDays(0)).toThrow(/Invalid --telemetry-days/);
      expect(() => validateTelemetryDays(15)).toThrow(/Invalid --telemetry-days/);
      expect(() => validateTelemetryDays(2.5)).toThrow(/Invalid --telemetry-days/);
      expect(() => parseCliArgs(['--action', 'BOGUS_ACTION'])).toThrow(/Invalid --action/);
      expect(() => parseCliArgs(['--unknown-flag'])).toThrow(/Unknown argument/);
    });
  });

  describe('SQL read-only safety, Supabase parsing & security invariants', () => {
    it('builds a single strictly read-only batched query touching all 5 required tables', () => {
      const sql = buildScoreboardBatchSql({ telemetryDays: 3 });
      expect(assertReadOnlySql(sql)).toBe(sql);
      expect(sql).toContain('public.ca_horse_style_switch');
      expect(sql).toContain('public.ca_horse_option_registry_serving');
      expect(sql).toContain('public.ca_engine_runtime_settings_active');
      expect(sql).toContain('public.ca_engine_runtime_settings_versions');
      expect(sql).toContain('public.ca_horse_option_switch_evidence');
      expect(sql).toContain('public.horse_brain_telemetry');
      expect(sql).toContain("feature LIKE 'v21_%'");
      expect(sql).not.toContain("feature LIKE 'v15_%'");
      expect(sql).not.toContain("feature LIKE 'token_call_%'");
      expect(sql).not.toContain("feature LIKE 'v46_%'");
      expect(sql).toContain('- 2');
    });

    it('rejects non-SELECT, mutating, and multi-statement SQL', () => {
      expect(() => assertReadOnlySql('DELETE FROM public.ca_horse_style_switch')).toThrow(
        /non-SELECT/
      );
      expect(() => assertReadOnlySql('SELECT 1; DROP TABLE foo')).toThrow(/multi-statement/);
      expect(() =>
        assertReadOnlySql(
          'WITH x AS (UPDATE public.ca_horse_style_switch SET state = $$off$$) SELECT * FROM x'
        )
      ).toThrow(/mutating SQL/);
    });

    it('parses Supabase CLI JSON output wrapped with workdir and update notices', () => {
      const wrapped =
        'Using workdir repo\n[{"snapshot":{"switchRows":[]}}]\nA new version of Supabase CLI is available';
      expect(parseSupabaseJsonOutput(wrapped)).toEqual([{ snapshot: { switchRows: [] } }]);
      expect(() => parseSupabaseJsonOutput('')).toThrow(/empty output/);
    });

    it('auto-resolves linked Supabase workdir via git common dir using portable paths', () => {
      const worktreeCwd = path.resolve(REPO_ROOT, 'fixtures', 'mock-worktree');
      const primaryCheckout = path.resolve(REPO_ROOT, 'fixtures', 'mock-primary-checkout');
      const resolved = resolveLinkedSupabaseWorkdir({
        cwd: worktreeCwd,
        gitCommonDirRunner: () => `${path.join(primaryCheckout, '.git')}\n`,
        pathExists: (p) => p === path.join(primaryCheckout, 'supabase', '.temp', 'project-ref'),
      });
      expect(resolved).toBe(primaryCheckout);
    });

    it('never reads .env or database secrets and strictly uses supabase --linked -o json --agent=no', () => {
      const cliSource = readFileSync(
        path.join(REPO_ROOT, 'scripts/ops/holdem-blanket-scoreboard.mjs'),
        'utf8'
      );
      const libSource = readFileSync(
        path.join(REPO_ROOT, 'scripts/ops/holdem-blanket-scoreboard-lib.mjs'),
        'utf8'
      );
      for (const [name, src] of [
        ['holdem-blanket-scoreboard.mjs', cliSource],
        ['holdem-blanket-scoreboard-lib.mjs', libSource],
      ]) {
        expect(src, `${name} must not reference dotenv`).not.toMatch(/dotenv/i);
        expect(src, `${name} must not open .env files`).not.toMatch(/readFileSync\([^)]*\.env/);
        expect(src, `${name} must not reference raw secret env vars`).not.toMatch(
          /SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|POSTGRES_URL/
        );
      }
      expect(cliSource).toContain("'--linked'");
      expect(cliSource).toContain("'-o'");
      expect(cliSource).toContain("'json'");
      expect(cliSource).toContain("'--agent=no'");
    });
  });

  describe('real repository source & docs parsing', () => {
    it('accurately parses HorseOptionSwitch.ts, HorseDataLedger.ts, HorseLogic.ts, and option docs', () => {
      const inputs = loadLocalRepoInputs(REPO_ROOT);
      const parsed = parseHorseOptionSwitchSource(inputs.horseOptionSwitchSource);
      const ledgerFlags = parseHorseDataLedgerFlags(inputs.horseDataLedgerSource);

      expect(ledgerFlags.size).toBeGreaterThan(200);
      expect(parsed.releaseDefaultOn.has('v80TopPairStrongKicker')).toBe(true);
      expect(parsed.releaseDefaultOff.has('holdemRiverFullHouseValueIsPriced')).toBe(true);
      expect(parsed.releaseDefaultOff.has('holdemTournamentAllInCallIsPriced')).toBe(true);
      expect(parsed.releaseDefaultOff.has('holdemValueAndCallsArePriced')).toBe(true);

      const refusedPillar2 = classifySourceRegistration('v87DeepDiveDiscipline', parsed, {
        ledgerFlags,
      });
      expect(refusedPillar2.registration).toBe('OPTION_SWITCH_REFUSED');

      const refusedV58 = classifySourceRegistration('v58MadeHandCellSkip', parsed, {
        ledgerFlags,
        defaultOnDoc: inputs.defaultOnDocs.v58MadeHandCellSkip,
      });
      expect(refusedV58.registration).toBe('OPTION_SWITCH_REFUSED');
      expect(refusedV58.releaseDefault).toBe('on');

      const harmOpt = classifySourceRegistration('holdemCommittedNoPairIsPriced', parsed, {
        ledgerFlags,
      });
      expect(harmOpt.registration).toBe('off_only');
      expect(harmOpt.offOnly?.status).toBe('harm');

      const ledgerOnlyReg = classifySourceRegistration('horseRiverNoBlockerBet', parsed, {
        ledgerFlags,
      });
      expect(ledgerOnlyReg.registration).toBe('registered');
      expect(ledgerOnlyReg.releaseDefault).toBe('code');

      expect(inputs.defaultOnDocs.v58MadeHandCellSkip?.allMet).toBe(true);
      expect(inputs.authorityDocs.holdemRiverFullHouseValueIsPriced?.evidenceStatus).toBe('MET');
      expect(inputs.authorityDocs.holdemValueAndCallsArePriced?.evidenceStatus).toBe('NOT_MET');

      // Live HorseLogic.ts coupling detection
      const couplings = detectSourceCouplings(inputs.horseLogicSource);
      expect(couplings.v69TurnCallGaps?.verifiedInSource).toBe(true);
      expect(couplings.v73Vs3BetDefence?.verifiedInSource).toBe(true);
    });

    it('excludes Omaha/non-NLH-only options and includes v21River with verified HorseLogic receipts', () => {
      const inputs = loadLocalRepoInputs(REPO_ROOT);
      const parsed = parseHorseOptionSwitchSource(inputs.horseOptionSwitchSource);
      const catalogOptions = new Set(HOLDEM_BLANKET_CATALOG.map((e) => e.option));

      // Omaha / short-deck only rules (zero NLH reach) must never appear in Hold'em catalog
      for (const omahaOnly of [
        'v15RiverNoNearLock',
        'v88CommitmentHonored',
        'tokenCallPrice',
        'v46Charts',
      ]) {
        expect(catalogOptions.has(omahaOnly), `${omahaOnly} must be excluded`).toBe(false);
      }

      // v21River is a real high-volume NLH river blanket rule (`!vi.isOmaha`)
      const v21Entry = HOLDEM_BLANKET_CATALOG.find((e) => e.option === 'v21River');
      expect(v21Entry).toBeDefined();
      expect(v21Entry?.role).toBe('blanket_parent');
      expect(v21Entry?.family).toBe('river_defense');
      expect(v21Entry?.receipts).toEqual([
        'v21_nut_status',
        'v21_dominated_cap',
        'v21_scare_cap',
        'v21_scare_commit',
        'v21_war_gate',
      ]);
      expect(parsed.releaseDefaultOn.has('v21River')).toBe(true);

      // Source contract: every v21River receipt must be emitted in HorseLogic.ts
      for (const receipt of v21Entry?.receipts ?? []) {
        expect(inputs.horseLogicSource).toContain(`noteFire('${receipt}')`);
      }
    });

    it('detects when v69TurnCallGaps and v73Vs3BetDefence are decoupled in HorseLogic source', () => {
      const coupledSource = `
        const shade87NlhTurnCommit =
          opts.v87DeepDiveDiscipline !== false &&
          !((opts.v69TurnCallGaps ?? true) !== false ? holdemHoleDrawPresent : holdemDrawPresent)(p, b) ? 1 : 0;
        const gtoVs3Bet73 = () => {
          if (opts.v73Vs3BetDefence === false) return undefined;
          const squeeze75 = callersOfPreviousRaise >= 1;
          if (squeeze75 && opts.v75SqueezeDefence === false) return undefined;
          return true;
        };
      `;
      const coupled = detectSourceCouplings(coupledSource);
      expect(coupled.v69TurnCallGaps?.coupled).toBe(true);
      expect(coupled.v73Vs3BetDefence?.coupled).toBe(true);

      const decoupledSource = `
        const shade87NlhTurnCommit =
          opts.v87DeepDiveDiscipline !== false &&
          !holdemHoleDrawPresent(p, b) ? 1 : 0;
        const gtoVs3Bet73 = () => {
          const squeeze75 = callersOfPreviousRaise >= 1;
          if (squeeze75 && opts.v75SqueezeDefence === false) return undefined;
          if (!squeeze75 && opts.v73Vs3BetDefence === false) return undefined;
          return true;
        };
      `;
      const decoupled = detectSourceCouplings(decoupledSource);
      expect(decoupled.v69TurnCallGaps?.coupled).toBe(false);
      expect(decoupled.v73Vs3BetDefence?.coupled).toBe(false);
    });
  });

  describe('runtime settings off-list, telemetry matching, and doc parsers', () => {
    it('extracts holdemBlanketRulesOffList across prefix and array formats without mixing PLO4/5 keys', () => {
      const res = extractHoldemOffList({
        'horse.blanketRowOffInPlo45Cash.v9Mood': 1,
        'horse.blanketRowOffInPlo45Cash.ploPairedBoardFold': 1,
        'horse.blanketRuleOffInHoldem.v80TopPairStrongKicker': 1,
        'horse.blanketRuleOffInHoldem.v79TopPairWeakKicker': 0,
        'horse.holdemBlanketRuleOff.v68TurnAirDrawCalls': 1,
        holdemBlanketRulesOffList: ['v65TurnOnePairShade'],
      });
      expect(res.plo45BlanketRowsOffCount).toBe(2);
      expect(res.holdemBlanketRulesOffList).toEqual([
        'v65TurnOnePairShade',
        'v68TurnAirDrawCalls',
        'v80TopPairStrongKicker',
      ]);
    });

    it('matches exact and wildcard telemetry receipts plus option_shadow_* receipts', () => {
      const tel = matchTelemetryForOption(
        'riverBluffBaseline',
        ['river_bluff_baseline_*'],
        [
          { feature: 'river_bluff_baseline_check', total_fires: 300, days_seen: 3 },
          { feature: 'river_bluff_baseline_junk', total_fires: 150, days_seen: 2 },
          {
            feature: 'option_shadow_riverBluffBaseline_changed_seen',
            total_fires: 12,
            days_seen: 1,
          },
          { feature: 'unrelated_feature', total_fires: 9999, days_seen: 3 },
        ],
        3
      );
      expect(tel.totalFires).toBe(450);
      expect(tel.avgFiresPerDay).toBe(150);
      expect(tel.daysSeen).toBe(3);
      expect(tel.shadowFires).toBe(12);
      expect(tel.matchedFeatures).toHaveLength(2);
    });

    it('parses default-on and authority docs cleanly', () => {
      const defDoc = parseDefaultOnDoc(
        '# opt\n\n## Mechanism\n\nStatus: MET\n\n## Limits\n\nStatus: NOT APPLICABLE\n',
        'docs/horse-default-on.d/opt.md'
      );
      expect(defDoc.metCount).toBe(1);
      expect(defDoc.naCount).toBe(1);
      expect(defDoc.allMet).toBe(true);

      const authContent =
        '# opt\n\nState: OFF. Evidence MET.\n\n## Replay\n\n- Replay: fixed 10; newlyWrong 1; changed 11\n';
      const authDoc = parseAuthorityDoc(authContent, 'docs/horse-option-authority.d/opt.md');
      expect(authDoc.evidenceStatus).toBe('MET');
      expect(authDoc.sha256).toBe(sha256Hex(authContent));
      expect(authDoc.replayRowCount).toBe(1);
    });
  });

  describe('all 7 deterministic next-action classifications & scoreboard summary', () => {
    it('classifies all 7 next actions, global shadow slot, evidence SHA parity, and auto-discovery', () => {
      const authLiveContent = '# holdemRiverFullHouseValueIsPriced\n\nEvidence MET.\n';
      const authLiveDoc = parseAuthorityDoc(
        authLiveContent,
        'docs/horse-option-authority.d/holdemRiverFullHouseValueIsPriced.md'
      );
      const authNewPriced = parseAuthorityDoc(
        '# v63LargeRiverBetShadeIsPriced\n\nEvidence NOT MET.\n',
        'docs/horse-option-authority.d/v63LargeRiverBetShadeIsPriced.md'
      );

      const report = buildHoldemBlanketScoreboard({
        horseOptionSwitchSource: makeSyntheticSwitchSource(['v63LargeRiverBetShadeIsPriced']),
        horseDataLedgerSource: `
          flag('horseRiverNoBlockerBet')
          flag('holdemHeadsUpPostflopBalance')
          flag('v63LargeRiverBetShadeIsPriced')
        `,
        horseLogicSource: '',
        defaultOnDocs: {},
        authorityDocs: {
          holdemRiverFullHouseValueIsPriced: authLiveDoc,
          v63LargeRiverBetShadeIsPriced: authNewPriced,
        },
        dbSnapshot: {
          switchRows: [
            {
              option: 'holdemRiverFullHouseValue',
              state: 'on',
              updated_at: '2026-11-21T01:00:00Z',
              updated_by: 'ops',
            },
            {
              option: 'holdemRiverFullHouseValueIsPriced',
              state: 'on',
              updated_at: '2026-11-21T01:19:00Z',
              updated_by: 'ops',
            },
            {
              option: 'holdemTournamentAllInCallIsPriced',
              state: 'on',
              updated_at: '2026-11-22T14:07:00Z',
              updated_by: 'ops',
            },
            // Activate holdemValueAndCallsArePriced so its non-nested parents become PRICED_CHILD_LIVE_READY_TO_RETIRE_BLANKET
            {
              option: 'holdemValueAndCallsArePriced',
              state: 'on',
              updated_at: '2026-11-22T14:10:00Z',
              updated_by: 'ops',
            },
            // Explicitly retire v61RiverOnePairShade via switch OFF
            {
              option: 'v61RiverOnePairShade',
              state: 'off',
              updated_at: '2026-11-22T14:12:00Z',
              updated_by: 'ops',
            },
            // Occupy the global shadow slot with an Omaha option
            {
              option: 'omahaMathCorePlo5Flop',
              state: 'shadow',
              updated_at: '2026-11-22T14:15:00Z',
              updated_by: 'plo',
            },
          ],
          servingRows: [
            {
              release_sha: 'b31db252025bf65d1b07de7e356d2f56dd2c1daf',
              registry_digest: 'abc123',
              seen_at: '2026-11-22T14:20:00Z',
              age_sec: 18,
              registry: {
                v65TurnOnePairShade: ['off', 'shadow', 'on_shadow', 'on'],
                v67RiverBetRaisedOnePair: ['off', 'shadow', 'on_shadow', 'on'],
                v80TopPairStrongKicker: ['off', 'shadow', 'on_shadow', 'on'],
                v66BetRaisedOnePair: ['off', 'on'],
              },
            },
          ],
          runtimeSettings: {
            version: 11,
            activated_at: '2026-11-22T14:00:00Z',
            actor: 'switch-lane',
            note: 'retire v67 via off-list',
            settings: {
              'horse.blanketRuleOffInHoldem.v67RiverBetRaisedOnePair': 1,
            },
          },
          evidenceRows: [
            {
              id: 70,
              option: 'holdemRiverFullHouseValueIsPriced',
              evidence_path: 'docs/horse-option-authority.d/holdemRiverFullHouseValueIsPriced.md',
              evidence_sha256: authLiveDoc.sha256,
              kind: 'evidence',
              recorded_at: '2026-11-21T01:19:00Z',
            },
          ],
          telemetryRows: [
            { feature: 'v65_turn_one_pair_shade', total_fires: 900, days_seen: 3 },
            { feature: 'v57_turn_cell_initiative_skip', total_fires: 300, days_seen: 3 },
            { feature: 'v21_nut_status', total_fires: 1200, days_seen: 3 },
            { feature: 'v21_scare_commit', total_fires: 150, days_seen: 3 },
            { feature: 'v21_war_gate', total_fires: 90, days_seen: 3 },
            { feature: 'v21_dominated_cap', total_fires: 60, days_seen: 2 },
            {
              feature: 'option_shadow_v57TournamentAggression_same_seen',
              total_fires: 50,
              days_seen: 1,
            },
          ],
        },
        telemetryDays: 3,
        now: new Date('2026-11-22T14:25:00Z'),
      });

      const byOpt = new Map(report.rules.map((r) => [r.option, r]));

      // 1. READY_FOR_SHADOW
      expect(byOpt.get('v65TurnOnePairShade')?.nextAction).toBe('READY_FOR_SHADOW');
      expect(byOpt.get('v65TurnOnePairShade')?.telemetry.avgFiresPerDay).toBe(300);
      expect(byOpt.get('v21River')?.nextAction).toBe('READY_FOR_SHADOW');
      expect(byOpt.get('v21River')?.telemetry.totalFires).toBe(1500);
      expect(byOpt.get('v21River')?.telemetry.avgFiresPerDay).toBe(500);

      // 2. READY_FOR_OFF_AFTER_GRADE (via dev cards, via observed shadow receipts, AND via shadow-refused)
      expect(byOpt.get('v80TopPairStrongKicker')?.nextAction).toBe('READY_FOR_OFF_AFTER_GRADE');
      expect(byOpt.get('v57TournamentAggression')?.nextAction).toBe('READY_FOR_OFF_AFTER_GRADE');
      expect(byOpt.get('v66BetRaisedOnePair')?.nextAction).toBe('READY_FOR_OFF_AFTER_GRADE');

      // 3. AWAITING_PRICED_CHILD_GRADE (auto-discovered priced child + its blanket parent!)
      expect(byOpt.get('v63LargeRiverBetShadeIsPriced')?.autoDiscovered).toBe(true);
      expect(byOpt.get('v63LargeRiverBetShadeIsPriced')?.nextAction).toBe(
        'AWAITING_PRICED_CHILD_GRADE'
      );
      expect(byOpt.get('v63LargeRiverBetShade')?.nextAction).toBe('AWAITING_PRICED_CHILD_GRADE');
      expect(byOpt.get('horseRiverNoBlockerBet')?.nextAction).toBe('AWAITING_PRICED_CHILD_GRADE');

      // 4. PRICED_CHILD_LIVE_READY_TO_RETIRE_BLANKET (non-nested parents of live holdemValueAndCallsArePriced)
      expect(byOpt.get('v87RiverBlockBetTrap')?.nextAction).toBe(
        'PRICED_CHILD_LIVE_READY_TO_RETIRE_BLANKET'
      );
      expect(byOpt.get('v87FlopStabCheckRaise')?.nextAction).toBe(
        'PRICED_CHILD_LIVE_READY_TO_RETIRE_BLANKET'
      );

      // 5. LIVE_PRICED_COMPLETE (live priced child, nested parent, switch-off blanket, off-list blanket)
      expect(byOpt.get('holdemRiverFullHouseValueIsPriced')?.nextAction).toBe(
        'LIVE_PRICED_COMPLETE'
      );
      expect(byOpt.get('holdemRiverFullHouseValueIsPriced')?.evidence.matchesAuthorityDocSha).toBe(
        true
      );
      expect(byOpt.get('holdemRiverFullHouseValue')?.nextAction).toBe('LIVE_PRICED_COMPLETE');
      expect(byOpt.get('v61RiverOnePairShade')?.nextAction).toBe('LIVE_PRICED_COMPLETE');
      expect(byOpt.get('v67RiverBetRaisedOnePair')?.inOffList).toBe(true);
      expect(byOpt.get('v67RiverBetRaisedOnePair')?.nextAction).toBe('LIVE_PRICED_COMPLETE');

      // 6. HELD_PREFLOP_OR_OWNER
      expect(byOpt.get('v87DeepDiveDiscipline')?.nextAction).toBe('HELD_PREFLOP_OR_OWNER');
      expect(byOpt.get('v58MadeHandCellSkip')?.nextAction).toBe('HELD_PREFLOP_OR_OWNER');
      expect(byOpt.get('holdemCommittedNoPairIsPriced')?.nextAction).toBe('HELD_PREFLOP_OR_OWNER');
      expect(byOpt.get('v70GtoOpeningRanges')?.nextAction).toBe('HELD_PREFLOP_OR_OWNER');

      // 7. COUPLED_NEEDS_SPLIT
      expect(byOpt.get('v69TurnCallGaps')?.nextAction).toBe('COUPLED_NEEDS_SPLIT');
      expect(byOpt.get('v73Vs3BetDefence')?.nextAction).toBe('COUPLED_NEEDS_SPLIT');
      expect(byOpt.get('v87HoldemOverhaul')?.nextAction).toBe('COUPLED_NEEDS_SPLIT');

      // Global shadow slot occupied by Omaha option
      expect(report.globalShadowSlot.occupied).toBe(true);
      expect(report.globalShadowSlot.status).toBe('OCCUPIED');
      expect(report.globalShadowSlot.activeOptions[0].option).toBe('omahaMathCorePlo5Flop');

      // Summary counts sum to totalTrackedRules across all 7 next actions
      const actionSum = NEXT_ACTIONS.reduce(
        (acc, a) => acc + (report.summary.byNextAction[a] ?? 0),
        0
      );
      expect(actionSum).toBe(report.summary.totalTrackedRules);
      expect(report.summary.totalTrackedRules).toBe(HOLDEM_BLANKET_CATALOG.length + 1);
      expect(report.summary.livePricedReplacementsOn).toBe(3);
      expect(report.summary.retiredBlankets).toBe(3); // holdemRiverFullHouseValue (nested) + v61 (off) + v67 (off-list)
      expect(report.summary.remainingCoupledBlankets).toBe(3);

      // Markdown & filtering checks
      const md = formatScoreboardMarkdown(report);
      expect(md).toContain("## Hold'em Blanket Rules");
      expect(md).toContain('## Priced Replacements');
      expect(md).toContain('**OCCUPIED**');
      expect(md).toContain('v67RiverBetRaisedOnePair');
      expect(md).toContain('PRICED_CHILD_LIVE_READY_TO_RETIRE_BLANKET');

      const actionable = filterScoreboardRules(report, { onlyActionable: true });
      expect(actionable.every((r) => r.nextAction !== 'HELD_PREFLOP_OR_OWNER')).toBe(true);
      expect(actionable.every((r) => r.nextAction !== 'LIVE_PRICED_COMPLETE')).toBe(true);
    });
  });

  describe('CLI runner end-to-end (mocked deps & offline mode)', () => {
    it('runs cleanly in --offline --json mode against real repo files without touching DB', async () => {
      const stdoutLines: string[] = [];
      let dbCalled = false;
      const res = await runCli(['--offline', '--json', '--action', 'COUPLED_NEEDS_SPLIT'], {
        querySupabase: async () => {
          dbCalled = true;
          return [];
        },
        stdout: (msg: string) => stdoutLines.push(msg),
        now: () => new Date('2026-11-22T14:30:00Z'),
      });
      expect(res.exitCode).toBe(0);
      expect(dbCalled).toBe(false);
      const parsed = JSON.parse(stdoutLines.join('\n'));
      expect(parsed.dbOnline).toBe(false);
      expect(parsed.globalShadowSlot.status).toBe('UNKNOWN_OFFLINE');
      expect(parsed.rules.length).toBeGreaterThan(0);
      expect(
        parsed.rules.every((r: { nextAction: string }) => r.nextAction === 'COUPLED_NEEDS_SPLIT')
      ).toBe(true);
    });

    it('exits with code 2 on invalid CLI arguments', async () => {
      const stderrLines: string[] = [];
      const res = await runCli(['--bad-flag'], {
        stderr: (msg: string) => stderrLines.push(msg),
      });
      expect(res.exitCode).toBe(2);
      expect(stderrLines.join('\n')).toContain('Unknown argument');
    });
  });
});
