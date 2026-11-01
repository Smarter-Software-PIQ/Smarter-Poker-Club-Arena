import { restartCloneStartMs } from './ScheduledTournamentService.js';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TournamentRecurringService,
  mttIsFreeEntry,
  mttHorsePrestartWindowMs,
} from './TournamentRecurringService.js';
import { supabase } from './supabase.js';

vi.mock('../maintenance/freezeState.js', () => ({ isMaintenanceFrozen: () => false }));
vi.mock('./errorReporter.js', () => ({ reportError: vi.fn() }));
const NOW = Date.parse('2026-10-28T20:00:00Z');
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function harness(over: Record<string, unknown> = {}) {
  const event = {
    format_contract: 'mtt-v2',
    variant: 'freezeout',
    max_players: null,
    status: 'REGISTERING',
    start_time: new Date(NOW + 60 * 60_000 + 1).toISOString(),
    current_players: 0,
    guaranteed_prize: 5000,
    prize_pool: 0,
    buy_in_amount: 36,
    buy_in_fee: 0,
    free_buy: false,
    ...over,
  };
  const svc = new TournamentRecurringService() as unknown as {
    registerHorses(id: string, count: number): Promise<number>;
    horseLoadMap(): Promise<Map<string, number> | null>;
  };
  const load = vi.spyOn(svc, 'horseLoadMap').mockResolvedValue(null);
  vi.spyOn(supabase, 'from').mockImplementation(() => {
    const builder: Record<string, unknown> = {};
    for (const key of ['select', 'eq']) builder[key] = () => builder;
    builder.maybeSingle = async () => ({ data: event, error: null });
    return builder as never;
  });
  const rpc = vi.spyOn(supabase, 'rpc');
  return { event, svc, load, rpc };
}

describe('free entry classification reads the initial charge, not the prize share', () => {
  it.each([
    [{ buy_in_amount: 0, buy_in_fee: 0 }, true, 6],
    [{ buy_in_amount: 0, buy_in_fee: null }, true, 6],
    [{ buy_in_amount: 0, buy_in_fee: 5 }, false, 1],
    [{ buy_in_amount: 5, buy_in_fee: 0, bounty_amount: 5 }, false, 1],
    [{ free_buy: true, buy_in_amount: 36, buy_in_fee: 0 }, true, 6],
    [{ buy_in_fee: 0 }, false, 1],
  ] as const)('classifies %j as free=%s with a %sh window', (row, free, hours) => {
    expect(mttIsFreeEntry(row)).toBe(free);
    expect(mttHorsePrestartWindowMs(row)).toBe(hours * 60 * 60_000);
  });
});

describe('automated MTT callers share the paid-hour and free-hours entry policy', () => {
  it.each(['REGISTERING', 'ANNOUNCED'])(
    'rejects a paid %s event one millisecond before the one-hour window',
    async (status) => {
      const h = harness({ status });
      expect(await h.svc.registerHorses('event', 139)).toBe(0);
      expect(h.load).not.toHaveBeenCalled();
      expect(h.rpc).not.toHaveBeenCalled();
    }
  );
  it.each(['mtt-v1', 'mtt-v2'])(
    'admits a handful at T-60 and later trickles for %s',
    async (format_contract) => {
      const h = harness({ format_contract, start_time: new Date(NOW + 60 * 60_000).toISOString() });
      await h.svc.registerHorses('event', 139);
      expect(h.load).toHaveBeenCalledOnce();
      vi.setSystemTime(NOW + 30 * 60_000);
      await h.svc.registerHorses('event', 139);
      expect(h.load).toHaveBeenCalledTimes(2);
    }
  );
  it.each([6, 4])('admits zero-cost initial entry %sh ahead', async (hours) => {
    const h = harness({
      buy_in_amount: 0,
      start_time: new Date(NOW + hours * 60 * 60_000).toISOString(),
    });
    await h.svc.registerHorses('event', 139);
    expect(h.load).toHaveBeenCalledOnce();
  });
  it('does not admit a charged entry hours early just because its prize share is zero', async () => {
    const h = harness({
      buy_in_amount: 0,
      buy_in_fee: 5,
      start_time: new Date(NOW + 4 * 60 * 60_000).toISOString(),
    });
    await h.svc.registerHorses('event', 139);
    expect(h.load).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('honors an explicit Free Buy initial-entry contract hours ahead', async () => {
    const h = harness({
      free_buy: true,
      start_time: new Date(NOW + 4 * 60 * 60_000).toISOString(),
    });
    await h.svc.registerHorses('event', 139);
    expect(h.load).toHaveBeenCalledOnce();
  });
  it('keeps the free window finite', async () => {
    const h = harness({
      buy_in_amount: 0,
      start_time: new Date(NOW + 6 * 60 * 60_000 + 1).toISOString(),
    });
    await h.svc.registerHorses('event', 139);
    expect(h.load).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('fails closed on an unreadable scheduled clock', async () => {
    const h = harness({ start_time: null });
    await h.svc.registerHorses('event', 139);
    expect(h.load).not.toHaveBeenCalled();
  });
  it('does not top up an already ahead-of-curve field', async () => {
    const h = harness({ start_time: new Date(NOW + 300000).toISOString(), current_players: 139 });
    await h.svc.registerHorses('event', 40);
    expect(h.load).not.toHaveBeenCalled();
  });
  it('leaves running late registration on its existing admission path', async () => {
    const h = harness({ status: 'RUNNING', start_time: new Date(NOW - 600000).toISOString() });
    await h.svc.registerHorses('event', 4);
    expect(h.load).toHaveBeenCalledOnce();
  });
  it('leaves bought-seat games on their existing admission path', async () => {
    const h = harness({ format_contract: 'sng-v1', max_players: 6 });
    await h.svc.registerHorses('event', 4);
    expect(h.load).toHaveBeenCalledOnce();
  });
});

describe('scheduled horse timing stays in required native accounting', () => {
  const source = (path: string) =>
    readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
  it('keeps Accounting4 → daily counts → purchase budget → timing checked and bounded', () => {
    expect(source('.github/workflows/ci.yml')).toMatch(
      /- name: Horse daily counts share the original accepted-hand receipt\s+if: matrix\.shard == 4\s+env:\s+PG_BIN: \/usr\/lib\/postgresql\/17\/bin\s+run: python3 scripts\/ci\/test-horse-daily-counts\.py/
    );
    expect(source('scripts/ci/test-horse-daily-counts.py')).toContain(
      "subprocess.run([sys.executable, '-B', str(ROOT/'scripts/ci/test-horse-future-purchase-budget.py')], cwd=ROOT, env={**ENV, 'PG_BIN':str(PG), 'TMPDIR':str(BASE)}, check=True, timeout=120)"
    );
    const budget = source('scripts/ci/test-horse-future-purchase-budget.py');
    const invocation = `subprocess.run([
        sys.executable, '-B', str(ROOT/'scripts/ci/test-horse-registration-timing.py'),
    ], cwd=ROOT, env={**ENV, 'PG_BIN':str(PG), 'TMPDIR':str(BASE)}, check=True, timeout=120)`;
    expect(budget).toContain(invocation);
    expect(budget.indexOf(invocation)).toBeGreaterThan(
      budget.indexOf("finally: command([PG/'pg_ctl'")
    );
    expect(budget.indexOf(invocation)).toBeLessThan(
      budget.indexOf("if __name__=='__main__':main()")
    );
  });
});

describe('restarted MTTs exist for their signup window', () => {
  it.each([
    { entry: { buy_in_amount: 10, buy_in_fee: 1 }, minutes: 60 },
    { entry: { buy_in_amount: 0, buy_in_fee: 0 }, minutes: 360 },
  ])('retains the entry window without a guarantee: $minutes minutes', ({ entry, minutes }) => {
    const now = Date.parse('2026-11-01T06:00:00Z');
    expect(
      restartCloneStartMs({
        restartMinutes: 5,
        endedAtMs: now,
        startTimeMs: null,
        nowMs: now,
        guaranteedPrize: 0,
        prestartLeadMs: mttHorsePrestartWindowMs(entry),
      })
    ).toBe(now + minutes * 60_000);
  });
});
