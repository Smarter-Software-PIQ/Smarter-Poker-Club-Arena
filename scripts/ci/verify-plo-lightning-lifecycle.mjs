/** One explicitly dispatched production witness for the assigned empty game.
 * No release action, repair, population control or recurring worker lives here.
 * Funding/consent/admission/leave use existing maintained certification owners.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { createProductionE2EAccount, prepareProductionE2EStaffMembership, cleanupProductionE2EAccount } from './production-e2e-account.mjs';
import { clients, fixtureBrowserId } from './certify-rabbit-hunt.mjs';
import { gameplayHasResumed, msUntilNextAnnouncement } from './await-engine-gameplay.mjs';

export const GAME = 'c79d8ec2-2281-411d-b4e1-42b5610849e2';
export const HOUSE = 'fade0000-0000-0000-0000-000000000001';
const ENGINE = 'https://engine.smarter.poker';
const APP = 'https://smarter.poker/hub/club-arena';
const BUY_IN = 400;
const POST_LEAVE_MS = 8 * 60_000; // covers the incident's six-minute departure burst

export function admitPayload(payload) {
  assert(payload && Object.keys(payload).length === 1 && /^[0-9a-f]{40}$/.test(payload.engine_sha ?? ''), 'One exact engine_sha and no other input is required');
  return payload.engine_sha;
}
export function requireBatch(result, player, amount) {
  assert(result.status >= 200 && result.status < 300, 'Cashier request has no successful HTTP verdict');
  const b = result.body;
  assert(b?.success === true && b.processed === 1 && b.results?.length === 1 && b.results[0].user_id === player && b.results[0].success === true, 'The owned funding item did not commit successfully');
  assert(Number.isFinite(amount) && amount > 0 && amount <= BUY_IN, 'Funding budget refused');
}
export function requireFundingClub(club, link) {
  assert(club?.id && club.id !== HOUSE && club.asset === 'chips' && club.status === 'active' &&
    club.union_id === HOUSE && link?.club_id === club.id && link.union_id === HOUSE,
    'The designated funding wallet must belong to an active member club of this union');
  return club.id;
}
export function requireFeederAdmission(result) {
  assert(result.status >= 200 && result.status < 300 && result.body?.ok === true &&
    result.body.action === 'seat' && /^[0-9a-f-]{36}$/.test(result.body.table_id ?? ''),
    `Ordinary feeder admission refused: ${result.body?.message ?? result.body?.reason ?? result.body?.action ?? result.status}`);
}
export function receiptMatches(receipt, p) {
  const r = receipt?.request;
  return receipt?.status === 'confirmed' && r?.door === 'atomic_table_buyin' &&
    r.user_id === p.p_user_id && r.table_id === p.p_table_id && r.seat_number === p.p_seat_number &&
    r.amount === p.p_amount && r.auto_rebuy === p.p_auto_rebuy && r.club_id === p.p_club_id;
}
export function requireHealth(h, sha, instance) {
  assert(typeof h.instanceId === 'string' && h.instanceId.length > 0 && h.releaseSha === sha && (!instance || h.instanceId === instance), 'Serving engine changed; proof is UNKNOWN');
  assert(h.liveness === 'ok' && h.maintenance?.phase === 'idle' && h.maintenance?.active === false, 'Engine is not idle and ready');
  assert(gameplayHasResumed(JSON.stringify(h), sha), 'Thaw is incomplete');
}
// In feeder mode Join Game assigns/navigates to the ordinary table. The
// spectator still takes an open chair before the original purchase sheet opens.
export async function openFeederBuyIn(page) {
  await page.waitForURL((url) => /\/table\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 60_000 });
  const dialog = page.getByRole('dialog', { name: 'Buy-In', exact: true });
  const slider = dialog.getByRole('slider', { name: 'Buy-In Amount', exact: true });
  if (!(await slider.isVisible())) {
    await page
      .getByRole('button', { name: /^Seat [1-6]: Open - Click To Sit$/ })
      .first()
      .click({ timeout: 60_000 });
  }
  await slider.waitFor({ state: 'visible', timeout: 60_000 });
  return { dialog, slider };
}
export function summarizeHands(rows, player) {
  return rows.map(({ id, table_id, hand_number, started_at, ended_at, players }) => ({
    id, tableId: table_id, handNumber: hand_number, startedAt: started_at, endedAt: ended_at,
    playerCount: Array.isArray(players) ? players.length : 0,
    includesTestPlayer: Array.isArray(players) && players.some(p => p.userId === player),
  })); // never retain cards or opponent private data
}

export async function main(environment = process.env) {
  const sha = admitPayload(JSON.parse(environment.PLO_LIGHTNING_PROOF_PAYLOAD ?? 'null'));
  assert(environment.GITHUB_EVENT_NAME === 'repository_dispatch' && environment.GITHUB_REF === 'refs/heads/main', 'Protected explicit dispatch required');
  assert(environment.GITHUB_EVENT_ACTION === 'run-plo-lightning-lifecycle-proof', 'Proof event refused');
  execFileSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { stdio: 'pipe' });
  const runtime = execFileSync('git', ['show', `${sha}:server/src/services/HorseUnionCashPlan.ts`], { encoding: 'utf8' });
  assert(runtime.includes("existingSeat && gameId === 'c79d8ec2-2281-411d-b4e1-42b5610849e2'"), 'Selected engine does not contain the scoped retention fix');
  const out = join(environment.RUNNER_TEMP, 'plo-lightning-proof');
  mkdirSync(out, { recursive: true });
  const report = { status: 'unknown', engineSha: sha, gameId: GAME, milestones: {}, admissions: [], samples: [], cleanup: {}, accounts: {} };
  const save = () => writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2));
  const fetchImpl = (url, init = {}) => fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(20_000) });
  const c = clients({ SUPA: environment.SUPABASE_URL, SR: environment.SUPABASE_SERVICE_ROLE_KEY, ANON: environment.VITE_SUPABASE_ANON_KEY, fetchImpl });
  const read = async path => {
    const r = await fetchImpl(`${environment.SUPABASE_URL}/rest/v1/${path}`, { headers: { ...c.H, Prefer: 'count=exact', Range: '0-999' } });
    assert(r.ok, `Read unavailable (${r.status}); proof is UNKNOWN`);
    const rows = await r.json();
    const total = /\/(\d+)$/.exec(r.headers.get('content-range') ?? '');
    assert(Array.isArray(rows) && total && Number(total[1]) === rows.length, 'Read is incomplete; proof is UNKNOWN');
    return rows;
  };
  const health = async () => {
    const r = await fetchImpl(`${ENGINE}/health?proof=${Date.now()}`);
    assert(r.ok, 'Engine identity is unavailable');
    return r.json();
  };
  const one = async path => { const rows = await read(path); assert(rows.length === 1, 'Exactly one owned row required'); return rows[0]; };
  const gameRead = () => one(`cash_games?id=eq.${GAME}&select=id,club_id,variant,sb,bb,handedness,enabled,lightning_enabled,cluster_mode,ruleset_snapshot`);
  const census = async () => {
    const tables = await read(`tables?cluster_id=eq.${GAME}&and=(or(lifecycle.neq.closed,lifecycle.is.null),or(is_deleted.eq.false,is_deleted.is.null))&select=id,role,lifecycle,auto_start_players,min_buy_in,max_buy_in`);
    assert(tables.length > 0, 'Target has no supported tables');
    const ids = tables.map(t => t.id).join(',');
    const seats = await read(`table_seats?table_id=in.(${ids})&left_at=is.null&select=id,table_id,user_id,seat_number,occupancy_id,joined_at,stack,is_sitting_out,leave_pending`);
    const pools = await read(`lightning_pool_session?cluster_id=eq.${GAME}&exited_at=is.null&select=id,player_id,stop_requested_at,state`);
    const users = [...new Set([...seats.map(s => s.user_id), ...pools.map(s => s.player_id)])];
    const profiles = users.length ? await read(`profiles?id=in.(${users.join(',')})&select=id,is_horse`) : [];
    assert(profiles.length === users.length, 'Participant identity read incomplete');
    return { tables, ids, seats, pools, profiles };
  };
  const initial = await health();
  requireHealth(initial, sha);
  assert(msUntilNextAnnouncement(Date.now(), initial.maintenance.schedule) > 40 * 60_000, 'Not enough normal play before maintenance');
  const game = await gameRead();
  const cfg = game.ruleset_snapshot?.lightning;
  assert(game.club_id === HOUSE && game.variant === 'plo4' && Number(game.sb) === 1 && Number(game.bb) === 2 && game.handedness === 6 && game.enabled && game.lightning_enabled, 'Fixed target identity refused');
  assert(cfg?.always_on === false && cfg.on_threshold === 10 && cfg.off_threshold === 4 && game.cluster_mode === 'must_move', 'Installed target must be an empty population-driven feeder');
  const baseline = await census();
  assert(!baseline.seats.length && !baseline.pools.length, 'Game is already populated; no account or charge created');
  assert(baseline.tables.every(t => t.auto_start_players === 2 && Number(t.min_buy_in) <= BUY_IN && Number(t.max_buy_in) >= BUY_IN), 'Physical heads-up/buy-in projection refused');
  report.instanceId = initial.instanceId;
  report.startingPopulation = 0;
  save();

  let player, cashier, P, C, browser, page, intent, fundingClub;
  let financialUnknown = false;
  const roleEnv = role => ({ ...environment, RUNNER_TEMP: out, E2E_CLUB_ID: fundingClub, E2E_TEST_ACCOUNT_FILE: join(out, `${role}-account.private.json`), GITHUB_ENV: join(out, `${role}.private.env`) });
  const wallet = async id => Number((await one(`club_members?club_id=eq.${fundingClub}&user_id=eq.${id}&select=chip_balance`)).chip_balance);
  const assertOnlyOwnedHuman = state => assert(state.profiles.every(p => p.is_horse === true || p.id === player?.id), 'Another real player arrived; stop the owned proof');
  const act = async () => {
    for (const label of ['Check', 'Fold']) {
      const buttons = page.getByRole('button', { name: label, exact: true });
      for (const b of await buttons.all()) if (await b.isVisible() && await b.isEnabled()) { await b.click({ timeout: 2000 }); return; }
    }
  };
  const ownSeats = () => read(`table_seats?user_id=eq.${player.id}&left_at=is.null&select=id,table_id,seat_number,occupancy_id,stack`);
  const leave = async () => {
    const pools = await read(`lightning_pool_session?cluster_id=eq.${GAME}&player_id=eq.${player.id}&exited_at=is.null&select=id,stop_requested_at`);
    if (pools.length) {
      await c.rpc(P.token, 'fn_lightning_stop_playing', { p_cluster_id: GAME });
      const stopped = await read(`lightning_pool_session?cluster_id=eq.${GAME}&player_id=eq.${player.id}&select=id,stop_requested_at,exited_at`);
      assert(stopped.every(s => s.stop_requested_at || s.exited_at), 'Stop Playing has no durable confirmation');
      report.stopRequestedAt = stopped.find(s => s.stop_requested_at)?.stop_requested_at;
    }
    const deadline = Date.now() + 8 * 60_000;
    let requested = new Set();
    while (Date.now() < deadline) {
      const seats = await ownSeats();
      if (!seats.length) return;
      assert(seats.length === 1 && seats[0].occupancy_id, 'Owned occupancy is not uniquely known');
      const s = seats[0];
      if (!requested.has(s.occupancy_id)) {
        const r = await c.engine(P.token, '/leave-occupancy', { tableId: s.table_id, seatNumber: s.seat_number, occupancyId: s.occupancy_id });
        if (r.status >= 200 && r.status < 300 && r.body?.success === true) requested.add(s.occupancy_id);
        else if (r.body?.code === 'LEAVE_LOCKED') {
          if (r.body.needs_confirmation === true) {
            // Existing voluntary Leave confirmation: blind off owed hands,
            // never force, waive or alter the hand-count obligation.
            const confirmed = await c.engine(P.token, '/leave-occupancy', { tableId:s.table_id, seatNumber:s.seat_number, occupancyId:s.occupancy_id, confirmHandCount:true });
            assert(confirmed.status === 200 && confirmed.body?.success === true, 'Normal hand-count leave confirmation was not accepted');
            requested.add(s.occupancy_id); report.handCountLeaveConfirmed=true;
          } else await act();
        }
        else throw new Error('Owned leave has an unknown/refused outcome; preserve its identity');
      }
      await sleep(1000);
    }
    throw new Error('Owned leave did not settle within its bounded normal-hand budget');
  };
  try {
    // Existing account owner writes credentials only to its private runner files.
    player = await createProductionE2EAccount({ environment: roleEnv('player'), fetchImpl });
    cashier = await createProductionE2EAccount({ environment: roleEnv('cashier'), fetchImpl });
    report.accounts = { player: player.id, cashier: cashier.id };
    // The maintained fixture's default member club owns the player wallet.
    // The union's own bank is not an eligible member-club wallet for play.
    const membership = await prepareProductionE2EStaffMembership({ environment: roleEnv('player'), fetchImpl, memberRole: 'player' });
    fundingClub = membership.club_id;
    requireFundingClub(
      await one(`clubs?id=eq.${fundingClub}&select=id,union_id,asset,status`),
      await one(`union_clubs?club_id=eq.${fundingClub}&union_id=eq.${HOUSE}&select=club_id,union_id`)
    );
    report.fundingClubId = fundingClub; save();
    await prepareProductionE2EStaffMembership({ environment: roleEnv('cashier'), fetchImpl, memberRole: 'admin' });
    P = await c.sessionFor(player.email); C = await c.sessionFor(cashier.email);
    assert(P.userId === player.id && C.userId === cashier.id, 'Reserved session identity mismatch');
    const { chromium } = await import('@playwright/test');
    const { ensureAcceptedTerms } = await import('../../tests/e2e/support/ensureAcceptedTerms.ts');
    const { AI_OPPONENTS_DISCLOSURE } = await import('../../src/components/legal/aiOpponentsDisclosure.ts');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const auth = { access_token: P.token, refresh_token: P.refresh, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user: P.user };
    await context.addInitScript(({ auth, device }) => { localStorage.setItem('smarter-poker-auth', JSON.stringify(auth)); localStorage.setItem('club_arena_welcome_accepted','true'); localStorage.setItem('ca_device_id',device); }, { auth, device: fixtureBrowserId(player.id) });
    page = await context.newPage();
    await page.goto(`${APP}/lightning/${GAME}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const disclosure = page.getByText(AI_OPPONENTS_DISCLOSURE, { exact: true });
    await disclosure.waitFor({ state: 'visible', timeout: 60_000 });
    await disclosure.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, 'pre-play-ai-disclosure.png') });
    await ensureAcceptedTerms(page);
    report.aiDisclosureVisible = true;
    const fresh = await census(); assertOnlyOwnedHuman(fresh);
    assert(!fresh.seats.length && !fresh.pools.length, 'Baseline changed before funding');
    requireHealth(await health(), sha, initial.instanceId);
    const funding = { batchId: randomUUID(), opId: randomUUID(), amount: BUY_IN };
    report.funding = funding; save(); financialUnknown = true;
    const funded = await c.rpc(C.token, 'fn_cashier_batch_transfer', { p_club_id: fundingClub, p_kind: 'send', p_batch_id: funding.batchId, p_items: [{ user_id: player.id, amount: BUY_IN, source: 'club_bank', destination: 'player_wallet', reason: 'Cashier Send Out', op_id: funding.opId }] });
    requireBatch(funded, player.id, BUY_IN);
    report.funding.confirmed = true; save();
    financialUnknown = false;
    assert(await wallet(player.id) === BUY_IN, 'Funded wallet readback differs');
    // The published client owns the journal and one normal buy-in click.
    page.on('request', r => {
      if (new URL(r.url()).pathname === '/rest/v1/rpc/atomic_table_buyin') {
        const p = r.postDataJSON();
        if (!intent) { intent = p; report.buyInIntent = p; save(); }
        else if (JSON.stringify(p) !== JSON.stringify(intent)) report.unexpectedBuyInIntent = true;
      }
    });
    const admissionResponse = page.waitForResponse(r =>
      r.request().method() === 'POST' && new URL(r.url()).pathname === '/rest/v1/rpc/fn_cash_game_join',
      { timeout: 60_000 });
    await page.getByRole('button', { name: 'Join Game', exact: true }).click({ timeout: 60_000 });
    const admission = await admissionResponse;
    const admissionBody = await admission.json();
    report.joinAdmission = { status: admission.status(), action: admissionBody?.action,
      tableId: admissionBody?.table_id, code: admissionBody?.code, message: admissionBody?.message };
    save();
    requireFeederAdmission({ status: admission.status(), body: admissionBody });
    const { dialog, slider } = await openFeederBuyIn(page);
    assert(Number(await slider.getAttribute('max')) === BUY_IN, 'Owned funding must match the supported maximum buy-in');
    await slider.focus();
    await slider.press('End');
    assert(Number(await slider.inputValue()) === BUY_IN, 'Normal buy-in slider did not select the bounded amount');
    financialUnknown = true; // the click may commit before transport reports its result
    await dialog.getByRole('button', { name: 'Buy Chips', exact: true }).click();
    const seatDeadline = Date.now() + 90_000;
    let entered;
    while (Date.now() < seatDeadline) { const s = await ownSeats(); if (s.length === 1) { entered = s[0]; break; } await sleep(1000); }
    assert(intent && !report.unexpectedBuyInIntent && intent.p_user_id === player.id && intent.p_amount === BUY_IN && intent.p_auto_rebuy === false, 'One owned bounded buy-in intent required');
    const receipt = await c.rpc(P.token, 'fn_ca_cash_buyin_receipt', { p_idempotency_key: intent.p_idempotency_key, p_table_id: intent.p_table_id });
    assert(receipt.status === 200 && receiptMatches(receipt.body, intent), 'Buy-in outcome remains unknown; never send a fresh purchase');
    financialUnknown = false;
    assert(entered && entered.table_id === intent.p_table_id && entered.occupancy_id, 'Owned committed occupancy required');
    const sessions = await read(`cash_player_session?player_id=eq.${player.id}&cluster_id=eq.${GAME}&select=id,opened_at,closed_at,final_stack,financial_capture_status`);
    assert(sessions.length === 1 && !sessions[0].closed_at, 'Exactly one initial cash session required');
    const t0 = Date.parse(sessions[0].opened_at);
    report.milestones.initialSeat = sessions[0].opened_at;
    report.cashSessionId = sessions[0].id;
    const seen = new Set();
    let firstLightning;
    while (Date.now() < t0 + 16 * 60_000) {
      requireHealth(await health(), sha, initial.instanceId);
      const state = await census(); assertOnlyOwnedHuman(state);
      assert(!report.unexpectedBuyInIntent, 'Client created another buy-in intent');
      const byId = new Map(state.profiles.map(p => [p.id,p]));
      for (const s of [...state.seats].sort((a,b) => Date.parse(a.joined_at)-Date.parse(b.joined_at))) {
        if (!byId.get(s.user_id)?.is_horse || seen.has(s.user_id)) continue;
        seen.add(s.user_id); report.admissions.push({ playerId: s.user_id, at: s.joined_at });
      }
      const g = await gameRead();
      if (g.cluster_mode === 'must_move' && state.profiles.length >= 3 && state.tables.some(t=>t.role==='feeder' && state.seats.some(s=>s.table_id===t.id))) {
        report.milestones.feederGrowth ??= new Date().toISOString();
      }
      const hands = summarizeHands(await read(`hand_history?table_id=in.(${state.ids})&started_at=gte.${encodeURIComponent(sessions[0].opened_at)}&order=started_at.asc&select=id,table_id,hand_number,started_at,ended_at,players`), player.id);
      const hu = hands.find(h => h.playerCount === 2 && h.includesTestPlayer && h.endedAt);
      if (hu && !report.headsUpHand) { report.headsUpHand = hu; report.milestones.headsUp = hu.startedAt; await page.screenshot({ path: join(out,'heads-up.png') }); }
      const lh = await read(`lightning_hand?cluster_id=eq.${GAME}&formed_at=gte.${encodeURIComponent(sessions[0].opened_at)}&order=formed_at.asc&select=hand_id,formed_at,settled_at,hand_number,host_table_id,player_count`);
      report.samples.push({ at: new Date().toISOString(), mode: g.cluster_mode, tables: state.tables.map(t=>({id:t.id,role:t.role,lifecycle:t.lifecycle})), participants: state.profiles.length, horses: state.profiles.filter(p=>p.is_horse).length });
      if (state.profiles.length >= 10 && !report.milestones.tenParticipants) report.milestones.tenParticipants = new Date().toISOString();
      firstLightning = lh.find(h => h.settled_at && h.player_count >= 5);
      if (firstLightning) {
        // Conversion and reanchoring create successor seat representations.
        // Preserve the original funded admission timestamp for each identity.
        const originalSeats = await read(`table_seats?table_id=in.(${state.ids})&user_id=in.(${report.admissions.map(a=>a.playerId).join(',')})&joined_at=gte.${encodeURIComponent(sessions[0].opened_at)}&order=joined_at.asc&select=user_id,joined_at`);
        for (const a of report.admissions) {
          const original = originalSeats.find(s=>s.user_id===a.playerId);
          assert(original, 'Original funded admission timestamp is unavailable');
          a.at=original.joined_at;
        }
        report.admissions.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
        report.firstLightningHand = firstLightning;
        report.milestones.lightning = firstLightning.formed_at;
        assert(report.milestones.feederGrowth, 'Growing supported feeder was not observed');
        assert(report.headsUpHand && Date.parse(report.headsUpHand.startedAt) < Date.parse(firstLightning.formed_at), 'Heads-up play was not observed before Lightning');
        const elapsed = Date.parse(firstLightning.formed_at)-t0;
        assert(elapsed >= 5*60_000 && elapsed <= 15*60_000, 'Measured startup is outside the assigned 5–15 minute target');
        const conversions = await read(`cash_cluster_conversion?cluster_id=eq.${GAME}&opened_at=gte.${encodeURIComponent(sessions[0].opened_at)}&status=eq.committed&select=id,to_mode,trigger_population,closed_at`);
        assert(conversions.some(x=>x.to_mode==='lightning' && x.trigger_population===10), 'Exact ten-player conversion receipt missing');
        report.conversions = conversions;
        assert(report.admissions.length >= 9 && report.samples.every(x=>x.horses === undefined || x.horses <= 9), 'Automated population overshot the nine ready opponents required by this owned human');
        for (let n=1;n<report.admissions.length;n++) assert(Date.parse(report.admissions[n].at)-Date.parse(report.admissions[n-1].at)>=60_000, 'Automated admission burst observed');
        await page.screenshot({ path: join(out,'lightning.png') });
        break;
      }
      save();
      // Ordinary visible player controls only; the application owns transport,
      // heartbeat, context/idempotency and the physical-to-pool transition.
      for (let n=0;n<5;n++) { await act(); await sleep(1000); }
    }
    assert(firstLightning, 'No qualifying Lightning hand within the bounded startup');
    await leave();
    const closed = await one(`cash_player_session?id=eq.${report.cashSessionId}&select=id,closed_at,final_stack,financial_capture_status`);
    assert(closed.closed_at && closed.financial_capture_status === 'exact', 'Owned departure has no exact closed cash receipt');
    report.milestones.humanExit = closed.closed_at; report.cashOut = closed;
    await page.screenshot({ path: join(out,'human-left.png') });
    const afterDeadline = Date.now()+POST_LEAVE_MS;
    while (Date.now()<afterDeadline) {
      requireHealth(await health(),sha,initial.instanceId);
      const state=await census(); assertOnlyOwnedHuman(state);
      assert(!state.seats.some(s=>s.user_id===player.id) && !state.pools.some(s=>s.player_id===player.id),'Owned human was redealt after leaving');
      report.samples.push({at:new Date().toISOString(),afterHumanExit:true,participants:state.profiles.length});
      await sleep(5000);
    }
    const continued=await read(`lightning_hand?cluster_id=eq.${GAME}&formed_at=gt.${encodeURIComponent(closed.closed_at)}&settled_at=not.is.null&select=hand_id,formed_at,settled_at,hand_number,host_table_id,player_count`);
    assert(continued.length>=3,'Remaining participants did not continue valid Lightning hands');
    const late=continued.filter(h=>Date.parse(h.formed_at)>=Date.parse(closed.closed_at)+6*60_000);
    assert(late.length,'No gameplay beyond the incident departure-burst interval');
    const stray=await read(`lightning_hand_player?hand_id=in.(${continued.map(h=>h.hand_id).join(',')})&player_id=eq.${player.id}&select=hand_id`);
    assert(!stray.length,'Stopped participant was included in a later hand');
    report.continuedHands=continued;
    for (const h of [report.headsUpHand, {tableId:firstLightning.host_table_id,handNumber:firstLightning.hand_number}, {tableId:late[0].host_table_id,handNumber:late[0].hand_number}]) {
      const commit=await one(`hand_atomic_commits?table_id=eq.${h.tableId}&hand_number=eq.${h.handNumber}&select=conserved:stack_result->>conservation_checked,success:stack_result->>success`);
      assert(commit.conserved==='true' && commit.success==='true','A witnessed hand lacks its conservation receipt');
    }
    report.status='passed';
  } catch (e) {
    report.status='unknown'; report.error=String(e.message);
    if (page) {
      try { await page.screenshot({ path: join(out,'journey-failure.png') }); }
      catch (screenshotError) { report.failureScreenshotError=String(screenshotError.message); }
    }
  }
  finally {
    try {
      if (player && P && !financialUnknown) await leave();
      if (player && financialUnknown) {
        report.cleanup.retainedUnknownFinancialIntent=true;
        throw new Error('Financial outcome is unknown; retain owned identities and intent for readback');
      }
      if (player && C) {
        assert(!(await ownSeats()).length,'Owned seat must close before claim-back');
        const balance=await wallet(player.id);
        if (report.cashOut) assert(balance === Number(report.cashOut.final_stack), 'Owned cash-out and wallet do not reconcile');
        if (balance>0) {
          const opId=randomUUID(); report.claimBack={opId,amount:balance}; save();
          const claimed=await c.rpc(C.token,'fn_club_wallet_claim_back',{p_club_id:fundingClub,p_from_user_id:player.id,p_amount:balance,p_source:'player_wallet',p_destination:'club_bank',p_reason:'Certification cleanup: owned PLO lifecycle test credits returned',p_op_id:opId,p_transaction_id:null});
          assert(claimed.status===200 && claimed.body?.success===true,'Owned claim-back has no confirmed receipt');
        }
        assert(await wallet(player.id)===0,'Owned wallet is not reconciled');
        if (report.funding?.confirmed) {
        const legs=await read(`chip_ledger?club_id=eq.${fundingClub}&or=(idempotency_key.eq.club_bank_send:${report.funding?.opId},idempotency_key.eq.club_wallet_claim:${report.claimBack?.opId})&select=id,amount,idempotency_key,from_entity_id,to_entity_id`);
        assert(legs.some(x=>x.idempotency_key===`club_bank_send:${report.funding?.opId}` && Number(x.amount)===BUY_IN && x.from_entity_id===fundingClub && x.to_entity_id===player.id),'Funding ledger receipt missing');
        if(report.claimBack) assert(legs.some(x=>x.idempotency_key===`club_wallet_claim:${report.claimBack.opId}` && Number(x.amount)===report.claimBack.amount && x.from_entity_id===player.id && x.to_entity_id===fundingClub),'Claim-back ledger receipt missing');
        report.ownedFundingLegs=legs;
        }
      }
      for (const [role,account] of [['player',player],['cashier',cashier]]) if(account) await cleanupProductionE2EAccount({environment:roleEnv(role),fetchImpl,record:account,expectedEmail:account.email});
      report.cleanup.completed=true;
    } catch(e) { report.cleanup.completed=false; report.cleanup.error=String(e.message); report.status='unknown'; }
    if(browser) await browser.close();
    save();
  }
  console.log(JSON.stringify({status:report.status,cleanup:report.cleanup.completed,result:join(out,'result.json')}));
  return report.status==='passed' && report.cleanup.completed ? 0 : 3;
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().then(code=>{process.exitCode=code;}).catch(e=>{console.error(e.message);process.exitCode=3;});
