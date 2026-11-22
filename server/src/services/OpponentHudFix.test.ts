/**
 * OPPONENT-HUD-FIX-1 (PLO-OWNER lead-3, 2026-11-21; AUDIT-C-HUD.md items 3, 4, 5, 6, 9, 10): each test fails on the
 * provider as the list train shipped it (3f481eba8ffc) and passes with the fix.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import {
  HUD_READY_DEADLINE_MS,
  OpponentHudStore,
  persistOpponentHudBeforeExit,
  setOpponentHudStoreForTest,
  warmOpponentHudSeats,
  type HudStoredRow,
  type OpponentHudStoreDeps,
} from './OpponentHudStore.js';
import {
  applyHudHand,
  emptyHudProfile,
  handRecordFromRow,
  type HudHandRecord,
} from '../engine/opponentHud/OpponentHudProfile.js';
import {
  HUD_BACKFILL_PAGE_LIMIT,
  isTransientBackfillError,
  pageAllOpponentHudHands,
  planOpponentHudBackfill,
  withTransientBackfillRetry,
} from '../engine/opponentHud/OpponentHudBackfillPlan.js';
import {
  depositTournamentMovePresence,
  hasTournamentMovePresence,
  resetTournamentMovePresence,
} from '../engine/SeatMovePresence.js';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = 1_800_000_000_000;
const HOUR = 3600_000;
function row(id: number, a: number, b: number, at: number) {
  return {
    id: H(id),
    created_at: new Date(at).toISOString(),
    game_variant: 'plo5',
    tournament_id: null,
    big_blind: 2,
    button_seat: 1,
    players: [
      { seat: 1, userId: U(a), stack: 400 },
      { seat: 2, userId: U(b), stack: 400 },
    ],
    actions: [
      { seat: 1, userId: U(a), stage: 'preflop', action: 'sb', amount: 1 },
      { seat: 2, userId: U(b), stage: 'preflop', action: 'bb', amount: 2 },
      { seat: 1, userId: U(a), stage: 'preflop', action: 'raise', amount: 6 },
      { seat: 2, userId: U(b), stage: 'preflop', action: 'fold', amount: 0 },
    ],
    community_cards: [],
    showdown: [],
    winners: [{ userId: U(a), amount: 8 }],
  };
}
function lifetime(user: number, n: number): HudStoredRow {
  const p = emptyHudProfile(U(user), 'plo5');
  for (let i = 0; i < n; i++)
    applyHudHand(
      p,
      handRecordFromRow(row(10_000 + i, user, 99, T0 - 86_400_000 + i * 1000)) as HudHandRecord
    );
  return {
    user_id: U(user),
    family: 'plo5',
    version: 1,
    hands: p.hands,
    wm_ms: p.wm,
    rev: 1,
    profile: p,
  };
}
const flush = async (n = 30) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

type Deps = OpponentHudStoreDeps & {
  tick(ms: number): void;
  stored: Map<string, HudStoredRow>;
  timers: { at: number; fn: () => void }[];
  alerts: [string, boolean][];
  hands: ReturnType<typeof row>[];
  runTimers(): void;
};
function deps(syncMs: number | null, opts: { readFails?: number; pageFails?: number } = {}): Deps {
  let now = T0;
  let readFails = opts.readFails ?? 0;
  let pageFails = opts.pageFails ?? 0;
  const stored = new Map<string, HudStoredRow>();
  stored.set('plo5|*', {
    user_id: '*',
    family: 'plo5',
    version: 1,
    hands: 0,
    wm_ms: syncMs ?? T0 - 400 * HOUR,
    profile: { family: {}, stakes: {} },
  });
  const d: Deps = {
    stored,
    timers: [],
    alerts: [],
    hands: [],
    async read(ids, family) {
      if (ids.some((u) => u !== '*' && u !== '#sync') && readFails > 0) {
        readFails -= 1;
        now += 2_000; // the 2-second timeout elapsed
        throw new Error('timeout');
      }
      return ids.flatMap((u) => {
        const r = stored.get(`${family}|${u}`);
        return r ? [structuredClone(r)] : [];
      });
    },
    async recent() {
      return [...stored.values()].map((r) => structuredClone(r));
    },
    async upsert(rows) {
      const refused: string[] = [];
      for (const r of rows as (HudStoredRow & { base_rev?: number })[]) {
        const k = `${r.family}|${r.user_id}`;
        const cur = stored.get(k);
        const special = r.user_id === '*' || r.user_id === '#sync';
        if (!special && (r.base_rev ?? -1) !== (cur?.rev ?? 0)) refused.push(k);
        else stored.set(k, { ...structuredClone(r), rev: (cur?.rev ?? 0) + 1 });
      }
      return refused;
    },
    async handsPage(afterAt, afterId) {
      if (pageFails > 0) {
        pageFails -= 1;
        throw new Error('page timeout');
      }
      return d.hands
        .filter((h) => h.created_at > afterAt || (h.created_at === afterAt && h.id > afterId))
        .map((h) => structuredClone(h));
    },
    alert(name, firing) {
      d.alerts.push([name, firing]);
    },
    now: () => now,
    sleep: async () => undefined,
    schedule(ms, fn) {
      d.timers.push({ at: now + ms, fn });
    },
    tick(ms) {
      now += ms;
    },
    runTimers() {
      const due = d.timers.filter((t) => t.at <= now);
      d.timers = d.timers.filter((t) => t.at > now);
      for (const t of due) t.fn();
    },
  };
  return d;
}
async function armed(d: Deps): Promise<OpponentHudStore> {
  const s = new OpponentHudStore(d);
  s.setArmed(true);
  for (let i = 0; i < 40 && !s.lastActivation; i++) await flush(2);
  await flush();
  return s;
}

describe('OPPONENT-HUD-FIX-1 item 2 (AUDIT-C 4): a slow read cannot push readiness past 15 seconds', () => {
  for (const timeouts of [1, 3]) {
    it(`${timeouts} consecutive 2-second timeout(s), then success: ready inside ${HUD_READY_DEADLINE_MS} ms`, async () => {
      const d = deps(T0 - 60_000, { readFails: timeouts });
      d.stored.set(`plo5|${U(1)}`, lifetime(1, 5));
      d.recent = async () => []; // nothing prewarmed: the seat event is what loads him
      const s = await armed(d);
      const askedAt = d.now();
      s.warm([U(1)], 'plo5', 'sit');
      let readyAt: number | null = null;
      for (let t = 0; t <= 20_000 && readyAt === null; t += 250) {
        await flush(4);
        if (s.ready(U(1), 'plo5')) readyAt = d.now() - askedAt;
        d.tick(250);
        d.runTimers();
        // the decisions at the table keep asking, as in production
        if (t % 1000 === 0)
          s.packetFor({
            family: 'plo5',
            cash: true,
            heroId: U(9),
            opponentIds: [U(1)],
            street: 'preflop',
            atMs: d.now(),
          });
      }
      expect(readyAt).not.toBeNull();
      expect(readyAt!).toBeLessThan(HUD_READY_DEADLINE_MS);
      expect(s.profile(U(1), 'plo5')!.hands).toBe(5);
    });
  }
});

describe('OPPONENT-HUD-FIX-1 item 5 (AUDIT-C 9/10): the sync point never moves past an uncounted gap', () => {
  it('no sync point within 48 hours: profiles are saved, #sync is held and alerted until the backfill writes one', async () => {
    const d = deps(null);
    d.stored.set(`plo5|${U(1)}`, lifetime(1, 5));
    d.hands.push(row(1, 1, 2, T0 - HOUR));
    const s = await armed(d);
    expect(s.lastActivation).toMatchObject({ capped: true });
    expect(d.alerts).toContainEqual(['OpponentHudSyncHeld', true]);
    expect(d.stored.get(`plo5|${U(1)}`)!.hands).toBe(6); // the catch-up hand is saved, once
    expect(d.stored.has('plo5|#sync')).toBe(false);
    s.onAcceptedHand(row(2, 1, 2, T0 + 1000));
    await s.persist();
    expect(d.stored.get(`plo5|${U(1)}`)!.hands).toBe(7);
    expect(d.stored.has('plo5|#sync')).toBe(false);
    // still no backfill: the alert tick changes nothing
    s.tickAlerts();
    await flush();
    expect(d.stored.has('plo5|#sync')).toBe(false);
    // the backfill ran (its population row carries its last hand as the sync point)
    d.stored.get('plo5|*')!.wm_ms = T0 + 1000;
    s.tickAlerts();
    await flush(60);
    expect(d.alerts).toContainEqual(['OpponentHudSyncHeld', false]);
    s.onAcceptedHand(row(3, 1, 2, T0 + 3000));
    await s.persist();
    expect(d.stored.has('plo5|#sync')).toBe(true);
    expect(d.stored.get(`plo5|${U(1)}`)!.hands).toBe(8);
  });

  it('a switch-on catch-up whose page failed holds the sync point and is re-run; then the sync point moves', async () => {
    const d = deps(T0 - 60_000, { pageFails: 1 });
    d.stored.set(`plo5|${U(1)}`, lifetime(1, 5));
    d.hands.push(row(1, 1, 2, T0 - 30_000));
    const s = await armed(d);
    s.onAcceptedHand(row(2, 1, 2, T0 + 1000));
    await s.persist();
    expect(d.stored.get(`plo5|${U(1)}`)!.hands).toBe(6); // the live hand; the failed page's hand is not yet in
    expect(d.stored.has('plo5|#sync')).toBe(false);
    s.tickAlerts(); // the pending activation re-runs
    await flush(60);
    expect(d.stored.get(`plo5|${U(1)}`)!.hands).toBe(7);
    expect(d.stored.has('plo5|#sync')).toBe(true);
  });
});

describe('OPPONENT-HUD-FIX-1 item 1 (AUDIT-C 3): save on graceful stop and cutover', () => {
  it('the graceful-stop hook waits for a save in flight, then saves the hands it did not carry', async () => {
    const d = deps(T0 - 60_000);
    d.stored.set(`plo5|${U(1)}`, lifetime(1, 5));
    const s = await armed(d);
    s.warm([U(1)], 'plo5', 'sit');
    await flush();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const upsert = d.upsert;
    d.upsert = async (rows, sig) => {
      await gate;
      return upsert(rows, sig);
    };
    s.onAcceptedHand(row(1, 1, 2, T0 + 1000));
    const inFlight = s.persist();
    s.onAcceptedHand(row(2, 1, 2, T0 + 2000)); // settled while the save runs
    setOpponentHudStoreForTest(s);
    try {
      const exit = persistOpponentHudBeforeExit();
      release();
      await inFlight;
      await exit;
    } finally {
      setOpponentHudStoreForTest(null);
    }
    expect(d.stored.get(`plo5|${U(1)}`)!.hands).toBe(7);
  });

  it('off: the graceful-stop hook makes no database statement', async () => {
    const d = deps(T0 - 60_000);
    let statements = 0;
    d.read = async () => (statements++, []);
    d.upsert = async () => (statements++, []);
    const s = new OpponentHudStore(d);
    setOpponentHudStoreForTest(s);
    try {
      await persistOpponentHudBeforeExit();
    } finally {
      setOpponentHudStoreForTest(null);
    }
    expect(statements).toBe(0);
  });

  it('index.ts saves the store after every dealer has drained and before the process exits', () => {
    const src = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8');
    const body = src.slice(src.indexOf('async function performShutdown'));
    const drained = body.indexOf('await gameServer.stop();');
    const saved = body.indexOf('await persistOpponentHudBeforeExit();');
    const exit = body.indexOf('process.exit(shutdownMustFail ? 1 : 0)');
    expect(drained).toBeGreaterThan(0);
    expect(saved).toBeGreaterThan(drained);
    expect(exit).toBeGreaterThan(saved);
  });
});

describe('OPPONENT-HUD-FIX-1 item 3 (AUDIT-C 5): the boot and move triggers are produced', () => {
  it("switching on (engine boot or cutover) prewarms recent profiles, measured as the 'boot' trigger", async () => {
    enableBrainTelemetry();
    drainFires();
    const d = deps(T0 - 60_000);
    d.stored.set(`plo5|${U(1)}`, lifetime(1, 5));
    const s = await armed(d);
    expect(s.ready(U(1), 'plo5')).toBe(true);
    const fires = drainFires().map((f) => f.feature);
    expect(fires).toContain('opponent_hud_event_boot');
    expect(fires.some((f) => f.startsWith('opponent_hud_ready_boot_ms_'))).toBe(true);
  });

  it("a table-move arrival is the 'move' trigger (tournament moves are seen before they are claimed)", async () => {
    enableBrainTelemetry();
    drainFires();
    const d = deps(T0 - 60_000);
    const s = await armed(d);
    setOpponentHudStoreForTest(s);
    try {
      warmOpponentHudSeats([U(3)], 'plo5', true, 'move');
      await flush();
    } finally {
      setOpponentHudStoreForTest(null);
    }
    const fires = drainFires().map((f) => f.feature);
    expect(fires).toContain('opponent_hud_event_move');
    expect(fires.some((f) => f.startsWith('opponent_hud_ready_move_ms_'))).toBe(true);
    resetTournamentMovePresence();
    depositTournamentMovePresence(U(3), 'table-b', {
      requestId: 'r1',
      fromTableId: 'table-a',
      fsm: {} as never,
    });
    expect(hasTournamentMovePresence(U(3), 'table-b')).toBe(true);
    expect(hasTournamentMovePresence(U(3), 'table-a')).toBe(false);
    resetTournamentMovePresence();
  });
});

describe('OPPONENT-HUD-FIX-1 item 4 (AUDIT-C 6/10): the backfill starts at hand one and never wipes history', () => {
  const p = (user: string, hands: number) => ({ user, family: 'plo5', hands });
  const first = Date.parse('2026-07-22T00:00:00Z');
  it('a window starting after the first retained PLO hand is refused', () => {
    const plan = planOpponentHudBackfill({
      profiles: [p('a', 3)],
      storedHands: new Map(),
      sinceMs: Date.parse('2026-10-01T00:00:00Z'),
      firstRetainedMs: first,
    });
    expect(plan.ok).toBe(false);
    expect(plan.write).toEqual([]);
  });
  it('a stored row holding more hands than the rebuild read is kept, and no flag overrides that', () => {
    const plan = planOpponentHudBackfill({
      profiles: [p('a', 3), p('b', 9)],
      storedHands: new Map([
        ['plo5|a', 10],
        ['plo5|b', 4],
      ]),
      sinceMs: first,
      firstRetainedMs: first,
    });
    expect(plan.ok).toBe(true);
    expect(plan.kept.map((x) => x.user)).toEqual(['a']);
    expect(plan.write.map((x) => x.user)).toEqual(['b']);
    const forced = planOpponentHudBackfill({
      profiles: [p('a', 3)],
      storedHands: new Map([['plo5|a', 10]]),
      sinceMs: first,
      firstRetainedMs: first,
      forceRequested: true,
    });
    expect(forced.ok).toBe(false);
    expect(forced.write).toEqual([]);
  });
  it('the build script defaults --since to the first retained hand and has no wiping override', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../scripts/opponent-hud-build.ts', import.meta.url)),
      'utf8'
    );
    expect(src).toMatch(/since \?\?= new Date\(firstRetainedMs/);
    expect(src).not.toMatch(/2026-01-01T00:00:00Z|2026-10-01/);
    expect(src).not.toMatch(/stored > p\.hands && !flag\('--force'\)/);
    expect(src).toMatch(/planOpponentHudBackfill\(/);
    // Regression guard (2026-11-22 dry-runs 44984942583 & 45026021393): PostgREST max_rows=1000 truncated
    // p_limit=1500 after page 1, p_limit=1000 crossed the 8s statement_timeout on a heavy page, and missing
    // process.exit(0) left Supabase client handles open for 6 hours.
    expect(HUD_BACKFILL_PAGE_LIMIT).toBeLessThanOrEqual(500);
    expect(src).toMatch(/pageAllOpponentHudHands\(/);
    expect(src).toMatch(/withTransientBackfillRetry\(/);
    expect(src).not.toMatch(/rows\.length\s*<\s*1500|p_limit:\s*1500/);
    expect(src).toMatch(/process\.exit\(0\)/);
  });
  it('drains every page to true EOF even when PostgREST caps pages below the requested limit', async () => {
    const allRows = Array.from({ length: 2350 }, (_, i) => ({
      id: H(i + 1),
      created_at: new Date(Date.parse('2026-07-22T14:29:00.000Z') + i * 1000).toISOString(),
    }));
    // Simulate PostgREST server-side cap strictly smaller than requested limit.
    const serverCap = 300;
    const seen: string[] = [];
    const requestedLimits: number[] = [];
    const res = await pageAllOpponentHudHands({
      since: '2026-07-22T14:29:00.000Z',
      until: '2026-11-22T00:00:00.000Z',
      limit: HUD_BACKFILL_PAGE_LIMIT,
      fetchPage: async ({ afterAt, afterId, limit }) => {
        requestedLimits.push(limit);
        const start = allRows.findIndex(
          (r) => r.created_at > afterAt || (r.created_at === afterAt && r.id > afterId)
        );
        if (start === -1) return [];
        return allRows.slice(start, start + Math.min(limit, serverCap));
      },
      onRow: (r) => seen.push(r.id),
    });
    expect(Math.max(...requestedLimits)).toBeLessThanOrEqual(500);
    expect(res.pages).toBe(8);
    expect(res.rows).toBe(2350);
    expect(res.retries).toBe(0);
    expect(seen).toHaveLength(2350);
    expect(seen[0]).toBe(H(1));
    expect(seen[seen.length - 1]).toBe(H(2350));
  });
  it('halves page size and retries cleanly on transient statement timeouts, then recovers back to base limit', async () => {
    const allRows = Array.from({ length: 2100 }, (_, i) => ({
      id: H(i + 1),
      created_at: new Date(Date.parse('2026-07-22T14:29:00.000Z') + i * 1000).toISOString(),
    }));
    const seen: string[] = [];
    const observedLimits: number[] = [];
    const sleeps: number[] = [];
    let timedOutOnce = false;
    const res = await pageAllOpponentHudHands({
      since: '2026-07-22T14:29:00.000Z',
      until: '2026-11-22T00:00:00.000Z',
      limit: 500,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchPage: async ({ afterAt, afterId, limit }) => {
        observedLimits.push(limit);
        const start = allRows.findIndex(
          (r) => r.created_at > afterAt || (r.created_at === afterAt && r.id > afterId)
        );
        if (start === -1) return [];
        // Page 2 fails once at limit=500 with PostgREST 8s statement timeout, succeeds at limit=250.
        if (start === 500 && limit > 250 && !timedOutOnce) {
          timedOutOnce = true;
          throw new Error('hands page failed: canceling statement due to statement timeout');
        }
        return allRows.slice(start, start + limit);
      },
      onRow: (r) => seen.push(r.id),
    });
    expect(res.rows).toBe(2100);
    expect(res.retries).toBe(1);
    expect(sleeps).toEqual([1000]);
    expect(observedLimits.slice(0, 3)).toEqual([500, 500, 250]);
    // After 5 clean pages at 250, limit recovers back to 500.
    expect(observedLimits[observedLimits.length - 1]).toBe(500);
    expect(new Set(seen).size).toBe(2100);
    expect(seen[0]).toBe(H(1));
    expect(seen[seen.length - 1]).toBe(H(2100));
  });
  it('fails closed immediately on non-transient errors and after exhausting bounded transient retries', async () => {
    expect(
      isTransientBackfillError(new Error('canceling statement due to statement timeout'))
    ).toBe(true);
    expect(isTransientBackfillError(new Error('permission denied for function'))).toBe(false);
    let permAttempts = 0;
    await expect(
      pageAllOpponentHudHands({
        since: '2026-07-22T14:29:00.000Z',
        until: '2026-11-22T00:00:00.000Z',
        sleep: async () => {},
        fetchPage: async () => {
          permAttempts += 1;
          throw new Error('permission denied for function fn_opponent_hud_hands_page');
        },
        onRow: () => {},
      })
    ).rejects.toThrow(/permission denied/);
    expect(permAttempts).toBe(1);

    let timeoutAttempts = 0;
    await expect(
      pageAllOpponentHudHands({
        since: '2026-07-22T14:29:00.000Z',
        until: '2026-11-22T00:00:00.000Z',
        maxRetries: 3,
        sleep: async () => {},
        fetchPage: async () => {
          timeoutAttempts += 1;
          throw new Error('hands page failed: canceling statement due to statement timeout');
        },
        onRow: () => {},
      })
    ).rejects.toThrow(/statement timeout/);
    expect(timeoutAttempts).toBe(4);

    let rpcAttempts = 0;
    const out = await withTransientBackfillRetry(
      async () => {
        rpcAttempts += 1;
        if (rpcAttempts < 3) throw new Error('502 Bad Gateway');
        return 'ok';
      },
      { sleep: async () => {} }
    );
    expect(out).toBe('ok');
    expect(rpcAttempts).toBe(3);
  });
  it('fails closed when a non-empty page fails to advance the keyset cursor', async () => {
    await expect(
      pageAllOpponentHudHands({
        since: '2026-07-22T14:29:00.000Z',
        until: '2026-11-22T00:00:00.000Z',
        fetchPage: async () => [{ id: H(1), created_at: '2026-07-22T14:29:00.000Z' }],
        onRow: () => {},
      })
    ).rejects.toThrow(/cursor did not advance/);
  });
});
