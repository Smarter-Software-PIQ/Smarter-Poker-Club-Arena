// tests/unit/horseOptionSwitchCli.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  LEGAL_STATES,
  assertSafeOptionName,
  assertSafeSha256,
  assertSafeState,
  buildPickupTelemetrySql,
  buildRegistryRefusalSql,
  buildSwitchNote,
  buildSwitchSetSql,
  checkAuditSpacing,
  checkHardForbiddenOption,
  checkMaintenanceAndCutoverHold,
  checkNestedChildDependency,
  checkServingRegistry,
  checkShadowConcurrency,
  MAX_CONCURRENT_SHADOW_ROWS,
  buildPerOptionStageCountersSql,
  perOptionStageCountersServing,
  styleOptionsOfRegistries,
  checkUtcWindowAndBlackout,
  evaluateInboxFreezeState,
  evaluatePickup,
  evaluatePreflight,
  extractAlarmBaseline,
  formatSwitchChangeLogLine,
  inferLaneFromActor,
  parseAlarmBaselineJson,
  parseAuthorityDocEvidence,
  parseCliArgs,
  parseReleaseDefaultOnOptions,
  parseSupabaseQueryJson,
  sqlLiteral,
} from '../../scripts/ops/horse-option-switch-lib.mjs';
import { readWhitelistStates, runCli } from '../../scripts/ops/horse-option-switch.mjs';

const VALID_SHA = 'a'.repeat(64);
const SERVING_SHA = '1a0a6047e1acb1a037cd43b36d9907a00103c5e4';
const SAFE_NOW = new Date('2026-11-21T15:20:00Z'); // :20 UTC, outside 09:05Z-10:45Z blackout

function healthyEngine(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    liveness: 'ok',
    releaseSha: SERVING_SHA,
    maintenance: {
      active: false,
      phase: 'idle',
      durableConfirmed: false,
      readyForRestart: false,
    },
    liveHorseDecision: {
      phase: 'ready',
      upgradeManifest: { sourceRevision: SERVING_SHA },
    },
    ...overrides,
  };
}

function baseServingRegistry(
  options: Record<string, string[]> = {
    styleTightPlayerExploit: ['off', 'shadow', 'on_shadow', 'on'],
    holdemPersonaPostflop: ['off', 'shadow', 'on_shadow', 'on'],
    holdemRiverFullHouseValue: ['off', 'shadow', 'on_shadow', 'on'],
    holdemRiverFullHouseValueIsPriced: ['off', 'shadow', 'on_shadow', 'on'],
    v16Hu: ['off'],
  }
) {
  return [
    {
      release_sha: SERVING_SHA,
      registry: options,
      seen_at: '2026-11-21T15:19:45Z',
    },
  ];
}

const METAUTHORITY_DOC =
  '# styleTightPlayerExploit: authority\n\n**State: OFF**. Evidence MET (replay row below).\n';

function basePreflightInput(overrides: Record<string, unknown> = {}) {
  return {
    option: 'styleTightPlayerExploit',
    targetState: 'on_shadow',
    nowUtc: SAFE_NOW,
    changedBy: 'Horse SWITCH lane (Antigravity session 151f9a34)',
    reason: 'SHADOW-PLAN-1 step 2 measurement',
    authority: 'docs/horse-option-authority.d/styleTightPlayerExploit.md',
    evidenceSha: VALID_SHA,
    isRollback: false,
    allowWindowOverride: false,
    currentRows: [{ option: 'styleTightPlayerExploit', state: 'on' }],
    auditRows: [
      {
        id: 170,
        option: 'omahaStreetPlan',
        old_state: 'on',
        new_state: 'off',
        changed_by: 'PLO-OWNER lead-2',
        changed_at: '2026-11-21T14:50:00Z', // 30 min ago (other lane -> > 10m ok)
      },
    ],
    servingRegistries: baseServingRegistry(),
    registryRefusal: null,
    evidenceRecorded: true,
    dbMaintenance: { platformFrozen: false, breakRows: [], windowRows: [] },
    ownerWindowsConfig: { version: 1, windows: [] },
    engineHealth: healthyEngine(),
    recentConfigAlarms: [],
    authorityEvidence: 'met',
    ...overrides,
  };
}

describe('Horse Option Switch CLI — core guards & lib', () => {
  describe('Legal states and on_shadow support', () => {
    it('supports all 4 legal states including on_shadow and rejects invalid states', () => {
      expect(LEGAL_STATES).toEqual(['off', 'shadow', 'on_shadow', 'on']);
      for (const s of LEGAL_STATES) {
        expect(assertSafeState(s)).toBe(s);
      }
      expect(() => assertSafeState('canary')).toThrow(/Invalid target state/);
      expect(() => assertSafeState("on'; DROP TABLE ca_horse_style_switch;--")).toThrow(
        /Invalid target state/
      );
    });

    it('passes full preflight for an on_shadow transition when all guards are satisfied', () => {
      const res = evaluatePreflight(basePreflightInput());
      expect(res.ok).toBe(true);
      expect(res.failures).toEqual([]);
      expect(res.currentState).toBe('on');
    });

    it('refuses on_shadow when authority or evidenceSha is missing or unrecorded', () => {
      const missingAuth = evaluatePreflight(basePreflightInput({ authority: '' }));
      expect(missingAuth.ok).toBe(false);
      expect(missingAuth.failures.map((f) => f.code)).toContain('AUTHORITY_REQUIRED');

      const missingSha = evaluatePreflight(basePreflightInput({ evidenceSha: '' }));
      expect(missingSha.ok).toBe(false);
      expect(missingSha.failures.map((f) => f.code)).toContain('EVIDENCE_SHA_REQUIRED');

      const unrecorded = evaluatePreflight(basePreflightInput({ evidenceRecorded: false }));
      expect(unrecorded.ok).toBe(false);
      expect(unrecorded.failures.map((f) => f.code)).toContain('EVIDENCE_NOT_RECORDED');
    });

    // 2026-11-26: since list-once (20261125234502) the database keeps its own option whitelist, apart from the
    // serving engine's registry. A preflight that read only the engine passed for a state the database then
    // refused at write time, after the pre-notice and the VERIFIER-10 confirmation.
    it('refuses a state the database whitelist does not give the option, and an option it does not register', () => {
      const notRegistered = evaluatePreflight(basePreflightInput({ whitelistStates: null }));
      expect(notRegistered.ok).toBe(false);
      expect(notRegistered.failures.map((f: { code: string }) => f.code)).toContain(
        'OPTION_NOT_WHITELISTED'
      );

      const offOnly = evaluatePreflight(basePreflightInput({ whitelistStates: ['off'] }));
      expect(offOnly.ok).toBe(false);
      expect(offOnly.failures.map((f: { code: string }) => f.code)).toContain(
        'STATE_NOT_IN_WHITELIST'
      );

      const fits = evaluatePreflight(
        basePreflightInput({ whitelistStates: ['off', 'shadow', 'on_shadow', 'on'] })
      );
      const codes = [...fits.failures, ...fits.warnings].map((f: { code: string }) => f.code);
      expect(codes).not.toContain('OPTION_NOT_WHITELISTED');
      expect(codes).not.toContain('STATE_NOT_IN_WHITELIST');
      expect(codes).not.toContain('WHITELIST_NOT_READ');

      const unread = evaluatePreflight(basePreflightInput({ whitelistStates: undefined }));
      expect(unread.failures.map((f: { code: string }) => f.code)).not.toContain(
        'STATE_NOT_IN_WHITELIST'
      );
      expect(unread.warnings.map((f: { code: string }) => f.code)).toContain('WHITELIST_NOT_READ');
    });

    it('reads the whitelist states as the database CLI returns them, and fails open only to "not read"', () => {
      const sqlSeen: string[] = [];
      const q = (rows: unknown) => (sql: string) => {
        sqlSeen.push(sql);
        return rows as Record<string, unknown>[];
      };
      expect(readWhitelistStates(q([{ states: '{off,shadow,on_shadow,on}' }]), 'v16Hu')).toEqual([
        'off',
        'shadow',
        'on_shadow',
        'on',
      ]);
      expect(readWhitelistStates(q([{ states: ['off'] }]), 'v16Hu')).toEqual(['off']);
      expect(readWhitelistStates(q([{ states: '{}' }]), 'v16Hu')).toEqual([]);
      expect(readWhitelistStates(q([{ states: null }]), 'v16Hu')).toBeNull();
      expect(readWhitelistStates(q([]), 'v16Hu')).toBeUndefined();
      expect(
        readWhitelistStates(() => {
          throw new Error('function public.fn_ca_horse_option_switch_states(text) does not exist');
        }, 'v16Hu')
      ).toBeUndefined();
      expect(sqlSeen[0]).toBe("SELECT public.fn_ca_horse_option_switch_states('v16Hu') AS states;");
    });

    it('refuses on / on_shadow unless the cited authority file states "Evidence MET"', () => {
      for (const authorityEvidence of ['not_met', 'none', 'unreadable', null]) {
        for (const targetState of ['on', 'on_shadow']) {
          const res = evaluatePreflight(basePreflightInput({ targetState, authorityEvidence }));
          expect(res.ok).toBe(false);
          expect(res.failures.map((f) => f.code)).toContain('AUTHORITY_EVIDENCE_NOT_MET');
        }
      }
      // A rollback only restores a state that was live, so it is exempt.
      const rollback = evaluatePreflight(
        basePreflightInput({ targetState: 'on', isRollback: true, authorityEvidence: 'not_met' })
      );
      expect(rollback.failures.map((f) => f.code)).not.toContain('AUTHORITY_EVIDENCE_NOT_MET');
      // off / shadow are not switch-ons and do not need it.
      const off = evaluatePreflight(
        basePreflightInput({ targetState: 'off', authorityEvidence: 'not_met' })
      );
      expect(off.failures.map((f) => f.code)).not.toContain('AUTHORITY_EVIDENCE_NOT_MET');
    });

    it('reads the evidence claim from the status paragraph exactly as the replay law does', () => {
      expect(parseAuthorityDocEvidence(METAUTHORITY_DOC)).toBe('met');
      expect(
        parseAuthorityDocEvidence('# x\n\n**State: LIVE ON**. Evidence NOT MET against the bar.\n')
      ).toBe('not_met');
      expect(parseAuthorityDocEvidence('# x\n\n**State: OFF**.\n\nLater: Evidence MET.\n')).toBe(
        'none'
      );
      expect(parseAuthorityDocEvidence('no title, Evidence MET')).toBe('none');
      // The file that was switched on with "Evidence NOT MET" on 2026-11-22 (audit #185) is refused.
      const packet2 = readFileSync(
        resolve('docs/horse-option-authority.d/holdemValueAndCallsArePriced.md'),
        'utf8'
      );
      expect(parseAuthorityDocEvidence(packet2)).toBe('not_met');
    });

    it('allows rollback from on_shadow back to on and from shadow back to off', () => {
      const rollbackOnShadow = evaluatePreflight(
        basePreflightInput({
          targetState: 'on',
          isRollback: true,
          currentRows: [{ option: 'styleTightPlayerExploit', state: 'on_shadow' }],
          auditRows: [
            {
              id: 172,
              option: 'styleTightPlayerExploit',
              old_state: 'on',
              new_state: 'on_shadow',
              changed_by: 'Horse SWITCH lane (session A)',
              changed_at: '2026-11-21T14:55:00Z', // 25 min ago same lane -> exempt on rollback
            },
          ],
        })
      );
      expect(rollbackOnShadow.ok).toBe(true);

      const rollbackShadow = evaluatePreflight(
        basePreflightInput({
          option: 'holdemPersonaPostflop',
          targetState: 'off',
          isRollback: true,
          authority: '',
          evidenceSha: '',
          currentRows: [{ option: 'holdemPersonaPostflop', state: 'shadow' }],
          auditRows: [
            {
              id: 172,
              option: 'holdemPersonaPostflop',
              old_state: 'off',
              new_state: 'shadow',
              changed_by: 'Horse SWITCH lane (session A)',
              changed_at: '2026-11-21T15:18:00Z', // 2 min ago same option -> exempt on rollback
            },
          ],
        })
      );
      expect(rollbackShadow.ok).toBe(true);
    });
  });

  describe('Serving registry & fn_ca_horse_option_registry_refusal guard', () => {
    it('refuses when fn_ca_horse_option_registry_refusal returns a refusal message', () => {
      const res = checkServingRegistry({
        option: 'styleTightPlayerExploit',
        targetState: 'on_shadow',
        registryRefusal: 'the serving engine release 1a0a6047e1ac does not support state on_shadow',
        servingRegistries: baseServingRegistry(),
      });
      expect(res.ok).toBe(false);
      expect(res.code).toBe('SERVING_REGISTRY_REFUSAL');
    });

    it('fails closed when no fresh serving registry has been published in the last 5 minutes', () => {
      const res = checkServingRegistry({
        option: 'styleTightPlayerExploit',
        targetState: 'on_shadow',
        registryRefusal: null,
        servingRegistries: [],
      });
      expect(res.ok).toBe(false);
      expect(res.code).toBe('NO_FRESH_SERVING_REGISTRY');
    });

    it('refuses when any fresh serving registry omits the option or target state', () => {
      const missingOpt = checkServingRegistry({
        option: 'brandNewOption',
        targetState: 'off',
        registryRefusal: null,
        servingRegistries: baseServingRegistry(),
      });
      expect(missingOpt.ok).toBe(false);
      expect(missingOpt.code).toBe('OPTION_NOT_IN_SERVING_REGISTRY');

      const offOnly = checkServingRegistry({
        option: 'v16Hu',
        targetState: 'on',
        registryRefusal: null,
        servingRegistries: baseServingRegistry(),
      });
      expect(offOnly.ok).toBe(false);
      expect(offOnly.code).toBe('STATE_NOT_SUPPORTED_BY_SERVING_REGISTRY');
    });
  });

  describe('Hard-forbidden options & nested priced child dependencies', () => {
    it('refuses switching holdemRiverFullHouseValue to off while holdemRiverFullHouseValueIsPriced is on or on_shadow', () => {
      const whileOn = checkNestedChildDependency('holdemRiverFullHouseValue', 'off', [
        { option: 'holdemRiverFullHouseValue', state: 'on' },
        { option: 'holdemRiverFullHouseValueIsPriced', state: 'on' },
      ]);
      expect(whileOn.ok).toBe(false);
      expect(whileOn.code).toBe('NESTED_PRICED_CHILD_ACTIVE');

      const whileOnShadow = checkNestedChildDependency('holdemRiverFullHouseValue', 'off', [
        { option: 'holdemRiverFullHouseValue', state: 'on' },
        { option: 'holdemRiverFullHouseValueIsPriced', state: 'on_shadow' },
      ]);
      expect(whileOnShadow.ok).toBe(false);
      expect(whileOnShadow.code).toBe('NESTED_PRICED_CHILD_ACTIVE');

      const whenChildOff = checkNestedChildDependency('holdemRiverFullHouseValue', 'off', [
        { option: 'holdemRiverFullHouseValue', state: 'on' },
        { option: 'holdemRiverFullHouseValueIsPriced', state: 'off' },
      ]);
      expect(whenChildOff.ok).toBe(true);
    });

    it('refuses Pillar 2, owner-held, withdrawn, and phase-pack options unconditionally', () => {
      for (const opt of [
        'v87DeepDiveDiscipline',
        'v87ShouldSuppressOmahaPositionStab',
        'v41Leaks',
        'v31GtoSuitAware',
        'v53PloTourneyIcm',
        'vpipFloorDeepStackOff',
        'omahaPreflopCallWithActionBehind',
        'phase14',
        'futurePillarTwoGuard',
        'customLeakMapRule',
        'v31SolverProbe',
      ]) {
        const res = checkHardForbiddenOption(opt);
        expect(res.ok, `expected ${opt} to be refused`).toBe(false);
      }

      // Even --rollback must not bypass Pillar 2 / owner holds
      const pf = evaluatePreflight(
        basePreflightInput({
          option: 'v87DeepDiveDiscipline',
          targetState: 'off',
          isRollback: true,
        })
      );
      expect(pf.ok).toBe(false);
      expect(pf.failures.some((f) => f.code === 'HARD_FORBIDDEN_OPTION')).toBe(true);
    });
  });

  describe('Shadow concurrency & SHADOW-PLAN-1 safety', () => {
    it('refuses entering shadow or on_shadow when any lane already has a shadow or on_shadow row', () => {
      const otherShadow = checkShadowConcurrency({
        option: 'holdemPersonaPostflop',
        targetState: 'on_shadow',
        currentRows: [
          { option: 'styleTightPlayerExploit', state: 'on_shadow' },
          { option: 'holdemPersonaPostflop', state: 'on' },
        ],
      });
      expect(otherShadow.ok).toBe(false);
      expect(otherShadow.code).toBe('SHADOW_CONCURRENCY_VIOLATION');

      const otherPlainShadow = checkShadowConcurrency({
        option: 'holdemPersonaPostflop',
        targetState: 'shadow',
        currentRows: [{ option: 'v16Ratio', state: 'shadow' }],
      });
      expect(otherPlainShadow.ok).toBe(false);
      expect(otherPlainShadow.code).toBe('SHADOW_CONCURRENCY_VIOLATION');
    });

    it('admits up to MAX_CONCURRENT_SHADOW_ROWS non-style rows once the serving release counts per option (2026-11-27)', () => {
      // the switch lib mirrors the engine's constant (server/src/engine/HorseOptionShadowStage.ts)
      const stageSource = readFileSync(
        resolve('server/src/engine/HorseOptionShadowStage.ts'),
        'utf8'
      );
      const engineMax = /export const OPTION_SHADOW_STAGE_MAX_ROWS = (\d+);/.exec(stageSource);
      expect(engineMax).not.toBeNull();
      expect(MAX_CONCURRENT_SHADOW_ROWS).toBe(Number(engineMax![1]));
      const rows = [
        { option: 'omahaFlopPressureCapIsPriced', state: 'shadow' },
        { option: 'omahaRiverBluffIsPricedOnRangeAdvantage', state: 'shadow' },
      ];
      const ok = checkShadowConcurrency({
        option: 'omahaReraisedPotFoldReraiseIsPriced',
        targetState: 'shadow',
        currentRows: rows,
        perOptionStageCounters: true,
      });
      expect(ok.ok).toBe(true);
      // without the proof the old rule holds
      expect(
        checkShadowConcurrency({
          option: 'omahaReraisedPotFoldReraiseIsPriced',
          targetState: 'shadow',
          currentRows: rows.slice(0, 1),
        }).code
      ).toBe('SHADOW_CONCURRENCY_VIOLATION');
      // a fourth row is refused
      expect(
        checkShadowConcurrency({
          option: 'holdemRiverBluffIsPricedOnPeople',
          targetState: 'shadow',
          currentRows: [
            ...rows,
            { option: 'omahaReraisedPotFoldReraiseIsPriced', state: 'shadow' },
          ],
          perOptionStageCounters: true,
        }).code
      ).toBe('SHADOW_CONCURRENCY_VIOLATION');
      // a style option, or a style row already in shadow, keeps one row
      const style = new Set(['styleTightPlayerExploit']);
      expect(
        checkShadowConcurrency({
          option: 'styleTightPlayerExploit',
          targetState: 'shadow',
          currentRows: rows.slice(0, 1),
          perOptionStageCounters: true,
          styleOptions: style,
        }).code
      ).toBe('SHADOW_CONCURRENCY_VIOLATION');
      expect(
        checkShadowConcurrency({
          option: 'omahaReraisedPotFoldReraiseIsPriced',
          targetState: 'shadow',
          currentRows: [{ option: 'styleTightPlayerExploit', state: 'shadow' }],
          perOptionStageCounters: true,
          styleOptions: style,
        }).code
      ).toBe('SHADOW_CONCURRENCY_VIOLATION');
      // the proof: every fresh serving release seen timing per-option re-decisions
      const serving = [{ release_sha: 'a' }, { release_sha: 'b' }];
      expect(
        perOptionStageCountersServing(serving, [
          { release_sha: 'a', n: 3 },
          { release_sha: 'b', n: 1 },
        ])
      ).toBe(true);
      expect(perOptionStageCountersServing(serving, [{ release_sha: 'a', n: 3 }])).toBe(false);
      expect(perOptionStageCountersServing([], [])).toBe(false);
      expect(buildPerOptionStageCountersSql()).toContain(
        'option\\_shadow\\_stage\\_redecide\\_opt\\_%'
      );
      expect(
        styleOptionsOfRegistries([{ registry: { a: ['off', 'canary'], b: ['off', 'shadow'] } }])
      ).toEqual(new Set(['a']));
    });

    it('refuses moving a live ON non-default-on row to plain shadow (must use on_shadow)', () => {
      const res = checkShadowConcurrency({
        option: 'styleTightPlayerExploit',
        targetState: 'shadow',
        currentRows: [{ option: 'styleTightPlayerExploit', state: 'on' }],
        releaseDefaultOn: false,
      });
      expect(res.ok).toBe(false);
      expect(res.code).toBe('SHADOW_WOULD_DISABLE_LIVE_ON_ROW');
    });
  });

  describe('UTC minute window (:06-:43) and 09:05Z-10:45Z daily blackout', () => {
    it('allows :06 through :43 outside the daily blackout', () => {
      expect(checkUtcWindowAndBlackout({ nowUtc: '2026-11-21T14:06:00Z' }).ok).toBe(true);
      expect(checkUtcWindowAndBlackout({ nowUtc: '2026-11-21T14:43:59Z' }).ok).toBe(true);
      expect(checkUtcWindowAndBlackout({ nowUtc: '2026-11-21T08:43:00Z' }).ok).toBe(true);
      expect(checkUtcWindowAndBlackout({ nowUtc: '2026-11-21T11:06:00Z' }).ok).toBe(true);
    });

    it('refuses minutes outside :06-:43 and refuses 09:05Z-10:45Z blackout', () => {
      expect(checkUtcWindowAndBlackout({ nowUtc: '2026-11-21T14:05:59Z' }).code).toBe(
        'OUTSIDE_UTC_MINUTE_WINDOW'
      );
      expect(checkUtcWindowAndBlackout({ nowUtc: '2026-11-21T14:44:00Z' }).code).toBe(
        'OUTSIDE_UTC_MINUTE_WINDOW'
      );
      expect(checkUtcWindowAndBlackout({ nowUtc: '2026-11-21T09:05:00Z' }).code).toBe(
        'DAILY_BLACKOUT_WINDOW'
      );
      expect(checkUtcWindowAndBlackout({ nowUtc: '2026-11-21T09:20:00Z' }).code).toBe(
        'DAILY_BLACKOUT_WINDOW'
      );
      expect(checkUtcWindowAndBlackout({ nowUtc: '2026-11-21T10:25:00Z' }).code).toBe(
        'DAILY_BLACKOUT_WINDOW'
      );
      expect(checkUtcWindowAndBlackout({ nowUtc: '2026-11-21T10:45:00Z' }).code).toBe(
        'DAILY_BLACKOUT_WINDOW'
      );
    });

    it('allows window override ONLY for explicit rollback with non-empty reason', () => {
      const nonRollback = checkUtcWindowAndBlackout({
        nowUtc: '2026-11-21T09:30:00Z',
        isRollback: false,
        allowWindowOverride: true,
        reason: 'trying to push forward',
      });
      expect(nonRollback.ok).toBe(false);
      expect(nonRollback.code).toBe('WINDOW_OVERRIDE_ROLLBACK_ONLY');

      const missingReason = checkUtcWindowAndBlackout({
        nowUtc: '2026-11-21T09:30:00Z',
        isRollback: true,
        allowWindowOverride: true,
        reason: '   ',
      });
      expect(missingReason.ok).toBe(false);
      expect(missingReason.code).toBe('WINDOW_OVERRIDE_REASON_REQUIRED');

      const validRollback = checkUtcWindowAndBlackout({
        nowUtc: '2026-11-21T09:30:00Z',
        isRollback: true,
        allowWindowOverride: true,
        reason: 'emergency alarm rollback',
      });
      expect(validRollback.ok).toBe(true);
      expect(validRollback.overridden).toBe(true);
    });
  });

  describe('Cross-lane (>=10m) and self-lane (>=60m, rollback exempt) audit spacing', () => {
    it('enforces >=10 min cross-lane spacing and >=60 min self-lane spacing', () => {
      expect(inferLaneFromActor('Horse SWITCH lane (session 151f9a34)')).toBe('horse-switch');
      expect(inferLaneFromActor('PLO-OWNER lead-2 (Claude)')).toBe('plo-owner');

      const crossTooClose = checkAuditSpacing({
        nowUtc: '2026-11-21T15:20:00Z',
        changedBy: 'Horse SWITCH lane (session 151f9a34)',
        option: 'holdemPersonaPostflop',
        auditRows: [
          {
            option: 'omahaStreetPlan',
            new_state: 'off',
            changed_by: 'PLO-OWNER lead-2',
            changed_at: '2026-11-21T15:14:00Z', // 6 min ago
          },
        ],
      });
      expect(crossTooClose.ok).toBe(false);
      expect(crossTooClose.code).toBe('CROSS_LANE_SPACING_VIOLATION');

      const selfTooClose = checkAuditSpacing({
        nowUtc: '2026-11-21T15:20:00Z',
        changedBy: 'Horse SWITCH lane (session B)',
        option: 'holdemPersonaPostflop',
        auditRows: [
          {
            option: 'styleTightPlayerExploit',
            new_state: 'on_shadow',
            changed_by: 'Horse SWITCH lane (session A)',
            changed_at: '2026-11-21T14:45:00Z', // 35 min ago -> >10m cross, <60m self
          },
        ],
      });
      expect(selfTooClose.ok).toBe(false);
      expect(selfTooClose.code).toBe('SELF_LANE_SPACING_VIOLATION');

      const selfRollbackAllowed = checkAuditSpacing({
        nowUtc: '2026-11-21T15:20:00Z',
        changedBy: 'Horse SWITCH lane (session B)',
        option: 'styleTightPlayerExploit',
        isRollback: true,
        auditRows: [
          {
            option: 'styleTightPlayerExploit',
            new_state: 'on_shadow',
            changed_by: 'Horse SWITCH lane (session A)',
            changed_at: '2026-11-21T15:18:00Z', // 2 min ago, same option rollback
          },
        ],
      });
      expect(selfRollbackAllowed.ok).toBe(true);

      const selfAfterHour = checkAuditSpacing({
        nowUtc: '2026-11-21T15:20:00Z',
        changedBy: 'Horse SWITCH lane (session B)',
        option: 'holdemPersonaPostflop',
        auditRows: [
          {
            option: 'styleTightPlayerExploit',
            new_state: 'on',
            changed_by: 'Horse SWITCH lane (session A)',
            changed_at: '2026-11-21T14:15:00Z', // 65 min ago
          },
        ],
      });
      expect(selfAfterHour.ok).toBe(true);
    });
  });

  describe('Live cutover / maintenance hold & fixed freeze_state() parser', () => {
    it('detects DB platform freeze, active break row, owner-maintenance-windows.json, and /health maintenance', () => {
      const dbFrozen = checkMaintenanceAndCutoverHold({
        nowUtc: SAFE_NOW,
        dbMaintenance: { platformFrozen: true, breakRows: [], windowRows: [] },
      });
      expect(dbFrozen.ok).toBe(false);
      expect(dbFrozen.holds[0]).toMatch(/fn_platform_frozen/);

      const breakActive = checkMaintenanceAndCutoverHold({
        nowUtc: SAFE_NOW,
        dbMaintenance: {
          platformFrozen: false,
          breakRows: [{ phase: 'last_hand', enforce_freeze: true }],
          windowRows: [],
        },
      });
      expect(breakActive.ok).toBe(false);

      const ownerWinActive = checkMaintenanceAndCutoverHold({
        nowUtc: '2026-11-17T14:00:00Z',
        ownerWindowsConfig: {
          version: 1,
          windows: [
            {
              id: '2026-11-17-promo-generation-db',
              playerNoticeAt: '2026-11-17T13:55:00Z',
              notBefore: '2026-11-17T14:15:00Z',
              notAfter: '2026-11-17T15:00:00Z',
            },
          ],
        },
      });
      expect(ownerWinActive.ok).toBe(false);
      expect(ownerWinActive.holds[0]).toMatch(/2026-11-17-promo-generation-db/);

      const healthMaint = checkMaintenanceAndCutoverHold({
        nowUtc: SAFE_NOW,
        engineHealth: healthyEngine({
          maintenance: { active: true, phase: 'counting_down' },
        }),
      });
      expect(healthMaint.ok).toBe(false);
      expect(healthMaint.holds[0]).toMatch(/maintenance\.active=true/);

      const healthMismatch = checkMaintenanceAndCutoverHold({
        nowUtc: SAFE_NOW,
        engineHealth: healthyEngine({
          liveHorseDecision: {
            phase: 'ready',
            upgradeManifest: { sourceRevision: 'deadbeef'.repeat(5) },
          },
        }),
      });
      expect(healthMismatch.ok).toBe(false);
      expect(healthMismatch.holds[0]).toMatch(/revision mismatch/);
    });

    it('partitions hardFreezeHolds vs advisoryCutoverHolds so emergency --rollback is never blocked by inbox booking, owner window, or /health blip', () => {
      const activeInbox =
        '## 2026-11-22T14:00:00Z FROM RELEASE-15 TO ALL LANES — SUBJECT: CUTOVER-11 BOOKING (window 16:00Z)';
      const activeOwnerWindows = {
        version: 1,
        windows: [
          {
            id: '2026-11-21-planned-window',
            notBefore: '2026-11-21T15:00:00Z',
            notAfter: '2026-11-21T16:00:00Z',
          },
        ],
      };
      const unreachableHealth = { error: 'fetch failed: ECONNREFUSED' };

      // Non-rollback is strictly blocked by advisory cutover/health holds
      const normalBlocked = checkMaintenanceAndCutoverHold({
        nowUtc: SAFE_NOW,
        dbMaintenance: { platformFrozen: false, breakRows: [], windowRows: [] },
        ownerWindowsConfig: activeOwnerWindows,
        engineHealth: unreachableHealth,
        inboxText: activeInbox,
        requireInbox: true,
        isRollback: false,
      });
      expect(normalBlocked.ok).toBe(false);
      expect(normalBlocked.hardFreezeHolds).toEqual([]);
      expect(normalBlocked.advisoryCutoverHolds).toHaveLength(3);

      // Emergency --rollback with zero hardFreezeHolds returns ok:true with explicit warnings
      const rollbackAllowed = checkMaintenanceAndCutoverHold({
        nowUtc: SAFE_NOW,
        dbMaintenance: { platformFrozen: false, breakRows: [], windowRows: [] },
        ownerWindowsConfig: activeOwnerWindows,
        engineHealth: unreachableHealth,
        inboxText: activeInbox,
        requireInbox: true,
        isRollback: true,
      });
      expect(rollbackAllowed.ok).toBe(true);
      expect(rollbackAllowed.hardFreezeHolds).toEqual([]);
      expect(rollbackAllowed.advisoryCutoverHolds).toHaveLength(3);
      expect(rollbackAllowed.warnings).toHaveLength(3);
      expect(rollbackAllowed.warnings.join(' | ')).toMatch(/CUTOVER-11 booked/);
      expect(rollbackAllowed.warnings.join(' | ')).toMatch(/ECONNREFUSED/);

      // Full evaluatePreflight propagates advisory hold warnings on rollback without failing
      const pfRollback = evaluatePreflight(
        basePreflightInput({
          targetState: 'off',
          isRollback: true,
          authority: '',
          evidenceSha: '',
          ownerWindowsConfig: activeOwnerWindows,
          engineHealth: unreachableHealth,
          inboxText: activeInbox,
          requireInbox: true,
        })
      );
      expect(pfRollback.ok).toBe(true);
      expect(pfRollback.warnings.length).toBeGreaterThanOrEqual(3);

      // Active DB platform freeze or engine_maintenance_break STILL blocks even --rollback
      const rollbackBlockedByDbFreeze = checkMaintenanceAndCutoverHold({
        nowUtc: SAFE_NOW,
        dbMaintenance: { platformFrozen: true, breakRows: [], windowRows: [] },
        inboxText: activeInbox,
        isRollback: true,
      });
      expect(rollbackBlockedByDbFreeze.ok).toBe(false);
      expect(rollbackBlockedByDbFreeze.hardFreezeHolds).toHaveLength(1);
      expect(rollbackBlockedByDbFreeze.reason).toMatch(/fn_platform_frozen/);

      const rollbackBlockedByBreak = checkMaintenanceAndCutoverHold({
        nowUtc: SAFE_NOW,
        dbMaintenance: {
          platformFrozen: false,
          breakRows: [{ phase: 'counting_down', enforce_freeze: false }],
          windowRows: [],
        },
        isRollback: true,
      });
      expect(rollbackBlockedByBreak.ok).toBe(false);
      expect(rollbackBlockedByBreak.hardFreezeHolds).toHaveLength(1);
    });

    it('correctly parses minute-only timestamps, CUTOVER-N BOOKING/SEALED, and NOT_YET clauses (fixing old switch.sh freeze_state)', () => {
      // Unreadable inbox fails closed
      expect(evaluateInboxFreezeState(null).frozen).toBe(true);

      // Minute-only timestamp booking + incidental "AFTER CUTOVER-7 SEALED" stays LOCKED
      const bookedInbox = [
        '## 2026-11-20 19:05Z FROM RELEASE-12 TO ALL LANES — SUBJECT: CUTOVER-7 BOOKING (window 20:00Z)',
        '## 2026-11-20T19:12Z FROM HORSE SWITCH TO ALL LANES — SUBJECT: Plan to run AFTER CUTOVER-7 SEALED',
        '## 2026-11-20T19:15Z FROM RELEASE-12 TO ALL LANES — SUBJECT: Holding UNTIL SEALED',
      ].join('\n');
      const locked = evaluateInboxFreezeState(bookedInbox);
      expect(locked.frozen).toBe(true);
      expect(locked.reason).toMatch(/CUTOVER-7 booked/);

      // Later genuine SEALED unlocks cleanly (even with minute-only timestamp!)
      const sealedInbox = `${bookedInbox}\n## 2026-11-20 20:08Z FROM RELEASE-12 TO ALL LANES — SUBJECT: SEALED 1a0a6047e1ac (CUTOVER-7 complete)\n`;
      const unlocked = evaluateInboxFreezeState(sealedInbox);
      expect(unlocked.frozen).toBe(false);
      expect(unlocked.reason).toMatch(/CUTOVER-7 SEALED/);
    });

    it('clears earlier CUTOVER-10 bookings on newer dated/named SEALED entries and ignores non-booking CUTOVER-10 TIME commentary', () => {
      // Exact live false-positive: non-authority commentary mentioning "CUTOVER-10 BOOKING TIME"
      const commentaryOnly = [
        '## 2026-11-21T08:39:30Z FROM Horse SWITCH lane (Claude session_01Gw7aDsLdud3GnjZyZjuya9) TO PLO-OWNER lead-3, RELEASE-12 — SUBJECT: ACK lead-3 08:25:40Z WRITE PROTOCOL; ONE REQUEST ON THE CUTOVER-10 BOOKING TIME',
      ].join('\n');
      expect(evaluateInboxFreezeState(commentaryOnly).frozen).toBe(false);

      // Even when CUTOVER-10 was authoritatively booked, a newer non-numbered/dated SEALED entry clears it
      const bookedCutover10 =
        '## 2026-11-21T08:39:30Z FROM RELEASE-12 TO ALL LANES — SUBJECT: CUTOVER-10 BOOKING (window 12:25Z)';
      expect(evaluateInboxFreezeState(bookedCutover10).frozen).toBe(true);

      const sealedVariants = [
        '## 2026-11-21T19:54:19Z FROM PLO-OWNER lane RELEASE-14 TO ALL LANES — SUBJECT: 1906z SEALED 1a0a6047e1acb1a037cd43b36d9907a00103c5e4 (receiver 44942263145 success)',
        '## 2026-11-22T13:07:45Z FROM PLO-OWNER lead-4 (release-verify) TO ALL LANES — SUBJECT: SEALED: 7:00 AM CST (13:00Z) ENGINE CUTOVER b31db252025bf65d1b07de7e356d2f56dd2c1daf (run 45022655575) — PICKUP & HEALTH 100% CLEAN',
        '## 2026-11-22T13:07:45Z FROM Dedicated Engine Cutover TO ALL LANES — SUBJECT: 7:00 AM CST (13:00Z) SEALED (b31db252025b)',
        '## 2026-11-22T13:07:45Z FROM RELEASE-14 TO ALL LANES — SUBJECT: Engine Release b31db252025b SEALED',
      ];
      for (const sealLine of sealedVariants) {
        const res = evaluateInboxFreezeState(`${bookedCutover10}\n${sealLine}\n`);
        expect(res.frozen, `expected seal line to clear CUTOVER-10: ${sealLine}`).toBe(false);
        expect(res.reason).toMatch(/not frozen \(last SEALED/);
      }
    });

    it('keeps genuine active unsealed bookings, dispatches, and combined cutover holds strictly frozen fail-closed', () => {
      // Active CUTOVER-11 booked AFTER an earlier SEALED stays frozen, even if a later prospective HOLD mentions a future SEALED target
      const activeBookingWithProspectiveMentions = [
        '## 2026-11-22T13:07:45Z FROM PLO-OWNER lead-4 (release-verify) TO ALL LANES — SUBJECT: SEALED: 7:00 AM CST (13:00Z) ENGINE CUTOVER b31db252025b',
        '## 2026-11-22T14:00:00Z FROM RELEASE-15 TO ALL LANES — SUBJECT: CUTOVER-11 BOOKING (window 16:00Z)',
        '## 2026-11-22T14:03:00Z FROM PLO-OWNER lead-4 TO ALL LANES — SUBJECT: COMBINED HOLD ACTIVE AT 14:15Z (8:15 AM CST) -> 10:00 AM CST (16:00Z) SEALED (~16:10Z)',
        '## 2026-11-22T14:05:00Z FROM Horse SWITCH lane TO ALL LANES — SUBJECT: PR #11699 HELD UNTIL 10:00 AM CST (16:00Z) SEALED',
        '## 2026-11-22T14:06:00Z FROM PLO-OWNER lead-4 TO ALL LANES — SUBJECT: AUDIT CHECK ON SEALED b31db252025b SERVING BUILD',
      ].join('\n');
      const activeBooked = evaluateInboxFreezeState(activeBookingWithProspectiveMentions);
      expect(activeBooked.frozen).toBe(true);
      expect(activeBooked.reason).toMatch(/CUTOVER-11 booked at 2026-11-22T14:00:00Z/);

      // Older numbered seal (CUTOVER-8 SEALED) arriving after newer CUTOVER-9 BOOKING must NOT clear CUTOVER-9
      const overlappingNumbered = [
        '## 2026-11-20T23:33:42Z FROM PLO-OWNER lead-2 / RELEASE-7 TO ALL LANES — SUBJECT: CUTOVER-8 DRIVEN BY RELEASE-7 + CUTOVER-9 BOOKING WRITTEN',
        '## 2026-11-21T00:15:34Z FROM PLO-OWNER lead-2 / RELEASE-7 TO ALL LANES — SUBJECT: CUTOVER-8 SEALED e2140d2d1581daaf84857d98e671f2be832162c6',
      ].join('\n');
      const overlapRes = evaluateInboxFreezeState(overlappingNumbered);
      expect(overlapRes.frozen).toBe(true);
      expect(overlapRes.reason).toMatch(/CUTOVER-9 booked/);

      // Active ENGINE CUTOVER DISPATCHED stays frozen until a later SEALED lands
      const dispatchedInbox = [
        '## 2026-11-22T12:32:45Z FROM PLO-OWNER lead-4 / release-verify TO ALL LANES — SUBJECT: 7:00 AM CST (13:00Z) ENGINE CUTOVER DISPATCHED — Engine Release b31db252025b (run 45022655575)',
      ].join('\n');
      const dispatchedFrozen = evaluateInboxFreezeState(dispatchedInbox);
      expect(dispatchedFrozen.frozen).toBe(true);
      expect(dispatchedFrozen.reason).toMatch(/CUTOVER DISPATCHED at 2026-11-22T12:32:45Z/);

      const dispatchedSealed = `${dispatchedInbox}\n## 2026-11-22T13:07:45Z FROM PLO-OWNER lead-4 (release-verify) TO ALL LANES — SUBJECT: SEALED: 7:00 AM CST (13:00Z) ENGINE CUTOVER b31db252025b (run 45022655575)\n`;
      expect(evaluateInboxFreezeState(dispatchedSealed).frozen).toBe(false);

      // Active COMBINED CUTOVER HOLD stays frozen until a later SEALED or HOLD LIFTED lands
      const combinedCutoverHold = [
        '## 2026-11-22T14:15:00Z FROM PLO-OWNER lead-4 TO ALL LANES — SUBJECT: COMBINED CUTOVER HOLD NOW IN FORCE UNTIL 10:00 AM CST (16:00Z) SEALED (~16:10Z)',
      ].join('\n');
      const holdFrozen = evaluateInboxFreezeState(combinedCutoverHold);
      expect(holdFrozen.frozen).toBe(true);
      expect(holdFrozen.reason).toMatch(/COMBINED CUTOVER HOLD at 2026-11-22T14:15:00Z/);

      const holdCleared = `${combinedCutoverHold}\n## 2026-11-22T16:08:00Z FROM PLO-OWNER lead-4 (release-verify) TO ALL LANES — SUBJECT: SEALED: 10:00 AM CST (16:00Z) ENGINE CUTOVER 3f0a9967d5f4\n`;
      expect(evaluateInboxFreezeState(holdCleared).frozen).toBe(false);
    });
  });

  describe('SQL generation safety, escaping, and zero-secret guarantee', () => {
    it('escapes quotes safely and rejects SQL injection option names and NUL bytes', () => {
      expect(sqlLiteral("O'Connor's note")).toBe("'O''Connor''s note'");
      expect(sqlLiteral("'; DROP TABLE ca_horse_style_switch; --")).toBe(
        "'''; DROP TABLE ca_horse_style_switch; --'"
      );
      expect(() => sqlLiteral('bad\0null')).toThrow(/NUL/);
      expect(() => assertSafeOptionName("v7'; DROP TABLE x;--")).toThrow(/Invalid option name/);
      expect(() => assertSafeOptionName('bad-dash')).toThrow(/Invalid option name/);
      expect(() => assertSafeSha256('A'.repeat(64))).toThrow(/64 lowercase hex/);

      const note = buildSwitchNote({
        option: 'styleTightPlayerExploit',
        targetState: 'on_shadow',
        authority: 'docs/horse-option-authority.d/styleTightPlayerExploit.md',
        evidenceSha: VALID_SHA,
        reason: "owner's step 2 measurement",
      });
      expect(note).toContain(
        `authority: styleTightPlayerExploit docs/horse-option-authority.d/styleTightPlayerExploit.md sha256 ${VALID_SHA}`
      );
      const sql = buildSwitchSetSql({
        option: 'styleTightPlayerExploit',
        targetState: 'on_shadow',
        changedBy: "Horse SWITCH lane (Antigravity's 151f9a34)",
        note,
      });
      expect(sql).toContain('SELECT public.fn_ca_horse_option_switch_set(');
      expect(sql).toContain("'on_shadow'");
      expect(sql).toContain("Antigravity''s 151f9a34");
      expect(buildRegistryRefusalSql('styleTightPlayerExploit', 'on_shadow')).toBe(
        "SELECT public.fn_ca_horse_option_registry_refusal('styleTightPlayerExploit', 'on_shadow') AS refusal;"
      );
      expect(buildPickupTelemetrySql('styleTightPlayerExploit', 'on_shadow')).toContain(
        "'option_switch_styleTightPlayerExploit_on_shadow_seen'"
      );
    });

    it('parses supabase db query JSON output even with CLI upgrade banners', () => {
      const withBanner = `[\n  {"ok": 1}\n]\nA new version of Supabase CLI is available: v3.2.0`;
      expect(parseSupabaseQueryJson(withBanner)).toEqual([{ ok: 1 }]);
      expect(parseSupabaseQueryJson('{"rows":[{"id":5}]}')).toEqual([{ id: 5 }]);
      expect(parseSupabaseQueryJson('')).toEqual([]);
    });

    it('never references .env, service role keys, or access tokens in source files', () => {
      const cliSrc = readFileSync(resolve('scripts/ops/horse-option-switch.mjs'), 'utf8');
      const libSrc = readFileSync(resolve('scripts/ops/horse-option-switch-lib.mjs'), 'utf8');
      const combined = `${cliSrc}\n${libSrc}`;
      expect(combined).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
      expect(combined).not.toMatch(/SUPABASE_ACCESS_TOKEN/);
      expect(combined).not.toMatch(/readFileSync\([^)]*\.env/);
      expect(combined).toContain("'--linked'");
    });
  });

  describe('Pickup verification & SWITCH-CHANGES.log formatting', () => {
    it('passes verify-pickup when >=8 workers reported and 0 config alarms fired', () => {
      const pass = evaluatePickup({
        option: 'styleTightPlayerExploit',
        expectedState: 'on_shadow',
        baseline: 8,
        telemetryRows: [
          {
            feature: 'option_switch_styleTightPlayerExploit_on_shadow_seen',
            fires: 16,
            last_at: '2026-11-21T20:10:05Z',
          },
        ],
      });
      expect(pass.ok).toBe(true);
      expect(pass.delta).toBe(8);
      expect(pass.alarms).toEqual([]);
    });

    it('fails verify-pickup on insufficient worker delta or any option_switch_config_* alarm', () => {
      const lowWorkers = evaluatePickup({
        option: 'styleTightPlayerExploit',
        expectedState: 'on_shadow',
        baseline: 0,
        telemetryRows: [
          { feature: 'option_switch_styleTightPlayerExploit_on_shadow_seen', fires: 7 },
        ],
      });
      expect(lowWorkers.ok).toBe(false);
      expect(lowWorkers.failures[0].code).toBe('PICKUP_INSUFFICIENT_WORKERS');

      const withAlarm = evaluatePickup({
        option: 'styleTightPlayerExploit',
        expectedState: 'on_shadow',
        baseline: 0,
        telemetryRows: [
          { feature: 'option_switch_styleTightPlayerExploit_on_shadow_seen', fires: 9 },
          { feature: 'option_switch_config_invalid_seen', fires: 1 },
        ],
      });
      expect(withAlarm.ok).toBe(false);
      expect(withAlarm.failures[0].code).toBe('PICKUP_CONFIG_ALARM');
    });

    it('formats exact pipe-delimited SWITCH-CHANGES.log audit lines safely', () => {
      const line = formatSwitchChangeLogLine({
        timestampUtc: '2026-11-21T20:08:58Z',
        option: 'styleTightPlayerExploit',
        fromState: 'on',
        toState: 'on_shadow',
        changedBy: 'Horse SWITCH lane (Antigravity 151f9a34)',
        reason: 'step 2 | pipe sanitized',
        verified: 'yes (audit#172)',
      });
      expect(line).toBe(
        '2026-11-21T20:08:58Z | 2026-11-21 14:08:58 CST | styleTightPlayerExploit | on -> on_shadow | Horse SWITCH lane (Antigravity 151f9a34) | step 2 / pipe sanitized | verified: yes (audit#172)'
      );
    });
  });

  describe('End-to-end CLI subcommands (mocked DB, zero prod I/O)', () => {
    function createMockDeps(
      overrides: {
        currentRows?: Array<Record<string, unknown>>;
        auditRows?: Array<Record<string, unknown>>;
        refusal?: string | null;
        telemetryRows?: Array<Record<string, unknown>>;
      } = {}
    ) {
      const executedSql: string[] = [];
      const loggedLines: Array<{ file: string; line: string }> = [];
      const stateWrites: Array<{ file: string; text: string }> = [];
      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];

      let currentRows = overrides.currentRows ?? [
        { option: 'styleTightPlayerExploit', state: 'on', updated_at: '2026-11-21T10:00:00Z' },
      ];
      const auditRows = overrides.auditRows ?? [
        {
          id: 171,
          option: 'omahaStreetPlan',
          old_state: 'on',
          new_state: 'off',
          changed_by: 'PLO-OWNER lead-2',
          changed_at: '2026-11-21T14:50:00Z',
        },
      ];
      let latestNote = '';

      const queryDb = vi.fn((sql: string) => {
        executedSql.push(sql);
        if (sql.includes('FROM public.ca_horse_style_switch ORDER BY')) return currentRows;
        if (sql.includes('FROM public.ca_horse_style_switch_audit ORDER BY')) return auditRows;
        if (sql.includes('FROM public.ca_horse_option_registry_serving')) {
          return baseServingRegistry();
        }
        if (sql.includes('fn_ca_horse_option_registry_refusal')) {
          return [{ refusal: overrides.refusal ?? null }];
        }
        if (sql.includes('fn_ca_horse_option_switch_states')) {
          return [{ states: overrides.whitelistStates ?? '{off,shadow,on_shadow,on}' }];
        }
        if (sql.includes('fn_platform_frozen()')) {
          return [{ platform_frozen: false, has_break_table: true, has_windows_table: false }];
        }
        if (sql.includes('FROM public.engine_maintenance_break')) return [];
        if (sql.includes('FROM public.ca_horse_option_switch_evidence')) {
          return [{ id: 42, option: 'styleTightPlayerExploit', evidence_sha256: VALID_SHA }];
        }
        if (sql.includes('fn_ca_horse_option_switch_set')) {
          const m = sql.match(
            /fn_ca_horse_option_switch_set\('[^']+',\s*'([^']+)',\s*'[^']+',\s*'((?:[^']|'')*)'\)/
          );
          const nextState = m?.[1] ?? 'on_shadow';
          latestNote = (m?.[2] ?? '').replace(/''/g, "'");
          currentRows = [
            {
              option: 'styleTightPlayerExploit',
              state: nextState,
              updated_at: '2026-11-21T15:20:01Z',
              note: latestNote,
            },
          ];
          return [{ result: { option: 'styleTightPlayerExploit', state: nextState } }];
        }
        if (sql.includes('latest_audit_id')) {
          return [
            {
              option: 'styleTightPlayerExploit',
              state: currentRows[0].state,
              updated_at: '2026-11-21T15:20:01Z',
              note: latestNote,
              latest_audit_id: 175,
            },
          ];
        }
        if (sql.includes('FROM public.horse_brain_telemetry')) {
          return (
            overrides.telemetryRows ?? [
              {
                feature: 'option_switch_styleTightPlayerExploit_on_shadow_seen',
                fires: 8,
                last_at: '2026-11-21T15:21:00Z',
              },
            ]
          );
        }
        return [];
      });

      return {
        deps: {
          queryDb,
          fetchHealth: vi.fn(async () => healthyEngine()),
          readFile: vi.fn(() => JSON.stringify({ version: 1, windows: [] })),
          readFileBuffer: vi.fn(() => Buffer.from(METAUTHORITY_DOC)),
          appendLogLine: vi.fn((file: string, line: string) => loggedLines.push({ file, line })),
          writeStateFile: vi.fn((file: string, text: string) => stateWrites.push({ file, text })),
          now: () => SAFE_NOW,
          stdout: (s: string) => stdoutLines.push(s),
          stderr: (s: string) => stderrLines.push(s),
        },
        executedSql,
        loggedLines,
        stateWrites,
        stdoutLines,
        stderrLines,
      };
    }

    it('runs status, preflight, set (--dry-run and live write + log append), and verify-pickup', async () => {
      const m1 = createMockDeps();
      const statusRes = await runCli(['status', '--json'], m1.deps);
      expect(statusRes.exitCode).toBe(0);
      expect(statusRes.data.switchRowCount).toBe(1);
      expect(statusRes.data.maintenanceHold.held).toBe(false);

      const m2 = createMockDeps();
      const dryRes = await runCli(
        [
          'set',
          'styleTightPlayerExploit',
          'on_shadow',
          '--reason',
          'SHADOW-PLAN-1 step 2',
          '--authority',
          'docs/horse-option-authority.d/styleTightPlayerExploit.md',
          '--evidence-sha',
          VALID_SHA,
          '--changed-by',
          'Horse SWITCH lane (Antigravity 151f9a34)',
          '--dry-run',
        ],
        m2.deps
      );
      expect(dryRes.exitCode).toBe(0);
      expect(m2.executedSql.some((s) => s.includes('fn_ca_horse_option_switch_set'))).toBe(false);

      const m3 = createMockDeps({
        telemetryRows: [
          { feature: 'option_switch_styleTightPlayerExploit_on_shadow_seen', fires: 4 },
        ],
      });
      const setRes = await runCli(
        [
          'set',
          'styleTightPlayerExploit',
          'on_shadow',
          '--reason',
          'SHADOW-PLAN-1 step 2',
          '--authority',
          'docs/horse-option-authority.d/styleTightPlayerExploit.md',
          '--evidence-sha',
          VALID_SHA,
          '--changed-by',
          'Horse SWITCH lane (Antigravity 151f9a34)',
          '--log-file',
          '/Volumes/SmarterArchives/SWITCH-CHANGES.log',
        ],
        m3.deps
      );
      expect(setRes.exitCode).toBe(0);
      expect(setRes.data.executed).toBe(true);
      expect(setRes.data.auditId).toBe(175);
      expect(setRes.data.prePickupBaseline).toBe(4);
      expect(m3.loggedLines).toHaveLength(1);
      expect(m3.loggedLines[0].line).toContain('styleTightPlayerExploit | on -> on_shadow');
      // The verified write is recorded in the committed live-state snapshot (authority-doc drift guard).
      expect(m3.stateWrites).toHaveLength(1);
      expect(m3.stateWrites[0].file).toBe('docs/horse-option-switch-state.json');
      expect(JSON.parse(m3.stateWrites[0].text).rows.styleTightPlayerExploit).toEqual({
        state: 'on_shadow',
        auditId: 175,
        changedAt: '2026-11-21T15:20:01.000Z',
      });
      expect(setRes.data.stateFile).toBe('docs/horse-option-switch-state.json');
      // A dry run writes nothing.
      expect(m2.stateWrites).toHaveLength(0);

      const m4 = createMockDeps({
        telemetryRows: [
          { feature: 'option_switch_styleTightPlayerExploit_on_shadow_seen', fires: 12 },
        ],
      });
      const pickupRes = await runCli(
        ['verify-pickup', 'styleTightPlayerExploit', 'on_shadow', '--baseline', '4'],
        m4.deps
      );
      expect(pickupRes.exitCode).toBe(0);
      expect(pickupRes.data.delta).toBe(8);
    });

    it('parseCliArgs handles --workdir and rejects unknown flags and invalid integer flags', () => {
      const parsed = parseCliArgs([
        'status',
        '--workdir',
        '/Volumes/SmarterWork/example',
        '--json',
      ]);
      expect(parsed.flags.workdir).toBe('/Volumes/SmarterWork/example');
      expect(parsed.flags.json).toBe(true);
      expect(() => parseCliArgs(['status', '--unknown-flag'])).toThrow(/Unknown flag/);
      expect(() => parseCliArgs(['verify-pickup', 'v7', 'on', '--baseline', '-1'])).toThrow(
        /non-negative integer/
      );

      // --alarm-baseline JSON parsing and strict validation
      const withAlarmBase = parseCliArgs([
        'verify-pickup',
        'styleTightPlayerExploit',
        'on_shadow',
        '--baseline',
        '4',
        '--alarm-baseline',
        '{"option_switch_config_stale_seen":2}',
      ]);
      expect(withAlarmBase.flags.alarmBaseline).toEqual({
        option_switch_config_stale_seen: 2,
      });
      expect(() =>
        parseCliArgs(['verify-pickup', 'v7', 'on', '--alarm-baseline', 'not-json'])
      ).toThrow(/Invalid --alarm-baseline JSON/);
      expect(() =>
        parseCliArgs(['verify-pickup', 'v7', 'on', '--alarm-baseline', '{"bad_key":1}'])
      ).toThrow(/must match option_switch_config_/);
      expect(() =>
        parseCliArgs([
          'verify-pickup',
          'v7',
          'on',
          '--alarm-baseline',
          '{"option_switch_config_stale_seen":-1}',
        ])
      ).toThrow(/non-negative integer/);
    });

    it('captures preAlarmBaseline in set and honors --alarm-baseline in verify-pickup so historical alarms do not permanently block pickup', async () => {
      const mSet = createMockDeps({
        telemetryRows: [
          { feature: 'option_switch_styleTightPlayerExploit_on_shadow_seen', fires: 4 },
          { feature: 'option_switch_config_stale_seen', fires: 2 },
        ],
      });
      const setRes = await runCli(
        [
          'set',
          'styleTightPlayerExploit',
          'on_shadow',
          '--reason',
          'SHADOW-PLAN-1 step 2',
          '--authority',
          'docs/horse-option-authority.d/styleTightPlayerExploit.md',
          '--evidence-sha',
          VALID_SHA,
          '--changed-by',
          'Horse SWITCH lane (Antigravity 151f9a34)',
        ],
        mSet.deps
      );
      expect(setRes.exitCode).toBe(0);
      expect(setRes.data.preAlarmBaseline).toEqual({ option_switch_config_stale_seen: 2 });
      expect(mSet.stdoutLines.join('\n')).toContain(
        `--alarm-baseline '{"option_switch_config_stale_seen":2}'`
      );
      expect(
        extractAlarmBaseline([
          { feature: 'option_switch_config_stale_seen', fires: 2 },
          { feature: 'option_switch_styleTightPlayerExploit_on_shadow_seen', fires: 4 },
        ])
      ).toEqual({ option_switch_config_stale_seen: 2 });
      expect(parseAlarmBaselineJson('{"option_switch_config_invalid_seen":0}')).toEqual({
        option_switch_config_invalid_seen: 0,
      });

      // Historical alarm count unchanged (2 -> 2): verify-pickup PASSES with --alarm-baseline
      const mPickupPass = createMockDeps({
        telemetryRows: [
          { feature: 'option_switch_styleTightPlayerExploit_on_shadow_seen', fires: 12 },
          { feature: 'option_switch_config_stale_seen', fires: 2 },
        ],
      });
      const passRes = await runCli(
        [
          'verify-pickup',
          'styleTightPlayerExploit',
          'on_shadow',
          '--baseline',
          '4',
          '--alarm-baseline',
          '{"option_switch_config_stale_seen":2}',
        ],
        mPickupPass.deps
      );
      expect(passRes.exitCode).toBe(0);
      expect(passRes.data.ok).toBe(true);
      expect(passRes.data.alarms).toEqual([]);

      // New alarm fires (2 -> 3): verify-pickup FAILS with +1 delta
      const mPickupFail = createMockDeps({
        telemetryRows: [
          { feature: 'option_switch_styleTightPlayerExploit_on_shadow_seen', fires: 12 },
          { feature: 'option_switch_config_stale_seen', fires: 3 },
        ],
      });
      const failRes = await runCli(
        [
          'verify-pickup',
          'styleTightPlayerExploit',
          'on_shadow',
          '--baseline',
          '4',
          '--alarm-baseline',
          '{"option_switch_config_stale_seen":2}',
        ],
        mPickupFail.deps
      );
      expect(failRes.exitCode).toBe(2);
      expect(failRes.data.ok).toBe(false);
      expect(failRes.data.alarms).toHaveLength(1);
      expect(failRes.data.alarms[0].delta).toBe(1);
    });

    it('resolves releaseDefaultOn from HorseOptionSwitch.ts in preflight so shadow on an explicit-on release-default-ON option passes (and removes dead ternary)', async () => {
      const switchTsSource = readFileSync(
        resolve('server/src/engine/HorseOptionSwitch.ts'),
        'utf8'
      );
      const defaultOnSet = parseReleaseDefaultOnOptions(switchTsSource);
      expect(defaultOnSet.has('v80TopPairStrongKicker')).toBe(true);
      expect(defaultOnSet.has('styleTightPlayerExploit')).toBe(false);

      // Verify dead ternary is removed from CLI source
      const cliSource = readFileSync(resolve('scripts/ops/horse-option-switch.mjs'), 'utf8');
      expect(cliSource).not.toContain('requireInbox ? null : null');

      // Explicit-on release-default-ON option entering plain `shadow` passes preflight
      const mDefaultOn = createMockDeps({
        currentRows: [{ option: 'v80TopPairStrongKicker', state: 'on' }],
      });
      mDefaultOn.deps.queryDb = vi.fn((sql: string) => {
        if (sql.includes('FROM public.ca_horse_style_switch ORDER BY')) {
          return [{ option: 'v80TopPairStrongKicker', state: 'on' }];
        }
        if (sql.includes('FROM public.ca_horse_style_switch_audit ORDER BY')) return [];
        if (sql.includes('FROM public.ca_horse_option_registry_serving')) {
          return baseServingRegistry({
            v80TopPairStrongKicker: ['off', 'shadow', 'on_shadow', 'on'],
            styleTightPlayerExploit: ['off', 'shadow', 'on_shadow', 'on'],
          });
        }
        if (sql.includes('fn_ca_horse_option_registry_refusal')) return [{ refusal: null }];
        if (sql.includes('fn_platform_frozen()')) {
          return [{ platform_frozen: false, has_break_table: false, has_windows_table: false }];
        }
        return [];
      });
      mDefaultOn.deps.readFile = vi.fn((filePath: string) => {
        if (filePath.includes('HorseOptionSwitch.ts')) return switchTsSource;
        return JSON.stringify({ version: 1, windows: [] });
      });

      const allowed = await runCli(
        ['preflight', 'v80TopPairStrongKicker', 'shadow', '--json'],
        mDefaultOn.deps
      );
      expect(allowed.exitCode).toBe(0);
      expect(allowed.data.ok).toBe(true);

      // Non-default-ON option currently `on` entering plain `shadow` is STILL refused
      mDefaultOn.deps.queryDb = vi.fn((sql: string) => {
        if (sql.includes('FROM public.ca_horse_style_switch ORDER BY')) {
          return [{ option: 'styleTightPlayerExploit', state: 'on' }];
        }
        if (sql.includes('FROM public.ca_horse_style_switch_audit ORDER BY')) return [];
        if (sql.includes('FROM public.ca_horse_option_registry_serving')) {
          return baseServingRegistry({
            styleTightPlayerExploit: ['off', 'shadow', 'on_shadow', 'on'],
          });
        }
        if (sql.includes('fn_ca_horse_option_registry_refusal')) return [{ refusal: null }];
        if (sql.includes('fn_platform_frozen()')) {
          return [{ platform_frozen: false, has_break_table: false, has_windows_table: false }];
        }
        return [];
      });

      const refused = await runCli(
        ['preflight', 'styleTightPlayerExploit', 'shadow', '--json'],
        mDefaultOn.deps
      );
      expect(refused.exitCode).toBe(2);
      expect(refused.data.failures.map((f: { code: string }) => f.code)).toContain(
        'SHADOW_WOULD_DISABLE_LIVE_ON_ROW'
      );
    });
  });
});
