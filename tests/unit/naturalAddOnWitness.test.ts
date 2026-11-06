import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Locator, Page } from '@playwright/test';
import {
  admitNaturalAddOn,
  completeAddOnRoster,
  synchronizeAddOnObservers,
  addOnWindow,
  countdownSeconds,
  readAddOnCountdown,
  readAddOnCard,
  hasNaturalAddOnIncrement,
  forbiddenAddOnParticipation,
  suppressedObserverReward,
} from '../e2e/support/naturalAddOnWitness';
const id = '11111111-1111-4111-8111-111111111111';
const row = { id, tournament_id: id, status: 'active' };
describe('natural add-on observation admission', () => {
  it('requires exact identities and rejects mixed modes', () => {
    expect(admitNaturalAddOn({ natural_addon_tournament_id: id, engine_sha: 'a'.repeat(40) })).toBe(
      id
    );
    for (const payload of [
      { natural_addon_tournament_id: id },
      { natural_addon_tournament_id: id, engine_sha: 'a'.repeat(40), horse_social: false },
    ])
      expect(() => admitNaturalAddOn(payload)).toThrow();
  });
  it('never treats a capped, missing, duplicate or foreign roster as complete', () => {
    expect(completeAddOnRoster([row], 1, id)).toEqual([row]);
    for (const [rows, count] of [
      [[], 0],
      [[row], 2],
      [[row], 9],
      [[row, row], 2],
      [[{ ...row, tournament_id: 'other' }], 1],
      [null, null],
    ] as const)
      expect(() => completeAddOnRoster(rows as any, count, id)).toThrow();
  });
  it('keeps complete historical evidence but opens only live tables', () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      ...row,
      id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      status: index < 6 ? 'closed' : 'running',
    }));
    expect(completeAddOnRoster(rows, 12, id)).toEqual(rows.slice(6));
    expect(() => completeAddOnRoster(rows.slice(1), 12, id)).toThrow();
    expect(() =>
      completeAddOnRoster(
        rows.map((r) => ({ ...r, status: 'running' })),
        12,
        id
      )
    ).toThrow();
    expect(() =>
      completeAddOnRoster(
        rows.map((r) => ({ ...r, status: 'closed' })),
        12,
        id
      )
    ).toThrow();
    expect(() =>
      completeAddOnRoster([{ ...rows[0], tournament_id: 'other' }, ...rows.slice(1)], 12, id)
    ).toThrow();
  });
  it('requires a full sixty-second durable window after late entry', () => {
    const state = {
      addon_period_triggered: true,
      addon_period_started_at: '2026-11-01T04:00:00Z',
      addon_period_ends_at: '2026-11-01T04:01:00Z',
      addon_cost: 15,
      addon_chips: 20000,
      current_level: 8,
      late_reg_levels: 8,
    };
    expect(addOnWindow(state)?.chips).toBe(20000);
    expect(() => addOnWindow({ ...state, current_level: 7 })).toThrow();
    expect(() => addOnWindow({ ...state, addon_period_ends_at: '2026-11-01T04:00:59Z' })).toThrow();
    expect(() => addOnWindow({ ...state, addon_cost: -1 })).toThrow();
    expect(addOnWindow({})).toBeNull();
  });
  it('reads real countdowns and refuses placeholders', () => {
    expect(countdownSeconds('0:59')).toBe(59);
    for (const text of ['--', '0:60', 'NaN', '']) expect(() => countdownSeconds(text)).toThrow();
  });
  it('allows observed context reads and only the reserved identity housekeeping', () => {
    const rpc = (name: string) => new URL('https://db.example/rest/v1/rpc/' + name);
    for (const name of [
      'fn_player_spendable_balance',
      'fn_platform_capabilities',
      'fn_rg_require_not_excluded',
      'fn_batch_club_member_counts',
      'fn_table_chat_is_silenced',
      'fn_time_bank_allowance_v2',
      'fn_bbj_mini_for_club',
      'fn_bbj_pool_for_club',
    ])
      expect(forbiddenAddOnParticipation('POST', rpc(name))).toBe(false);
    for (const name of [
      'ca_claim_active_login',
      'ca_record_device_sighting',
      'fn_report_client_errors',
    ]) {
      expect(forbiddenAddOnParticipation('POST', rpc(name), id)).toBe(false);
      expect(forbiddenAddOnParticipation('POST', rpc(name))).toBe(true);
    }
    expect(
      forbiddenAddOnParticipation('POST', rpc('fn_update_presence'), id, { p_user_id: id })
    ).toBe(false);
    for (const body of [undefined, {}, { p_user_id: 'another-player' }])
      expect(forbiddenAddOnParticipation('POST', rpc('fn_update_presence'), id, body)).toBe(true);
    expect(suppressedObserverReward('POST', rpc('fn_achievement_record_login'))).toBe(true);
    expect(forbiddenAddOnParticipation('POST', rpc('fn_achievement_record_login'), id)).toBe(true);
    for (const name of [
      'process_tournament_rebuy',
      'fn_register_for_tournament',
      'fn_unknown',
      'fn_achievement_unlock_server',
    ]) {
      expect(forbiddenAddOnParticipation('POST', rpc(name), id)).toBe(true);
      expect(suppressedObserverReward('POST', rpc(name))).toBe(false);
    }
  });
  it('allows only engine heartbeat and in-memory connection diagnostics', () => {
    for (const path of ['/heartbeat', '/client-event']) {
      const url = new URL('https://engine.smarter.poker' + path);
      expect(forbiddenAddOnParticipation('POST', url)).toBe(false);
      expect(forbiddenAddOnParticipation('DELETE', url)).toBe(true);
    }
    for (const path of ['/action', '/addchips', '/leave', '/unknown', '/admin/heartbeat'])
      expect(
        forbiddenAddOnParticipation('POST', new URL('https://engine.smarter.poker' + path))
      ).toBe(true);
  });
  it('blocks purchases, registration, seat writes and unknown RPCs before forwarding', () => {
    for (const path of [
      '/rest/v1/rpc/process_tournament_addon',
      '/rest/v1/rpc/fn_register_for_tournament',
      '/rest/v1/table_seats',
      '/rest/v1/club_members',
    ])
      expect(forbiddenAddOnParticipation('POST', new URL('https://db.example' + path))).toBe(true);
    expect(
      forbiddenAddOnParticipation('POST', new URL('https://engine.smarter.poker/action'))
    ).toBe(true);
    for (const rpc of ['fn_db_now', 'fn_mystery_bounty_table_state'])
      expect(
        forbiddenAddOnParticipation('POST', new URL('https://db.example/rest/v1/rpc/' + rpc))
      ).toBe(false);
    expect(
      forbiddenAddOnParticipation('GET', new URL('https://db.example/rest/v1/tournaments'))
    ).toBe(false);
    expect(forbiddenAddOnParticipation('POST', new URL('https://db.example/auth/v1/token'))).toBe(
      false
    );
    expect(
      forbiddenAddOnParticipation(
        'POST',
        new URL('https://db.example/rest/v1/rpc/fn_get_tournament')
      )
    ).toBe(false);
  });
});

describe('countdown samples retain their browser observation time', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it.each([0, 10])(
    'keeps %s seconds of actual drift despite a delayed protocol response',
    async (drift) => {
      const browserAt = Date.parse('2026-11-06T16:11:10Z');
      const end = browserAt + 50_000;
      let now = browserAt;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      vi.stubGlobal('document', { visibilityState: 'visible' });
      const timer = {
        evaluate: async (capture: (element: { textContent: string }) => unknown) => {
          const sample = capture({ textContent: `0:${50 - drift}` });
          // The DOM is read first; the runner receives that result ten seconds later.
          await Promise.resolve();
          now += 10_000;
          return sample;
        },
      } as unknown as Pick<Locator, 'evaluate'>;
      const sample = await readAddOnCountdown(timer, end);
      expect(sample.at).toBe(browserAt);
      expect(sample.receivedAt - sample.at).toBe(10_000);
      expect(sample.visibility).toBe('visible');
      expect(sample.driftSeconds).toBe(drift);
      if (drift === 0) {
        // The former cross-process timestamp comparison creates a false ten-second drift.
        expect(Math.abs(sample.seconds - Math.ceil((end - sample.receivedAt) / 1000))).toBe(10);
        expect(sample.driftSeconds).toBeLessThanOrEqual(3);
      } else expect(sample.driftSeconds).toBeGreaterThan(3);
    }
  );
});

describe('natural increment evidence remains independent of reconnect', () => {
  const changes = [
    { tableId: id, at: 100, count: 30 },
    { tableId: id, at: 200, count: 31 },
  ];
  const signals = [{ tableId: id, at: 150 }];
  it('accepts a signal-backed increment late in the original page lifetime', () => {
    expect(hasNaturalAddOnIncrement([id], changes, signals, {})).toBe(true);
    expect(hasNaturalAddOnIncrement([id], changes, signals, { [id]: 201 })).toBe(true);
  });
  it('never treats a reload or initial count as a natural increment', () => {
    expect(hasNaturalAddOnIncrement([id], changes, signals, { [id]: 200 })).toBe(false);
    expect(hasNaturalAddOnIncrement([id], changes.slice(0, 1), signals, {})).toBe(false);
    expect(hasNaturalAddOnIncrement([id], changes, [], {})).toBe(false);
  });
});

describe('pre-opening live roster synchronization', () => {
  it('closes retired contexts before subscribing additions and records actual readiness', async () => {
    const calls: string[] = [];
    let clock = 100;
    let release!: () => void;
    const snapshot = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sync = synchronizeAddOnObservers(
      ['old', 'kept'],
      ['new', 'kept'],
      50,
      {
        close: async (id) => {
          calls.push(`close:${id}`);
        },
        open: async (id) => {
          calls.push(`open:${id}`);
          await snapshot;
        },
      },
      () => clock
    );
    await vi.waitFor(() => expect(calls).toEqual(['close:old', 'open:new']));
    let finished = false;
    void sync.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    clock = 200;
    release();
    expect(await sync).toEqual({ ids: ['kept', 'new'], readyAt: 200 });
  });
  it('keeps readiness on an unchanged live roster and advances it after removal', async () => {
    const operations = { open: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    expect(
      await synchronizeAddOnObservers(['a', 'b'], ['b', 'a'], 10, operations, () => 99)
    ).toEqual({ ids: ['a', 'b'], readyAt: 10 });
    expect(operations.open).not.toHaveBeenCalled();
    expect(operations.close).not.toHaveBeenCalled();
    expect(await synchronizeAddOnObservers(['a', 'b'], ['b'], 10, operations, () => 99)).toEqual({
      ids: ['b'],
      readyAt: 99,
    });
    expect(operations.close).toHaveBeenCalledWith('a');
  });
  it('never declares readiness after a failed added snapshot or an invalid roster', async () => {
    const operations = {
      open: vi.fn(async () => {
        throw new Error('snapshot missing');
      }),
      close: vi.fn(async () => {}),
    };
    await expect(synchronizeAddOnObservers(['a'], ['a', 'b'], 10, operations)).rejects.toThrow(
      'snapshot missing'
    );
    operations.open.mockClear();
    for (const ids of [[], ['a', 'a'], Array.from({ length: 9 }, (_, i) => String(i))])
      await expect(synchronizeAddOnObservers(['a'], ids, 10, operations)).rejects.toThrow(
        'bounded'
      );
    expect(operations.open).not.toHaveBeenCalled();
    expect(operations.close).not.toHaveBeenCalled();
  });
});

describe('atomic add-on card evidence', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });
  function fixture() {
    document.body.innerHTML = `<div class="break-screen">
      <h2>Add-On Break</h2><span>Add-On Closes In</span><span>All Tables Paused</span>
      <span role="timer">0:44</span>
      <div class="break-screen__stat"><span class="break-screen__stat-label">Add-On Cost</span><span class="break-screen__stat-value">35</span></div>
      <div class="break-screen__stat"><span class="break-screen__stat-label">Chips Received</span><span class="break-screen__stat-value" title="20,000">20K</span></div>
      <span aria-label="Players Who Took Add-On">1,234</span>
    </div>`;
    // happy-dom has no layout engine; supply measurable boxes while exercising
    // the real DOM selectors and computed visibility styles.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 100,
      height: 20,
    } as DOMRect);
    return { evaluate: vi.fn(async (capture: () => unknown) => capture()) };
  }
  it('captures labels, price, chips, timer, count and browser time in one evaluation', async () => {
    const page = fixture();
    vi.spyOn(Date, 'now').mockReturnValue(12345);
    const sample = await readAddOnCard(page as unknown as Pick<Page, 'evaluate'>);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(sample).toMatchObject({
      at: 12345,
      receivedAt: 12345,
      dialogVisible: true,
      titleVisible: true,
      closingVisible: true,
      pausedVisible: true,
      cost: '35',
      chips: '20,000',
      text: '0:44',
      timerCount: 1,
      count: '1,234',
    });
  });
  it('does not accept missing, hidden, collapsed or zero-area labels', async () => {
    const page = fixture();
    const title = document.querySelector('h2')!;
    title.style.visibility = 'hidden';
    expect((await readAddOnCard(page as unknown as Pick<Page, 'evaluate'>)).titleVisible).toBe(
      false
    );
    title.style.visibility = 'collapse';
    expect((await readAddOnCard(page as unknown as Pick<Page, 'evaluate'>)).titleVisible).toBe(
      false
    );
    title.style.visibility = 'visible';
    title.style.display = 'none';
    expect((await readAddOnCard(page as unknown as Pick<Page, 'evaluate'>)).titleVisible).toBe(
      false
    );
    title.style.display = 'block';
    vi.spyOn(title, 'getBoundingClientRect').mockReturnValue({ width: 0, height: 20 } as DOMRect);
    expect((await readAddOnCard(page as unknown as Pick<Page, 'evaluate'>)).titleVisible).toBe(
      false
    );
    title.remove();
    expect((await readAddOnCard(page as unknown as Pick<Page, 'evaluate'>)).titleVisible).toBe(
      false
    );
  });
  it('retains missing values and refuses duplicate exact labels instead of fabricating proof', async () => {
    const page = fixture();
    document.querySelector('[role="timer"]')!.remove();
    document.querySelector('[aria-label="Players Who Took Add-On"]')!.remove();
    document
      .querySelector('.break-screen')!
      .insertAdjacentHTML('beforeend', '<h3>Add-On Break</h3>');
    const sample = await readAddOnCard(page as unknown as Pick<Page, 'evaluate'>);
    expect(sample.titleVisible).toBe(false);
    expect(sample.text).toBe('');
    expect(sample.count).toBe('');
  });
});
