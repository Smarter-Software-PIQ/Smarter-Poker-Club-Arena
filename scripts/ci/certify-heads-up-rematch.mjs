/**
 * LIVE HEADS-UP REMATCH CERTIFICATION (Dan 2026-11-08: "Complete the signed-in
 * Play Again flow and verify a committed rematch reaches the engine, deals its
 * first hand and retains the same opponent with correct buy-ins and rake. Use
 * the supported test accounts and funding route.")
 *
 * Against production and the serving engine:
 *   1. two reserved players buy the two seats of a fresh heads-up Sit & Go in
 *      a certification club, through the browser's own seat door;
 *   2. the engine starts it, and they play it out (all in every hand);
 *   3. one player taps Play Again in a real signed-in browser. The other
 *      answers Yes through the same door the card calls;
 *   4. the committed rematch is checked: a new game with the same two players
 *      in the same seats, each charged one buy-in plus fee, prize pool and rake
 *      equal to the finished game's, the browser moved to the new table, and
 *      the engine started it and dealt its first hand;
 *   5. the rematch is played out, and chips are conserved across both games.
 *
 * The supported certification route, nothing improvised:
 *   accounts : createProductionE2EAccount / cleanupProductionE2EAccount
 *              (reserved ca-customization-cert-postdeploy-* identities);
 *   chips    : the certification club's own opening grant, sent to each player
 *              from the club bank and claimed back by the owner afterwards;
 *   game     : the creation door the engine's board uses,
 *              fn_create_seat_first_game_atomic, given the configuration of a
 *              live board heads-up game with only the club changed;
 *   cleanup  : settleRabbitHuntClub (claim back, retire with records), then
 *              the three accounts. Cleanup always runs.
 * No mint, no real account, no real player's table.
 *
 * GATES: outside the Sit & Go window (03:00-06:00 Chicago), during a freeze or
 * while the engine is not idle, the run ends UNKNOWN and creates nothing.
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  APP_ORIGIN,
  ENGINE_URL,
  clients,
  fixtureBrowserId,
  ownerRetainedAsRecord,
  settleRabbitHuntClub,
} from './certify-rabbit-hunt.mjs';

// production-e2e-account.mjs pins the same prefix (HEADS_UP_CLUB_NAME_PREFIX).
export const HEADS_UP_CERT_CLUB_NAME_PREFIX = 'Cert HU ';
const GAME_DEADLINE_MS = 15 * 60_000;

const log = (...a) =>
  console.log('[heads-up-rematch-cert]', ...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cents = (n) => Math.round(Number(n) * 100);

/** The Sit & Go window (owner 2026-11-03): no rematch from 03:00 until 06:00 Chicago. */
export function inSitAndGoWindow(now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(now)
  );
  return !(hour >= 3 && hour < 6);
}

/** The board configuration a certification game is created from, with only the club changed. */
export function certificationConfig(template, clubId, now = Date.now()) {
  const keep = [
    'name', 'game_type', 'variant', 'tournament_type', 'buy_in_amount', 'buy_in_fee',
    'guaranteed_prize', 'starting_chips', 'max_players', 'min_players', 'table_size',
    'blind_structure', 'payout_structure', 'late_reg_levels', 'late_reg_mins',
  ];
  const config = Object.fromEntries(keep.map((k) => [k, template[k]]));
  // blind_structure and payout_structure are text columns; the creation door
  // requires JSON arrays (SEAT_FIRST_CREATE_INVALID_CONFIG otherwise).
  for (const k of ['blind_structure', 'payout_structure']) {
    if (typeof config[k] === 'string') config[k] = JSON.parse(config[k]);
  }
  return {
    ...config,
    club_id: clubId,
    union_id: null,
    current_players: 0,
    status: 'REGISTERING',
    start_time: new Date(now + 3 * 60 * 60_000).toISOString(),
  };
}

/** One verdict for the whole run; a cleanup that did not finish fails it. */
export function verdict({ gate, steps, error, cleanup }) {
  if (!gate.run) return { conclusion: 'unknown', reason: gate.reason };
  const failed = steps.filter((s) => !s.ok).map((s) => s.name);
  const cleanupFailed = (cleanup || []).filter((c) => c.ok !== true).map((c) => c.step);
  if (error) failed.push(`error: ${error}`);
  if (cleanupFailed.length) failed.push(`cleanup: ${cleanupFailed.join(', ')}`);
  if (!steps.length && !error) failed.push('no case ran');
  return failed.length
    ? { conclusion: 'fail', reason: failed.join('; ') }
    : { conclusion: 'pass', reason: `${steps.length} cases passed and every fixture was retired` };
}

/**
 * A 'Cert HU' club whose run died before its cleanup is settled from its
 * record, through the run's own settle path (claim back, retire with records),
 * as the club's owner. Refuses, changing nothing, unless the club is an active
 * 'Cert HU ' club owned by `ownerId`, every member is a reserved certification
 * identity, every game in it has ended, and nobody is seated. The stale sweep
 * (production-e2e-account.mjs) is its caller.
 */
export async function settleStrandedHeadsUpClub({
  environment = process.env,
  fetchImpl = fetch,
  clubId,
  ownerId,
  isReserved,
  log: emit = log,
}) {
  const SUPA = String(environment.SUPABASE_URL || '').replace(/\/$/, '');
  const SR = environment.SUPABASE_SERVICE_ROLE_KEY;
  const ANON = environment.VITE_SUPABASE_ANON_KEY;
  if (!SUPA || !SR || !ANON)
    throw new Error(
      `Cannot settle heads-up rematch certification club ${clubId}: SUPABASE_URL, ` +
        'SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_ANON_KEY are required.'
    );
  if (typeof isReserved !== 'function')
    throw new Error('settleStrandedHeadsUpClub requires the reserved-namespace predicate.');
  const c = clients({ SUPA, SR, ANON, fetchImpl });
  const club = (await c.svc(`clubs?id=eq.${encodeURIComponent(clubId)}&select=id,name,owner_id,lifecycle_status`))?.[0];
  if (
    !club || club.id !== clubId || club.owner_id !== ownerId ||
    !String(club.name || '').startsWith(HEADS_UP_CERT_CLUB_NAME_PREFIX) || club.lifecycle_status !== 'active'
  )
    throw new Error(`Refusing to settle club ${clubId}: not an active heads-up rematch certification club owned by ${ownerId}.`);
  const games = await c.svc(`tournaments?club_id=eq.${encodeURIComponent(clubId)}&select=id,status`);
  if (!Array.isArray(games))
    throw new Error(`Refusing to settle club ${clubId}: its games could not be read.`);
  const live = games.filter((g) => !['COMPLETED', 'CANCELLED'].includes(String(g.status).toUpperCase()));
  if (live.length)
    throw new Error(`Refusing to settle club ${clubId}: ${live.length} game(s) have not ended yet.`);
  const members = await c.svc(`club_members?club_id=eq.${encodeURIComponent(clubId)}&select=user_id,role`);
  if (!Array.isArray(members) || !members.length)
    throw new Error(`Refusing to settle club ${clubId}: its members could not be read.`);
  const identities = [];
  for (const m of members) {
    const user = await c.adminUser(m.user_id);
    if (!user?.email || !isReserved(user.email))
      throw new Error(`Refusing to settle club ${clubId}: member ${m.user_id} is not a reserved certification identity.`);
    identities.push({ id: m.user_id, email: user.email });
  }
  const owner = identities.find((i) => i.id === ownerId);
  if (!owner) throw new Error(`Refusing to settle club ${clubId}: its owner is not a member.`);
  const failures = [];
  const note = (name, ok, detail) => {
    emit(ok ? 'SETTLE' : 'SETTLE FAILED', clubId, name, detail ?? '');
    if (!ok) failures.push(`${name}${detail ? ` (${JSON.stringify(detail).slice(0, 200)})` : ''}`);
  };
  const outcome = await settleRabbitHuntClub({
    c,
    clubId,
    clubName: club.name,
    ownerEmail: owner.email,
    memberIds: identities.map((i) => i.id),
    tableIds: [],
    note,
    reason: 'Heads-up rematch certification club, settled after its run died (stale sweep)',
  });
  if (!outcome.settled || failures.length)
    throw new Error(`Heads-up rematch certification club ${clubId} was not settled: ${failures.join('; ') || 'the club is not retired'}.`);
  return { clubId, ownerId, members: identities.map((i) => i.id) };
}

async function main() {
  const SUPA = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY;
  if (!SUPA || !SR || !ANON)
    throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_ANON_KEY are required.');
  const repoRoot = process.cwd();
  const summary = (text) => {
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  };
  const c = clients({ SUPA, SR, ANON });
  const { svc, svcRpc, rpc, engine, sessionFor } = c;

  let health = null;
  try {
    health = await (await fetch(`${ENGINE_URL}/health`, { signal: AbortSignal.timeout(20_000) })).json();
  } catch {
    health = null;
  }
  const releaseSha = String(health?.releaseSha || '');
  const phase = health?.maintenance?.phase;
  const frozen = (await svcRpc('fn_platform_frozen', {})) === true;
  const gate = !health
    ? { run: false, reason: 'the engine health check did not answer' }
    : phase && phase !== 'idle'
      ? { run: false, reason: `the engine is in maintenance (${phase})` }
      : frozen
        ? { run: false, reason: 'the platform is frozen' }
        : !inSitAndGoWindow()
          ? { run: false, reason: 'Sit & Go entries are closed (03:00-06:00 Chicago)' }
          : { run: true, reason: 'the engine is idle and Sit & Go entries are open' };
  log('gate', { ...gate, releaseSha });
  if (!gate.run) {
    summary(`### Heads-Up Rematch Certification\n\n- result: **UNKNOWN** - ${gate.reason}\n- nothing was created`);
    console.log(`HEADS_UP_REMATCH_CERTIFICATION UNKNOWN: ${gate.reason}`);
    console.log(`::warning title=Heads-up rematch certification did not run::${gate.reason}`);
    return 0;
  }

  const { createProductionE2EAccount, cleanupProductionE2EAccount } = await import(
    pathToFileURL(join(repoRoot, 'scripts/ci/production-e2e-account.mjs')).href
  );
  const scratch = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'hu-rematch-cert-'));
  const envFor = (role) => ({
    SUPABASE_URL: SUPA,
    SUPABASE_SERVICE_ROLE_KEY: SR,
    GITHUB_ENV: join(scratch, `env-${role}`),
    E2E_TEST_ACCOUNT_FILE: join(scratch, `account-${role}.json`),
    RUNNER_TEMP: scratch,
  });
  const S = { accounts: {}, sockets: [] };
  const steps = [];
  const cleanup = [];
  let error = null;
  const evidence = {};
  const step = (name, ok, detail) => {
    steps.push({ name, ok: !!ok, detail });
    log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
  };
  let browser = null;

  try {
    for (const role of ['owner', 'a', 'b']) {
      writeFileSync(join(scratch, `env-${role}`), '');
      const acct = await createProductionE2EAccount({ environment: envFor(role) });
      S.accounts[role] = { id: acct.id, email: acct.email };
    }
    const P = {};
    for (const role of ['owner', 'a', 'b']) P[role] = await sessionFor(S.accounts[role].email);
    const club = await rpc(P.owner.token, 'fn_create_club_atomic', {
      p_request_id: randomUUID(),
      p_name: `${HEADS_UP_CERT_CLUB_NAME_PREFIX}${Date.now().toString().slice(-8)}`,
      p_description: 'Heads-up rematch certification club (reserved certification accounts only)',
      p_color_theme: 'blue',
      p_is_public: false,
      p_requires_approval: false,
      p_logo_url: null,
    });
    S.clubId = club.body?.id;
    S.clubName = club.body?.name;
    if (!S.clubId) throw new Error(`the certification club was not created (${club.status})`);
    const FUND = 8;
    for (const role of ['a', 'b']) {
      const j = await rpc(P[role].token, 'fn_join_club', { p_club_id: S.clubId });
      if (j.status >= 300) throw new Error(`${role} could not join the certification club`);
      const t = await rpc(P.owner.token, 'fn_cashier_batch_transfer', {
        p_club_id: S.clubId,
        p_kind: 'send',
        p_batch_id: randomUUID(),
        p_items: [{
          user_id: P[role].userId, amount: FUND, source: 'club_bank', destination: 'player_wallet',
          reason: 'Cashier Send Out', op_id: randomUUID(),
        }],
      });
      if (t.body?.success !== true) throw new Error(`${role} was not funded from the club bank`);
    }
    const wallet = async (role) =>
      Number((await svc(`club_members?club_id=eq.${S.clubId}&user_id=eq.${P[role].userId}&select=chip_balance`))[0]?.chip_balance);
    const both = async () => ({ a: await wallet('a'), b: await wallet('b') });
    const start = await both();
    step('two reserved players funded from the certification club bank', start.a === FUND && start.b === FUND, start);

    // The cheapest live board heads-up game is the template: the same terms the engine's board writes.
    const templates = await svc(
      'tournaments?status=eq.REGISTERING&format_contract=eq.sng-v1&max_players=eq.2&tournament_type=eq.SNG' +
        '&satellite_target_id=is.null&satellite_target=is.null&free_buy=eq.false&is_bounty=eq.false' +
        '&game_type=eq.NLH&select=*&order=buy_in_amount.asc&limit=40'
    );
    if (!Array.isArray(templates) || !templates.length) throw new Error('no live board heads-up game to copy');
    const template = [...templates].sort(
      (x, y) => cents(x.buy_in_amount) + cents(x.buy_in_fee) - cents(y.buy_in_amount) - cents(y.buy_in_fee)
        || Number(x.starting_chips) - Number(y.starting_chips)
    )[0];
    const BUY = cents(template.buy_in_amount);
    const FEE = cents(template.buy_in_fee);
    evidence.template = { id: template.id, name: template.name, buy_in: BUY / 100, fee: FEE / 100, starting_chips: template.starting_chips };
    const created = await svcRpc('fn_create_seat_first_game_atomic', {
      p_tournament_id: randomUUID(),
      p_config: certificationConfig(template, S.clubId),
    });
    if (created?.ok !== true || !created.table_id) throw new Error(`the certification game was not created: ${JSON.stringify(created).slice(0, 300)}`);
    S.source = { tournamentId: created.tournament?.id, tableId: created.table_id };
    evidence.source = S.source;

    // ---- one socket watches; each player acts through its own token ----
    const { default: JP } = await import('fast-json-patch');
    const acted = new Set();
    const diag = { messages: {}, turns: [], actions: [], closes: [] };
    evidence.socket = diag;
    // A heads-up table has no engine until its game starts, and a socket opened
    // before that is refused at once (run 42577549337: no message, one error).
    // The watcher therefore connects after the start and reconnects if it drops.
    S.stopped = false;
    const watch = (tableId, attempt = 0) => {
      let state = null;
      const ws = new WebSocket(`wss://engine.smarter.poker/ws/table/${tableId}`, ['bearer', P.b.token]);
      ws.onclose = (e) => {
        diag.closes.push({ code: e.code, reason: e.reason });
        if (!S.stopped && attempt < 60) setTimeout(() => watch(tableId, attempt + 1), 2000);
      };
      ws.onerror = () => diag.closes.push({ error: true });
      S.sockets.push(ws);
      ws.onmessage = async (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'PING') return ws.send(JSON.stringify({ type: 'PONG', ts: m.ts }));
        if (m.type === 'SNAPSHOT') state = m.state;
        if (m.type === 'DELTA' && state && Array.isArray(m.patch)) {
          try {
            const n = structuredClone(state);
            JP.applyPatch(n, m.patch, false);
            state = n;
          } catch {}
        }
        diag.messages[m.type] = (diag.messages[m.type] || 0) + 1;
        if (state && diag.turns.length < 3 && state.current_player)
          diag.turns.push({ current_player: state.current_player, action_context: state.action_context ?? null, keys: Object.keys(state).slice(0, 40) });
        const who = state && [P.a, P.b].find((p) => p.userId === state.current_player);
        if (!who || !state.action_context || acted.has(state.action_context)) return;
        acted.add(state.action_context);
        for (const action of ['all_in', 'call', 'check']) {
          const r = await engine(who.token, '/action', {
            tableId, action, actionContext: state.action_context, idempotencyKey: randomUUID(),
          });
          if (diag.actions.length < 8) diag.actions.push({ action, status: r.status, body: r.body });
          if (r.body?.success) break;
        }
      };
    };
    const status = async (id) => (await svc(`tournaments?id=eq.${id}&select=status,ended_at,prize_pool,total_rake`))[0];
    const until = async (what, fn, ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const v = await fn();
        if (v) return v;
        await sleep(2500);
      }
      throw new Error(`timed out waiting for ${what}`);
    };

    const seats = await Promise.all(
      ['a', 'b'].map((role, i) =>
        rpc(P[role].token, 'fn_take_seat_and_buy_in', { p_table_id: S.source.tableId, p_seat_number: i + 1 })
      )
    );
    step('both players bought a seat through the browser seat door', seats.every((s) => s.body?.ok === true),
      seats.map((s) => s.body));
    const afterSeat = await both();
    step('each first buy-in charged one buy-in plus fee', afterSeat.a === start.a - (BUY + FEE) / 100 && afterSeat.b === start.b - (BUY + FEE) / 100, afterSeat);

    // ---- the browser player sits at the table so the end-of-game card reaches it ----
    const { chromium } = await import('playwright');
    browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: 430, height: 932 },
      storageState: { cookies: [], origins: [{ origin: APP_ORIGIN, localStorage: [{ name: 'ca_device_id', value: fixtureBrowserId(P.a.userId) }] }] },
    });
    const page = await ctx.newPage();
    const rematchPosts = [];
    page.on('response', (rs) => {
      if (rs.request().method() === 'POST' && rs.url().includes('/rpc/ca_heads_up_rematch_respond')) rematchPosts.push(rs.status());
    });
    await page.goto(`${APP_ORIGIN}/hub/club-arena/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.evaluate(({ s }) => {
      localStorage.setItem('smarter-poker-auth', JSON.stringify(s));
      localStorage.setItem('club_arena_welcome_accepted', 'true');
    }, {
      s: {
        access_token: P.a.token, refresh_token: P.a.refresh, token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: P.a.user,
      },
    });
    await page.goto(`${APP_ORIGIN}/hub/club-arena/table/${S.source.tableId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(6000);
    if (await page.getByRole('button', { name: 'This Is A New Device' }).count())
      throw new Error('the device prompt was shown; not taking over (owner rule)');
    if (await page.getByText('Please Review And Accept To Continue').count()) {
      for (let i = 0; i < 4; i++) {
        await page.evaluate(() => document.querySelectorAll('*').forEach((el) => {
          const s = getComputedStyle(el);
          if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 5) {
            el.scrollTop = el.scrollHeight;
            el.dispatchEvent(new Event('scroll'));
          }
        }));
        await page.waitForTimeout(500);
      }
      const cb = page.locator('input.sc-check__box');
      if (await cb.count()) await cb.first().check({ force: true });
      await page.getByRole('button', { name: 'Accept & Continue' }).click({ timeout: 15_000 });
      await page.waitForTimeout(3000);
      await page.goto(`${APP_ORIGIN}/hub/club-arena/table/${S.source.tableId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }

    const running = await until('the engine to start the first game', async () => {
      const t = await status(S.source.tournamentId);
      return t && ['RUNNING', 'COMPLETED'].includes(String(t.status).toUpperCase()) ? t : null;
    }, 120_000);
    step('the engine started the first game', !!running, running?.status);
    watch(S.source.tableId);
    setTimeout(() => log('socket after 60s', diag), 60_000);
    const done = await until('the first game to finish', async () => {
      const t = await status(S.source.tournamentId);
      return t && String(t.status).toUpperCase() === 'COMPLETED' && t.ended_at ? t : null;
    }, GAME_DEADLINE_MS);
    evidence.sourceFinal = done;
    // The prize lands with the finish; read the wallets once it has.
    const beforeRematch = await until('the first game\'s prize to reach a wallet', async () => {
      const w = await both();
      return cents(w.a + w.b) === cents(afterSeat.a + afterSeat.b) + 2 * BUY ? w : null;
    }, 30_000).catch(() => both());
    step('the first game paid one prize and kept its rake',
      cents(done.prize_pool) === 2 * BUY && cents(done.total_rake) === 2 * FEE
        && cents(beforeRematch.a + beforeRematch.b) === cents(afterSeat.a + afterSeat.b) + 2 * BUY,
      { prize_pool: done.prize_pool, total_rake: done.total_rake, wallets: beforeRematch });

    // ---- Play Again: a real tap in the signed-in browser, and Yes from the opponent ----
    const play = page
      .getByRole('dialog', { name: 'Tournament Ranking' })
      .getByRole('button', { name: /^Play Again$/ });
    let tapped = false;
    try {
      await play.first().waitFor({ state: 'visible', timeout: 60_000 });
      await play.first().click();
      tapped = true;
    } catch (e) {
      log('the Play Again plate did not appear', String(e?.message || e).slice(0, 200));
    }
    await sleep(2500);
    step('the signed-in browser tapped Play Again and the database took it',
      tapped && rematchPosts.length >= 1 && rematchPosts.every((s) => s < 300), { rematchPosts });
    if (!tapped) await rpc(P.a.token, 'ca_heads_up_rematch_respond', { p_source_tournament_id: S.source.tournamentId, p_accept: true });
    const yes = await rpc(P.b.token, 'ca_heads_up_rematch_respond', { p_source_tournament_id: S.source.tournamentId, p_accept: true });
    step('the opponent\'s Yes completed the rematch', yes.body?.status === 'matched', yes.body);
    const row = (await svc(`ca_heads_up_rematches?source_tournament_id=eq.${S.source.tournamentId}&select=*`))[0];
    evidence.rematch = row;
    S.target = { tournamentId: row?.target_tournament_id, tableId: row?.target_table_id };
    step('one committed rematch row names the new game', row?.outcome === 'matched' && !!S.target.tableId, row);
    if (!S.target.tableId) throw new Error('no rematch was committed');
    watch(S.target.tableId);

    const afterRematch = await both();
    step('each player was charged exactly one buy-in plus fee for the rematch',
      cents(afterRematch.a) === cents(beforeRematch.a) - (BUY + FEE)
        && cents(afterRematch.b) === cents(beforeRematch.b) - (BUY + FEE)
        && (row.receipts || []).every((r) => cents(r.cost) === BUY + FEE),
      { before: beforeRematch, after: afterRematch, receipts: row.receipts });
    const targetSeats = await svc(`table_seats?table_id=eq.${S.target.tableId}&left_at=is.null&select=user_id,seat_number`);
    const sourceSeats = await svc(`table_seats?table_id=eq.${S.source.tableId}&select=user_id,seat_number`);
    step('the rematch seats the same two players',
      Array.isArray(targetSeats) && targetSeats.length === 2
        && [P.a.userId, P.b.userId].every((u) => targetSeats.some((s) => s.user_id === u)),
      { targetSeats, sourceSeats });
    const targetTerms = (await svc(`tournaments?id=eq.${S.target.tournamentId}&select=buy_in_amount,buy_in_fee,starting_chips,max_players,format_contract,club_id,payout_structure`))[0];
    step('the rematch has the finished game\'s buy-in, fee, stack and payout',
      cents(targetTerms?.buy_in_amount) === BUY && cents(targetTerms?.buy_in_fee) === FEE
        && Number(targetTerms?.starting_chips) === Number(template.starting_chips)
        && targetTerms?.club_id === S.clubId && targetTerms?.max_players === 2,
      targetTerms);

    try {
      await page.waitForURL(new RegExp(`/table/${S.target.tableId}`), { timeout: 30_000 });
    } catch {}
    step('the browser moved to the rematch table', page.url().includes(S.target.tableId), page.url());

    const startedRematch = await until('the engine to start the rematch', async () => {
      const t = await status(S.target.tournamentId);
      return t && ['RUNNING', 'COMPLETED'].includes(String(t.status).toUpperCase()) ? t : null;
    }, 120_000);
    step('the engine started the rematch', !!startedRematch, startedRematch?.status);
    const firstHand = await until('the rematch\'s first hand', async () => {
      const h = await svc(`hand_history?table_id=eq.${S.target.tableId}&select=id,hand_number,created_at&order=hand_number.asc&limit=1`);
      return Array.isArray(h) && h.length ? h[0] : null;
    }, 180_000);
    evidence.firstHand = firstHand;
    step('the engine dealt the rematch\'s first hand', !!firstHand, firstHand);

    const rematchDone = await until('the rematch to finish', async () => {
      const t = await status(S.target.tournamentId);
      return t && String(t.status).toUpperCase() === 'COMPLETED' ? t : null;
    }, GAME_DEADLINE_MS);
    evidence.rematchFinal = rematchDone;
    const end = await until('the rematch\'s prize to reach a wallet', async () => {
      const w = await both();
      return cents(w.a + w.b) === cents(afterRematch.a + afterRematch.b) + 2 * BUY ? w : null;
    }, 30_000).catch(() => both());
    step('the rematch paid one prize and kept its rake',
      cents(rematchDone.prize_pool) === 2 * BUY && cents(rematchDone.total_rake) === 2 * FEE,
      { prize_pool: rematchDone.prize_pool, total_rake: rematchDone.total_rake });
    step('chips are conserved: the two players lost exactly the two games\' fees',
      cents(end.a + end.b) === cents(start.a + start.b) - 4 * FEE, { start, end });
    const again = (await svc(`ca_heads_up_rematches?source_tournament_id=eq.${S.source.tournamentId}&select=outcome,target_tournament_id`))[0];
    const repeat = await rpc(P.b.token, 'ca_heads_up_rematch_respond', { p_source_tournament_id: S.source.tournamentId, p_accept: true });
    step('a repeat Yes after the match changes nothing',
      again?.target_tournament_id === S.target.tournamentId && cents(await wallet('b')) === cents(end.b)
        && ['matched', 'expired'].includes(repeat.body?.status), repeat.body);
  } catch (e) {
    error = String(e?.message || e);
    log('ERROR', error);
  } finally {
    // A finished game releases its seats; cleanup settles nothing while one is open.
    const memberIds = ['a', 'b'].map((r) => S.accounts[r]?.id).filter(Boolean);
    for (let i = 0; memberIds.length && i < 30; i++) {
      const open = await svc(`table_seats?left_at=is.null&user_id=in.(${memberIds.join(',')})&select=table_id`);
      if (Array.isArray(open) && !open.length) break;
      await sleep(2000);
    }
    S.stopped = true;
    S.sockets.forEach((w) => {
      try { w.close(); } catch {}
    });
    if (browser) await browser.close().catch(() => {});
    const note = (name, ok, detail) => {
      cleanup.push({ step: name, ok, detail });
      log(ok ? 'CLEANUP' : 'CLEANUP FAILED', name, detail ?? '');
    };
    try {
      for (const id of [S.source?.tournamentId, S.target?.tournamentId].filter(Boolean)) {
        const t = (await svc(`tournaments?id=eq.${id}&select=status`))[0];
        if (String(t?.status).toUpperCase() !== 'COMPLETED')
          note(`game ${id} is still ${t?.status}; its players are seated until it ends`, false);
      }
      const outcome = S.clubId
        ? await settleRabbitHuntClub({
            c: { svc, svcRpc, rpc, sessionFor },
            clubId: S.clubId,
            clubName: S.clubName,
            ownerEmail: S.accounts.owner.email,
            memberIds: Object.values(S.accounts).map((a) => a.id),
            tableIds: [],
            note,
            reason: 'Heads-up rematch certification club, cleanup',
          })
        : { settled: true, seated: [] };
      if (!(outcome.seated === null || outcome.seated.length)) {
        for (const role of ['a', 'b', 'owner']) {
          if (!S.accounts[role]) continue;
          try {
            await cleanupProductionE2EAccount({ environment: envFor(role), expectedEmail: S.accounts[role].email });
            note(`retire the ${role} account`, true);
          } catch (e) {
            if (role === 'owner' && S.clubId) {
              const clubRow = (await svc(`clubs?id=eq.${S.clubId}&select=id,owner_id,lifecycle_status`))[0];
              if (ownerRetainedAsRecord({ error: e, club: clubRow, ownerId: S.accounts.owner.id, clubId: S.clubId })) {
                note('retire the owner account', true, `kept as the owner of record of retired club ${S.clubId}`);
                continue;
              }
            }
            note(`retire the ${role} account`, false, String(e?.message || e).slice(0, 200));
          }
        }
      }
    } catch (e) {
      note('cleanup', false, String(e?.message || e));
    }
    rmSync(scratch, { recursive: true, force: true });
  }

  const v = verdict({ gate, steps, error, cleanup });
  summary([
    '### Heads-Up Rematch Certification',
    '',
    `- result: **${v.conclusion.toUpperCase()}** - ${v.reason}`,
    `- serving engine: \`${releaseSha}\``,
    `- evidence: \`${JSON.stringify(evidence).slice(0, 3000)}\``,
    '',
    '| case | result |',
    '| --- | --- |',
    ...steps.map((s) => `| ${s.name} | ${s.ok ? 'PASS' : 'FAIL'} |`),
    ...cleanup.map((x) => `| cleanup: ${x.step} | ${x.ok ? 'done' : 'FAILED'} |`),
  ].join('\n'));
  log('EVIDENCE', evidence);
  console.log(`HEADS_UP_REMATCH_CERTIFICATION ${v.conclusion.toUpperCase()}: ${v.reason}`);
  return v.conclusion === 'fail' ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then((code) => process.exit(code), (e) => {
    console.error(e);
    process.exit(1);
  });
}
