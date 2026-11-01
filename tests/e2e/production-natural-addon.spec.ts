import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { isReadOnlySpectatorSocketType } from './support/spectatorSocketRead';
import {
  admitNaturalAddOn,
  completeAddOnRoster,
  addOnWindow,
  countdownSeconds,
  forbiddenAddOnParticipation,
  type AddOnTable,
} from './support/naturalAddOnWitness';

// This is opt-in through the maintained provider. No synthetic events or raw
// socket/token/hand-state traces are saved. SQL hand-overlap proof is separate.
test.use({ viewport: { width: 393, height: 852 }, trace: 'off', video: 'off' });
test('every captured natural add-on table renders its public minute', async ({
  browser,
  context,
  request,
}, info) => {
  test.setTimeout(12 * 60_000);
  const tournamentId = admitNaturalAddOn({
    natural_addon_tournament_id: process.env.NATURAL_ADDON_TOURNAMENT_ID,
    engine_sha: process.env.EXPECTED_ENGINE_SHA,
  });
  const accountFile = process.env.E2E_TEST_ACCOUNT_FILE;
  if (!accountFile) throw new Error('UNKNOWN: maintained reserved account record missing');
  const account = JSON.parse(await readFile(accountFile, 'utf8'));
  if (
    !/^ca-customization-cert-postdeploy-.*@example\.invalid$/.test(String(account.email)) ||
    account.email !== process.env.SP_EMAIL
  )
    throw new Error('Natural add-on observation refuses a non-reserved identity');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('UNKNOWN: provider read-only roster access missing');
  // Service authority is used ONLY by these explicit SELECTs to prove completeness,
  // never installed in a browser or used for an Auth/gameplay mutation.
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
    },
  });
  const columns =
    'id,status,current_level,late_reg_levels,rebuy_levels,late_reg_mins,started_at,addon_from_start,add_on_available,addon_period_triggered,addon_period_started_at,addon_period_ends_at,addon_cost,addon_chips,buy_in_amount,starting_chips,prize_pool_finalized';
  const contexts: BrowserContext[] = [];
  const pages = new Map<string, Page>();
  const received = new Map<string, Set<string>>();
  const blocked: { tableId: string; transport: string; operation: string }[] = [];
  const evidence: Record<string, any> = {
    tournamentId,
    source: 'natural-production-spectator',
    participantDeviceAcknowledgements: false,
    handOverlapProof: 'separate SQL evidence required',
    rosterReads: [],
    observations: [],
  };
  async function readBoard() {
    const [board, tables] = await Promise.all([
      db.from('tournaments').select(columns).eq('id', tournamentId).maybeSingle(),
      db
        .from('tables')
        .select('id,status,tournament_id', { count: 'exact' })
        .eq('tournament_id', tournamentId)
        .order('id')
        .range(0, 8),
    ]);
    if (board.error || tables.error || !board.data)
      throw new Error('UNKNOWN: authoritative tournament/complete roster read failed');
    evidence.rosterReads.push({
      at: Date.now(),
      count: tables.count,
      rows: tables.data,
      board: board.data,
    });
    return {
      board: board.data,
      roster: completeAddOnRoster(tables.data as AddOnTable[] | null, tables.count, tournamentId),
    };
  }
  async function engineIdentity() {
    const response = await request.get(
      `https://engine.smarter.poker/health?addon_observation=${Date.now()}`,
      { timeout: 10_000 }
    );
    expect(response.ok(), 'UNKNOWN: engine health unreadable').toBe(true);
    const health = await response.json();
    expect(health.releaseSha, 'Serving full engine release changed').toBe(
      process.env.EXPECTED_ENGINE_SHA
    );
    const identity = {
      releaseSha: health.releaseSha,
      version: health.version,
      instance: health.instanceId ?? health.instance_id ?? health.instance,
    };
    if (typeof identity.instance !== 'string' || !identity.instance)
      throw new Error('UNKNOWN: engine instance unavailable');
    return identity;
  }
  const state = await context.storageState();
  async function openTable(tableId: string) {
    const observer = await browser.newContext({
      storageState: state,
      viewport: { width: 393, height: 852 },
      serviceWorkers: 'block',
    });
    contexts.push(observer);
    await observer.route('**/*', async (route) => {
      const req = route.request();
      if (forbiddenAddOnParticipation(req.method(), new URL(req.url()))) {
        blocked.push({ tableId, transport: 'http', operation: new URL(req.url()).pathname });
        await route.abort('blockedbyclient');
      } else await route.continue();
    });
    await observer.routeWebSocket(
      () => true,
      (client) => {
        const engine = new URL(client.url()).hostname === 'engine.smarter.poker';
        const server = client.connectToServer();
        server.onMessage((message) => {
          if (engine) {
            try {
              const frame = JSON.parse(String(message));
              if (frame.tableId === tableId && typeof frame.type === 'string') {
                const types = received.get(tableId) ?? new Set<string>();
                types.add(frame.type);
                received.set(tableId, types);
              }
            } catch {
              /* Real bytes still reach the served consumer unchanged. */
            }
          }
          client.send(message);
        });
        client.onMessage((message) => {
          if (engine) {
            let type = '';
            try {
              type = String(JSON.parse(String(message)).type || '');
            } catch {
              /* refused */
            }
            if (!isReadOnlySpectatorSocketType(type)) {
              blocked.push({ tableId, transport: 'websocket', operation: type || 'unreadable' });
              return;
            }
          }
          server.send(message);
        });
      }
    );
    const page = await observer.newPage();
    await page.goto(
      new URL(
        `table/${tableId}`,
        `${process.env.ARENA_BASE_URL || 'https://smarter.poker/hub/club-arena'}/`
      ).href,
      { waitUntil: 'domcontentloaded', timeout: 30_000 }
    );
    pages.set(tableId, page);
    await expect
      .poll(() => received.get(tableId)?.has('SNAPSHOT') ?? false, {
        timeout: 20_000,
        message: `UNKNOWN: table ${tableId} never supplied its real snapshot`,
      })
      .toBe(true);
    return page;
  }
  async function rendered(
    tableId: string,
    page: Page,
    window: NonNullable<ReturnType<typeof addOnWindow>>,
    phase: string
  ) {
    const dialog = page.locator('.break-screen');
    await expect(dialog.getByText('Add-On Break', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Add-On Closes In', { exact: true })).toBeVisible();
    await expect(dialog.getByText('All Tables Paused', { exact: true })).toBeVisible();
    const cost = dialog
      .locator('.break-screen__stat')
      .filter({ has: page.getByText('Add-On Cost', { exact: true }) })
      .locator('.break-screen__stat-value');
    const chips = dialog
      .locator('.break-screen__stat')
      .filter({ has: page.getByText('Chips Received', { exact: true }) })
      .locator('.break-screen__stat-value');
    await expect(cost).toHaveText(window.cost.toLocaleString('en-US'));
    await expect(chips).toHaveAttribute('title', window.chips.toLocaleString('en-US'));
    const seconds = countdownSeconds(await dialog.getByRole('timer').innerText());
    const now = Date.now();
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(60);
    expect(
      Math.abs(seconds - Math.ceil((window.end - now) / 1000)),
      'Rendered countdown differs from durable deadline'
    ).toBeLessThanOrEqual(3);
    evidence.observations.push({
      tableId,
      phase,
      at: now,
      seconds,
      cost: await cost.innerText(),
      chips: await chips.getAttribute('title'),
      receivedTypes: [...(received.get(tableId) ?? [])],
    });
    if (phase === 'opened')
      await info.attach(`${tableId}-${phase}`, {
        body: await dialog.screenshot(),
        contentType: 'image/png',
      });
    return seconds;
  }
  try {
    evidence.engineBefore = await engineIdentity();
    const initial = await readBoard();
    evidence.initialRoster = initial.roster;
    expect(initial.board.status).toBe('RUNNING');
    expect(initial.board.add_on_available).toBe(true);
    if (initial.board.addon_period_triggered || initial.board.addon_period_started_at)
      throw new Error('UNKNOWN: add-on already opened before full-roster observers were ready');
    await Promise.all(initial.roster.map((row) => openTable(row.id)));
    const readyAt = Date.now();
    const ids = initial.roster.map((row) => row.id).sort();
    const deadline = readyAt + 8 * 60_000;
    let window: ReturnType<typeof addOnWindow> = null;
    while (Date.now() < deadline) {
      const current = await readBoard();
      expect(
        current.roster.map((row) => row.id).sort(),
        'UNKNOWN: roster changed; initial rows retained, no incomplete proof'
      ).toEqual(ids);
      if (current.roster.some((row, index) => row.status !== initial.roster[index].status))
        throw new Error(
          'UNKNOWN: table status changed; roster transition retained for SQL reconciliation'
        );
      window = addOnWindow(current.board);
      if (window) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!window) throw new Error('UNKNOWN: no natural add-on within the bounded observation');
    if (window.start < readyAt || Date.now() - window.start > 10_000)
      throw new Error('UNKNOWN: natural opening was missed or observed too late');
    evidence.window = window;
    const first = await Promise.all(
      ids.map((id) => rendered(id, pages.get(id)!, window!, 'opened'))
    );
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const second = await Promise.all(
      ids.map((id) => rendered(id, pages.get(id)!, window!, 'progressing'))
    );
    second.forEach((seconds, index) => expect(seconds).toBeLessThan(first[index]));
    // Reopen one existing table only after closing its context: never exceed
    // eight live observers. This is a late-open consumer, not a ninth connection.
    const lateId = ids[0];
    await pages.get(lateId)!.context().close();
    received.delete(lateId);
    const late = await openTable(lateId);
    await rendered(lateId, late, window, 'late-open');
    // Reload creates a real client reconnect; no injected visibility/events.
    received.delete(lateId);
    await late.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    await expect
      .poll(() => received.get(lateId)?.has('SNAPSHOT') ?? false, { timeout: 10_000 })
      .toBe(true);
    await rendered(lateId, late, window, 'reconnected');
    const remaining = window.end - Date.now();
    if (remaining <= 0) throw new Error('UNKNOWN: reconnect exhausted the natural add-on window');
    if (remaining < 5000)
      throw new Error('UNKNOWN: no time remains to observe the end of the minute');
    await new Promise((resolve) => setTimeout(resolve, remaining - 3000));
    await Promise.all(ids.map((id) => rendered(id, pages.get(id)!, window!, 'before-close')));
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, window!.end - Date.now()) + 1000)
    );
    await Promise.all(
      ids.map(async (id) => {
        await expect(pages.get(id)!.getByText('Add-On Closes In', { exact: true })).toHaveCount(0, {
          timeout: 10_000,
        });
        evidence.observations.push({ tableId: id, phase: 'closed', at: Date.now() });
      })
    );
    const final = await readBoard();
    evidence.finalRoster = final.roster;
    expect(
      final.roster.map((row) => row.id).sort(),
      'UNKNOWN: closing roster changed; original roster remains in evidence'
    ).toEqual(ids);
    evidence.engineAfter = await engineIdentity();
    expect(evidence.engineAfter).toEqual(evidence.engineBefore);
    expect(blocked, 'Served spectator attempted a forbidden participation request').toEqual([]);
    evidence.consumerProof = 'passed';
  } finally {
    evidence.blockedParticipation = blocked;
    await Promise.all(contexts.map((observer) => observer.close().catch(() => undefined)));
    await info.attach('natural-addon-evidence', {
      body: Buffer.from(JSON.stringify(evidence, null, 2)),
      contentType: 'application/json',
    });
  }
});
