/**
 * A HORSE TURN THE CLOCK RESOLVES LEAVES A RECEIPT (2026-11-05).
 *
 * Dan's order: every horse has an active decision process on every hand and
 * every street. When the engine acts for a horse seat instead of the brain
 * (its clock or bank ran out, the watchdog forced it, a recovered clock
 * expired) the hand record says origin 'forced', the same word a blind post
 * carries. On 2026-11-05 two such turns (hands 039c0140 and 8d98aeb8) were
 * found only by reading the engine log for "resolving anyway".
 *
 * THE LAW
 *   1. Every forced resolution of a seat names its reason.
 *   2. A forced check or fold at a horse seat fires
 *      horse_turn_resolved_without_decision, the reason variant, and whether
 *      a brain decision was still in flight; a human seat fires nothing.
 *   3. The receipt is declared in HorseDataLedger and read by activation.sql,
 *      so a release day with one forced horse turn is visible.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../services/supabase/client.js', () => ({ supabase: {}, maintenanceSupabase: {} }));
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ServerTableEngine } from './ServerTableEngine.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const turns = readFileSync(here('./ServerTableEngineTurns.ts'), 'utf8');
const TABLE = 'cccccccc-1105-4000-8000-0000000c10c6';

/** Every `this.forceResolveSeat(` call in the engine sources, with its argument text. */
function forceResolveSeatCalls(): Array<{ file: string; args: string }> {
  const dir = here('./');
  const out: Array<{ file: string; args: string }> = [];
  for (const file of readdirSync(dir)) {
    if (!file.startsWith('ServerTableEngine') || !file.endsWith('.ts') || file.includes('.test.'))
      continue;
    const src = readFileSync(here('./' + file), 'utf8');
    const marker = 'this.forceResolveSeat(';
    let at = src.indexOf(marker);
    while (at !== -1) {
      let depth = 1;
      let i = at + marker.length;
      while (i < src.length && depth > 0) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') depth--;
        i++;
      }
      out.push({ file, args: src.slice(at + marker.length, i - 1) });
      at = src.indexOf(marker, i);
    }
  }
  return out;
}

afterEach(() => {
  drainFires();
  vi.restoreAllMocks();
});

describe('a horse turn the clock resolves leaves a receipt', () => {
  it('every forced resolution of a seat names its reason', () => {
    const calls = forceResolveSeatCalls();
    expect(calls.length).toBeGreaterThanOrEqual(7);
    for (const call of calls) {
      expect(call.args, `${call.file}: forceResolveSeat(${call.args}) names no reason`).toMatch(
        /'(timer_expired|timebank_expired|manual_timebank_expired|published_timebank_expired|recovered_timebank_expired|reconnect_protection_expired|watchdog_forced|disconnect_auto_action)'/
      );
    }
    // The watchdog forces its action without forceResolveSeat and reports it by name.
    expect(turns).toMatch(/noteHorseTurnResolvedWithoutDecision\([\s\S]{0,80}'watchdog_forced'/);
  });

  it('forceResolveSeat reports a horse seat it resolved, and only after the action landed', () => {
    const body = turns.slice(
      turns.indexOf('protected forceResolveSeat('),
      turns.indexOf('protected noteHorseTurnResolvedWithoutDecision(')
    );
    expect(body).toMatch(
      /performAction\(seat, a as any, undefined, 'forced'\)\) \{\s*this\.noteHorseTurnResolvedWithoutDecision\(seat, a, reason, brainDecisionPending\);\s*return true;/
    );
    expect(body).toMatch(
      /const brainDecisionPending = this\.horseDecisionAbortController !== null;/
    );
  });

  it('a forced check at a horse seat fires the receipt; the same at a human seat fires nothing', () => {
    enableBrainTelemetry();
    drainFires();
    for (const isHorse of [true, false]) {
      const engine = new ServerTableEngine(TABLE) as any;
      engine.lifecycleCanMutate = () => true;
      engine.handController = { performAction: vi.fn(() => true) };
      engine.seatedPlayers = [{ user_id: 'seat-4', seat_number: 4, is_horse: isHorse }];
      engine.horseDecisionAbortController = new AbortController();
      const recovery = vi.spyOn(engine, 'recordRecoveryEvent');
      expect(engine.forceResolveSeat(4, true, 'timer_expired')).toBe(true);
      const fires = new Map(drainFires().map((r) => [r.feature, r.fires]));
      if (isHorse) {
        expect(fires.get('horse_turn_resolved_without_decision')).toBe(1);
        expect(fires.get('horse_turn_resolved_without_decision_timer_expired')).toBe(1);
        expect(fires.get('horse_turn_resolved_without_decision_brain_pending')).toBe(1);
        expect(recovery).toHaveBeenCalledWith(
          'horse_turn_resolved_without_decision',
          expect.stringContaining('seat 4 horse seat-4 forced check reason timer_expired')
        );
      } else {
        expect([...fires.keys()].filter((k) => k.startsWith('horse_turn_resolved'))).toEqual([]);
        expect(recovery).not.toHaveBeenCalled();
      }
      engine.preciseTimer.dispose();
      engine.timeBankEngine.dispose(TABLE);
    }
  });

  it('the receipt is declared in the ledger and read by activation.sql', () => {
    const keys = HORSE_DATA_LEDGER.filter((e) => e.kind === 'receipt').map((e) => e.key);
    expect(keys).toContain('horse_turn_resolved_without_decision');
    expect(keys).toContain('horse_turn_resolved_without_decision_*');
    expect(keys).toContain('stale_turn_clock_expiry_ignored');
    expect(keys).toContain('time_bank_activation_retired_turn_ended');
    const sql = readFileSync(here('../../../scripts/horse-measure/sql/activation.sql'), 'utf8');
    expect(sql).toContain("('horse_turn_resolved_without_decision',");
    expect(sql).toContain("('horse_turn_resolved_without_decision_brain_pending',");
  });
});
