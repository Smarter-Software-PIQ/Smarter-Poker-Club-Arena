/**
 * DAILY LIVE RABBIT HUNT CERTIFICATION (Dan 2026-11-02: "Use only the supported
 * test-account and funding route for remaining API and browser checks").
 *
 * Proves, against production and the serving engine, the VIP previous-hand
 * rabbit hunt (#9233) and its authority fixes (#9314):
 *   - an early-ended hand's run-out is saved with exactly the dealt-in set;
 *   - the availability check answers saved / until saved + 1 day, never cards;
 *   - a VIP buys a previous hand (past the felt window, out of engine memory)
 *     from the saved run-out: 0 diamonds, one reveal receipt;
 *   - a non-VIP is refused a previous hand BEFORE any charge;
 *   - the bought hand reopens free;
 *   - a player who was not dealt in gets exactly the answer of a missing hand;
 *   - the Hand History page buys a previous hand in a real browser.
 *
 * Only the supported certification route is used, nothing improvised:
 *   accounts : createProductionE2EAccount / cleanupProductionE2EAccount (reserved
 *              ca-customization-cert-postdeploy-* identities);
 *   chips    : a certification club's own opening grant (fn_create_club_atomic),
 *              sent and claimed back by its owner, the club then retired
 *              through fn_retire_settled_club;
 *   VIP      : fn_ca_certification_vip_grant (no diamonds, self-expiring),
 *              ended by fn_ca_certification_vip_end;
 *   browser  : the #9303 device continuity (one stable ca_device_id per
 *              account); the device takeover choice is never clicked.
 * No mint, no real account, no real table. Cleanup always runs.
 *
 * ENGINE GATE: if the serving engine does not carry #9233 and #9314, or is not
 * idle, the run ends UNKNOWN ("the engine does not carry the feature yet")
 * without creating anything. UNKNOWN is not a pass and not a failure.
 */
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RABBIT_HUNT_REQUIRED_COMMITS = Object.freeze([
  { pr: 9233, sha: 'b6590efa8eae' },
  { pr: 9314, sha: '518d46c5412c146d3b4555fae1913d79ac4c9faa' },
]);
export const ENGINE_URL = 'https://engine.smarter.poker';
export const APP_ORIGIN = 'https://smarter.poker';

/** Does the serving engine carry every required commit, and is it idle? */
export async function engineGate({ health, isAncestor }) {
  const releaseSha = String(health?.releaseSha || '');
  if (!health) {
    return {
      carries: false,
      outcome: 'unknown',
      reason: 'the engine health check did not answer',
      releaseSha,
    };
  }
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) {
    return {
      carries: false,
      outcome: 'unknown',
      reason: 'the engine reported no release identity',
      releaseSha,
    };
  }
  const missing = [];
  for (const required of RABBIT_HUNT_REQUIRED_COMMITS) {
    let answer;
    try {
      answer = await isAncestor(required.sha, releaseSha);
    } catch {
      answer = null;
    }
    if (answer === null) {
      return {
        carries: false,
        outcome: 'unknown',
        reason: `could not read whether ${releaseSha.slice(0, 8)} contains #${required.pr}`,
        releaseSha,
      };
    }
    if (!answer) missing.push(`#${required.pr}`);
  }
  if (missing.length) {
    return {
      carries: false,
      outcome: 'unknown',
      reason: `the engine does not carry the feature yet (${releaseSha.slice(0, 8)} lacks ${missing.join(', ')})`,
      releaseSha,
    };
  }
  const phase = health?.maintenance?.phase;
  if (phase && phase !== 'idle') {
    return {
      carries: false,
      outcome: 'unknown',
      reason: `the engine is in maintenance (${phase}); certify after the thaw`,
      releaseSha,
    };
  }
  return {
    carries: true,
    outcome: 'run',
    reason: 'the engine carries #9233 and #9314 and is idle',
    releaseSha,
  };
}

/**
 * One verdict for the whole run. A cleanup step that did not finish FAILS the
 * run: a fixture this run cannot retire is residue the Cert Residue Sweep has
 * to drain (#9830), and a green run that left it behind would hide that. The
 * one terminal outcome that is not a failure is recorded as `ok: true` with
 * its detail: the owner identity kept as the owner of record of the retired
 * 'Cert RH' club (ownerRetainedAsRecord below), exactly the disposition the
 * stale sweep records for the same identity.
 */
export function verdict({ gate, steps, error, cleanup }) {
  if (!gate.carries) return { conclusion: 'unknown', reason: gate.reason };
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
 * The owner of a RETIRED 'Cert RH' club can never be removed: the club keeps
 * its tables, seats, hands and receipts (records_retained), and the account
 * door refuses any club owner (CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_
 * CUSTODY). That is the terminal state, not a failure. It holds only when the
 * door's refusal was exactly that, and the club row reads retired and owned
 * by this identity; anything else stays a failed cleanup.
 */
export function ownerRetainedAsRecord({ error, club, ownerId, clubId }) {
  const message = String(error?.message || error || '');
  return (
    message.includes('CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_CUSTODY') &&
    Boolean(clubId) &&
    club?.id === clubId &&
    club?.owner_id === ownerId &&
    club?.lifecycle_status === 'retired'
  );
}

/** The #9303 device token: one stable browser per reserved account and origin. */
/** What the engine reports as `source` for each preview answer. */
export const PREVIEW_TO_CHARGE = Object.freeze({
  lifetime_vip: 'lifetime_vip',
  credit: 'purchased',
  vip_allowance: 'vip_monthly',
  diamonds: 'diamonds',
});

/** Same cards, same order, compared by rank and suit only. */
export function sameCards(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0)
    return false;
  return a.every(
    (c, i) => String(c?.rank) === String(b[i]?.rank) && String(c?.suit) === String(b[i]?.suit)
  );
}

export function fixtureBrowserId(userId, origin = APP_ORIGIN) {
  const bytes = createHash('sha256').update(`ca-e2e-browser-v1\0${userId}\0${origin}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function gitIsAncestor(cwd) {
  return async (ancestor, descendant) => {
    const run = (args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      run(['cat-file', '-e', `${descendant}^{commit}`]);
    } catch {
      try {
        run(['fetch', '--quiet', 'origin', descendant]);
      } catch {
        return null;
      }
    }
    try {
      run(['merge-base', '--is-ancestor', ancestor, descendant]);
      return true;
    } catch (error) {
      return error?.status === 1 ? false : null;
    }
  };
}

/**
 * The service and anon clients one run uses, built once from its credentials
 * so the stranded-club settlement below talks to production exactly as the
 * run does. `fetchImpl` is injectable for tests only.
 */
export function clients({ SUPA, SR, ANON, fetchImpl = fetch, engineUrl = ENGINE_URL }) {
  const H = {
    apikey: SR,
    Authorization: `Bearer ${SR}`,
    'x-smarter-data-actor': 'service',
    'x-smarter-data-protocol': '1',
    'Content-Type': 'application/json',
  };
  const svc = async (path) => (await fetchImpl(`${SUPA}/rest/v1/${path}`, { headers: H })).json();
  const svcRpc = async (fn, args) => {
    const r = await fetchImpl(`${SUPA}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(args),
    });
    const t = await r.text();
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  };
  const rpc = async (token, fn, args) => {
    const r = await fetchImpl(`${SUPA}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    const t = await r.text();
    let b;
    try {
      b = JSON.parse(t);
    } catch {
      b = t;
    }
    return { status: r.status, body: b };
  };
  const engine = async (token, path, body) => {
    const r = await fetchImpl(`${engineUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let j = null;
    try {
      j = await r.json();
    } catch {}
    return { status: r.status, body: j };
  };
  const sessionFor = async (email) => {
    const g = await fetchImpl(`${SUPA}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ type: 'magiclink', email }),
    }).then((r) => r.json());
    const v = await fetchImpl(`${SUPA}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'magiclink',
        token_hash: g.hashed_token || g.properties?.hashed_token,
      }),
    }).then((r) => r.json());
    if (!v.access_token) throw new Error('a reserved certification session could not be opened');
    return { token: v.access_token, refresh: v.refresh_token, user: v.user, userId: v.user.id };
  };
  const adminUser = async (id) => {
    const r = await fetchImpl(`${SUPA}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
      headers: H,
    });
    if (!r.ok) throw new Error(`reserved identity ${id} could not be read (${r.status})`);
    return r.json();
  };
  return { H, svc, svcRpc, rpc, engine, sessionFor, adminUser };
}

/** The name the run gives its one cash game; the stranded settlement closes only these. */
export const RABBIT_HUNT_GAME_NAME = 'Cert RH';
/** Every 'Cert RH ' club is this run's; production-e2e-account.mjs pins the same prefix. */
export const RABBIT_HUNT_CLUB_NAME_PREFIX = 'Cert RH ';

/**
 * How long a leave is given to become a left seat. Both certification players
 * leave at the end of the engine cases; with hit-and-run switched off for the
 * certification club (main, below) a leave between hands is immediate and a
 * mid-hand leave settles at the hand end, well inside this.
 */
export const LEAVE_SETTLES_WITHIN_MS = 60_000;

/**
 * SETTLE THE CERTIFICATION CLUB: the run's own cleanup, restartable from its
 * record (CLAUDE.md 10.12). The run calls it in its finally; the stale sweep
 * calls it, through settleStrandedRabbitHuntClub, for a 'Cert RH' club whose
 * run died before this ran (2026-11-07, run 42411184920: "refused while
 * seated"). Same doors in the same order, as the club's own owner:
 *   1. nobody may still be seated (a live seat is the engine's, never ours);
 *   2. every open certification VIP grant on a member is ended;
 *   3. every member's chips go back to the club bank (fn_club_wallet_claim_back);
 *   4. the run's cash tables are closed (fn_execute_managed_game_command);
 *   5. the club is retired with its records (fn_retire_settled_club).
 * Accounts are NOT touched here: the run retires its own three afterwards and
 * the stale sweep retires stale identities through its own guarded door, which
 * accepts a zero-balance player of a retired club (20261107210316) and keeps
 * the owner as the owner of record. Each step is reported through `note`
 * (name, ok, detail); nothing here throws past a failed step, so every step is
 * named in the verdict.
 */
export async function settleRabbitHuntClub({
  c,
  clubId,
  clubName,
  ownerEmail,
  memberIds,
  tableIds,
  note,
  sleep: pause = sleep,
  reason = 'Rabbit hunt certification club, cleanup',
}) {
  const ids = [...new Set(memberIds)];
  const seated = ids.length
    ? await c.svc(`table_seats?left_at=is.null&user_id=in.(${ids.join(',')})&select=table_id`)
    : [];
  if (!Array.isArray(seated)) {
    note('read the certification seats', false, seated);
    return { settled: false, seated: null };
  }
  if (seated.length) {
    note('refused while seated', false, seated);
    return { settled: false, seated };
  }
  const grants = ids.length
    ? await c.svc(
        `ca_certification_vip_grants?user_id=in.(${ids.join(',')})&ended_at=is.null&select=op_id,user_id`
      )
    : [];
  if (!Array.isArray(grants)) {
    note('read the certification VIP grants', false, grants);
    return { settled: false, seated: [] };
  }
  for (const grant of grants) {
    const r = await c.svcRpc('fn_ca_certification_vip_end', {
      p_user_id: grant.user_id,
      p_op_id: grant.op_id,
      p_reason: 'certification cleanup',
    });
    note('end the certification VIP', r?.ok === true, r);
  }
  const O = await c.sessionFor(ownerEmail);
  const members = await c.svc(
    `club_members?club_id=eq.${clubId}&select=user_id,chip_balance&user_id=neq.${O.userId}`
  );
  if (!Array.isArray(members)) {
    note('read the certification members', false, members);
    return { settled: false, seated: [] };
  }
  for (const m of members) {
    const bal = Number(m.chip_balance || 0);
    if (!(bal > 0)) continue;
    const r = await c.rpc(O.token, 'fn_club_wallet_claim_back', {
      p_club_id: clubId,
      p_from_user_id: m.user_id,
      p_amount: bal,
      p_source: 'player_wallet',
      p_destination: 'club_bank',
      p_reason: 'Certification cleanup: test chips returned to the certification club bank',
      p_op_id: randomUUID(),
      p_transaction_id: null,
    });
    note(`return ${m.user_id} chips to the club bank`, r.body?.success === true, r.body?.error);
  }
  if (tableIds.length) {
    const l = await c.rpc(O.token, 'fn_list_managed_games', {
      p_scope: 'club',
      p_scope_id: clubId,
      p_cursor: null,
      p_cursor_kind: null,
      p_cursor_id: null,
      p_limit: 100,
      p_cursor_bucket: null,
      p_bucket: null,
    });
    let closedAny = false;
    for (const tableId of tableIds) {
      const it = (l.body?.items || []).find((i) => i.id === tableId);
      if (!it) continue;
      const r = await c.rpc(O.token, 'fn_execute_managed_game_command', {
        p_command_id: randomUUID(),
        p_kind: 'table',
        p_game_id: tableId,
        p_action: 'close',
        p_expected_version: it.contract?.version ?? 1,
        p_payload: {},
      });
      note('close the certification game', r.body?.ok === true, r.body?.reason);
      closedAny = true;
    }
    if (closedAny) await pause(4000);
  }
  const r = await c.rpc(O.token, 'fn_retire_settled_club', {
    p_club_id: clubId,
    p_confirm_name: clubName,
    p_reason: reason,
  });
  const retired = r.body?.success === true;
  note('retire the certification club', retired, r.body?.error);
  return { settled: retired, seated: [] };
}

/**
 * A 'Cert RH' club whose run died before its cleanup is settled from its
 * record: the club row names the owner, club_members names the players, and
 * the run's tables are the club's cash tables named RABBIT_HUNT_GAME_NAME.
 * Refuses, changing nothing, unless the club is an active 'Cert RH ' club
 * owned by `ownerId`, EVERY member is a reserved certification identity, and
 * nobody is seated. The stale sweep is its caller (production-e2e-account.mjs,
 * retireProductionCreateClubFixtures); the identities are then swept there.
 */
export async function settleStrandedRabbitHuntClub({
  environment = process.env,
  fetchImpl = fetch,
  clubId,
  ownerId,
  isReserved,
  log: emit = log,
  sleep: pause = sleep,
}) {
  const SUPA = String(environment.SUPABASE_URL || '').replace(/\/$/, '');
  const SR = environment.SUPABASE_SERVICE_ROLE_KEY;
  const ANON = environment.VITE_SUPABASE_ANON_KEY;
  if (!SUPA || !SR || !ANON)
    throw new Error(
      `Cannot settle rabbit-hunt certification club ${clubId}: SUPABASE_URL, ` +
        'SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_ANON_KEY are required.'
    );
  if (typeof isReserved !== 'function')
    throw new Error('settleStrandedRabbitHuntClub requires the reserved-namespace predicate.');
  const c = clients({ SUPA, SR, ANON, fetchImpl });
  const club = (
    await c.svc(
      `clubs?id=eq.${encodeURIComponent(clubId)}&select=id,name,owner_id,lifecycle_status`
    )
  )?.[0];
  if (
    !club ||
    club.id !== clubId ||
    club.owner_id !== ownerId ||
    !String(club.name || '').startsWith(RABBIT_HUNT_CLUB_NAME_PREFIX) ||
    club.lifecycle_status !== 'active'
  ) {
    throw new Error(
      `Refusing to settle club ${clubId}: not an active rabbit-hunt certification club owned by ${ownerId}.`
    );
  }
  const members = await c.svc(
    `club_members?club_id=eq.${encodeURIComponent(clubId)}&select=user_id,role`
  );
  if (!Array.isArray(members) || !members.length)
    throw new Error(`Refusing to settle club ${clubId}: its members could not be read.`);
  const identities = [];
  for (const m of members) {
    const user = await c.adminUser(m.user_id);
    if (!user?.email || !isReserved(user.email))
      throw new Error(
        `Refusing to settle club ${clubId}: member ${m.user_id} is not a reserved certification identity.`
      );
    identities.push({ id: m.user_id, email: user.email, role: m.role });
  }
  const owner = identities.find((i) => i.id === ownerId);
  if (!owner) throw new Error(`Refusing to settle club ${clubId}: its owner is not a member.`);
  const tables = await c.svc(
    `tables?club_id=eq.${encodeURIComponent(clubId)}&tournament_id=is.null&is_deleted=eq.false` +
      `&name=eq.${encodeURIComponent(RABBIT_HUNT_GAME_NAME)}&status=neq.closed&select=id`
  );
  if (!Array.isArray(tables))
    throw new Error(`Refusing to settle club ${clubId}: its tables could not be read.`);
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
    tableIds: tables.map((t) => t.id),
    note,
    sleep: pause,
    reason: 'Rabbit hunt certification club, settled after its run died (stale sweep)',
  });
  if (!outcome.settled || failures.length)
    throw new Error(
      `Rabbit-hunt certification club ${clubId} was not settled: ${failures.join('; ') || 'the club is not retired'}.`
    );
  const after = (
    await c.svc(`clubs?id=eq.${encodeURIComponent(clubId)}&select=id,owner_id,lifecycle_status`)
  )?.[0];
  if (after?.lifecycle_status !== 'retired' || after?.owner_id !== ownerId)
    throw new Error(
      `Rabbit-hunt certification club ${clubId} does not read retired after settlement.`
    );
  return { clubId, ownerId, members: identities.map((i) => i.id) };
}

const log = (...a) =>
  console.log(
    '[rabbit-hunt-cert]',
    ...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const SUPA = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY;
  if (!SUPA || !SR || !ANON)
    throw new Error(
      'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_ANON_KEY are required.'
    );
  const repoRoot = process.cwd();
  const summary = (text) => {
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  };

  // An engine that does not answer (restarting, overloaded) is UNKNOWN, never a crash.
  let health = null;
  try {
    const r = await fetch(`${ENGINE_URL}/health`, { signal: AbortSignal.timeout(20_000) });
    health = await r.json();
  } catch {
    health = null;
  }
  const gate = await engineGate({ health, isAncestor: gitIsAncestor(repoRoot) });
  log('engine gate', gate);
  if (!gate.carries) {
    summary(
      `### Rabbit Hunt Certification\n\n- result: **UNKNOWN** - ${gate.reason}\n- serving engine: \`${gate.releaseSha || 'unread'}\`\n- nothing was created`
    );
    console.log(`RABBIT_HUNT_CERTIFICATION UNKNOWN: ${gate.reason}`);
    // Not a pass: say so on the run itself, not only in the summary.
    console.log(`::warning title=Rabbit hunt certification did not run::${gate.reason}`);
    return 0;
  }

  const { createProductionE2EAccount, cleanupProductionE2EAccount } = await import(
    pathToFileURL(join(repoRoot, 'scripts/ci/production-e2e-account.mjs')).href
  );
  const { awaitPlatformThaw, describeThaw, freezeBudgetMs } = await import(
    pathToFileURL(join(repoRoot, 'scripts/ci/platform-freeze-window.mjs')).href
  );
  const { svc, svcRpc, rpc, engine, sessionFor } = clients({ SUPA, SR, ANON });
  const thaw = async () => {
    const rows = await svc(
      'engine_maintenance_break?select=phase,break_started_at,break_ends_at,enforce_freeze&limit=1'
    );
    const result = await awaitPlatformThaw({
      isFrozen: async () => (await svcRpc('fn_platform_frozen', {})) === true,
      budgetMs: freezeBudgetMs(Array.isArray(rows) ? rows[0] || null : null, Date.now()),
    });
    log(describeThaw(result));
    if (result.outcome !== 'thawed')
      throw new Error(`the platform did not thaw: ${describeThaw(result)}`);
  };

  const scratch = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'rabbit-hunt-cert-'));
  const envFor = (role) => ({
    SUPABASE_URL: SUPA,
    SUPABASE_SERVICE_ROLE_KEY: SR,
    GITHUB_ENV: join(scratch, `env-${role}`),
    E2E_TEST_ACCOUNT_FILE: join(scratch, `account-${role}.json`),
    RUNNER_TEMP: scratch,
  });
  const S = { accounts: {} };
  const steps = [];
  const cleanup = [];
  let error = null;
  const step = (name, ok, detail) => {
    steps.push({ name, ok: !!ok, detail });
    log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
  };

  try {
    await thaw();
    for (const role of ['owner', 'vip', 'plain']) {
      writeFileSync(join(scratch, `env-${role}`), '');
      const a = await createProductionE2EAccount({ environment: envFor(role) });
      S.accounts[role] = { id: a.id, email: a.email };
    }
    const P = {};
    for (const role of ['owner', 'vip', 'plain'])
      P[role] = await sessionFor(S.accounts[role].email);
    const club = await rpc(P.owner.token, 'fn_create_club_atomic', {
      p_request_id: randomUUID(),
      p_name: `Cert RH ${Date.now().toString().slice(-8)}`,
      p_description: 'Rabbit hunt certification club (reserved certification accounts only)',
      p_color_theme: 'blue',
      p_is_public: false,
      p_requires_approval: false,
      p_logo_url: null,
    });
    S.clubId = club.body?.id;
    S.clubName = club.body?.name;
    if (!S.clubId) throw new Error(`the certification club was not created (${club.status})`);
    // HIT AND RUN is a club setting (20261107040516). A certification player
    // who wins is "in profit" and owes the club's hand count before leaving; at
    // a two-seat table whose other player has left, those hands never come and
    // the seat stays until the hold lapses, which is what left run 42411184920
    // "refused while seated". The owner switches the rule off for this club,
    // through the owner's own door, before anyone sits.
    const hitRun = await rpc(P.owner.token, 'fn_set_club_hit_run', {
      p_club_id: S.clubId,
      p_enabled: false,
      p_hands: 10,
    });
    if (hitRun.body?.ok !== true)
      throw new Error(
        `hit-and-run could not be switched off for the certification club (${JSON.stringify(hitRun.body)})`
      );
    for (const role of ['vip', 'plain']) {
      const j = await rpc(P[role].token, 'fn_join_club', { p_club_id: S.clubId });
      if (j.status >= 300) throw new Error(`${role} could not join the certification club`);
      const t = await rpc(P.owner.token, 'fn_cashier_batch_transfer', {
        p_club_id: S.clubId,
        p_kind: 'send',
        p_batch_id: randomUUID(),
        p_items: [
          {
            user_id: P[role].userId,
            amount: 8,
            source: 'club_bank',
            destination: 'player_wallet',
            reason: 'Cashier Send Out',
            op_id: randomUUID(),
          },
        ],
      });
      if (t.body?.success !== true) throw new Error(`${role} was not funded from the club bank`);
    }
    S.vipOp = `rh-cert-vip-${S.accounts.vip.id}`;
    const grant = await svcRpc('fn_ca_certification_vip_grant', {
      p_user_id: S.accounts.vip.id,
      p_minutes: 90,
      p_operator: 'rabbit-hunt-certification workflow',
      p_reason: 'Certify VIP-only previous-hand rabbit hunting on the live engine',
      p_op_id: S.vipOp,
    });
    if (grant?.ok !== true) throw new Error(`certification VIP grant refused: ${grant?.reason}`);
    const game = await rpc(P.owner.token, 'fn_cash_game_create', {
      p_club_id: S.clubId,
      p_template: 'classic',
      p_variant: 'NLH',
      p_sb: 0.05,
      p_bb: 0.1,
      p_handedness: 6,
      p_overrides: {},
      p_name: 'Cert RH',
      p_must_move: false,
    });
    S.gameId = game.body?.game_id;
    S.tableId = game.body?.table_id;
    if (!S.tableId) throw new Error('the certification cash game was not created');
    const T = S.tableId;

    // ---- engine cases ----
    const { default: JP } = await import('fast-json-patch');
    const diamonds = async (role) =>
      (await svc(`profiles?id=eq.${P[role].userId}&select=diamonds`))[0]?.diamonds;
    const usage = async (role) =>
      (
        (
          await svc(
            `vip_feature_usage_monthly?user_id=eq.${P[role].userId}&feature=eq.rabbit_hunt&month=eq.${new Date().toISOString().slice(0, 7)}&select=usage_count`
          )
        )[0] || {}
      ).usage_count ?? 0;
    const reveals = async (role, h) =>
      svc(
        `rabbit_hunt_reveals?user_id=eq.${P[role].userId}&table_id=eq.${T}&hand_number=eq.${h}&select=hand_number`
      );
    const receipts = async (role) =>
      svc(
        `digital_purchase_receipts?user_id=eq.${P[role].userId}&purchase_kind=eq.rabbit_hunt&select=request_id`
      );
    const saved = async (h) =>
      (
        await svc(
          `rabbit_hunt_offers?table_id=eq.${T}&hand_number=eq.${h}&select=hand_number,board_len,eligible_user_ids,created_at`
        )
      )[0];
    const status = async (role, h) =>
      (
        await rpc(P[role].token, 'fn_rabbit_hunt_replay_status', {
          p_table_id: T,
          p_hand_number: h,
        })
      ).body;
    const hunt = (role, h) => engine(P[role].token, '/rabbit-hunt', { tableId: T, handNumber: h });
    const waiters = [];
    const sockets = [];
    for (const role of ['vip', 'plain']) {
      let state = null;
      let acted = null;
      const who = P[role];
      const ws = new WebSocket(`wss://engine.smarter.poker/ws/table/${T}`, ['bearer', who.token]);
      sockets.push(ws);
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
        if (role === 'vip' && m.type === 'EVENT' && m.payload?.type === 'rabbit_hunt_available') {
          const o = { hand: Number(m.payload.hand_number), at: Date.now() };
          waiters.splice(0).forEach((w) => w(o));
        }
        if (
          state &&
          state.current_player === who.userId &&
          state.action_context &&
          state.action_context !== acted
        ) {
          acted = state.action_context;
          const r = await engine(who.token, '/action', {
            tableId: T,
            action: 'fold',
            actionContext: state.action_context,
            idempotencyKey: randomUUID(),
          });
          if (!r.body?.success)
            await engine(who.token, '/action', {
              tableId: T,
              action: 'check',
              actionContext: state.action_context,
              idempotencyKey: randomUUID(),
            });
        }
      };
    }
    const next = () =>
      new Promise((res, rej) => {
        waiters.push(res);
        setTimeout(() => rej(new Error('no rabbit hunt offer within 5 minutes')), 300_000);
      });
    S.seated = [];
    try {
      await sleep(2500);
      for (const [i, role] of ['vip', 'plain'].entries()) {
        const b = await rpc(P[role].token, 'atomic_table_buyin', {
          p_user_id: P[role].userId,
          p_table_id: T,
          p_seat_number: i + 1,
          p_amount: 4,
          p_auto_rebuy: false,
          p_club_id: S.clubId,
          p_idempotency_key: randomUUID(),
        });
        if (b.status < 300) S.seated.push(role);
      }
      step(
        'two reserved certification players seated with certification-club chips',
        S.seated.length === 2
      );
      const h1 = await next();
      const h2 = await next();
      await next();
      await next();
      await next();
      while (Date.now() - h2.at < 95_000) await sleep(2000);
      S.hands = [h1.hand, h2.hand];
      const s1 = await saved(h1.hand);
      const s2 = await saved(h2.hand);
      step(
        'early-ended runouts are saved with exactly the dealt-in set',
        !!s1 &&
          !!s2 &&
          s1.eligible_user_ids.length === 2 &&
          [P.vip.userId, P.plain.userId].every((u) => s1.eligible_user_ids.includes(u)),
        { board: s1?.board_len }
      );
      const st1 = await status('vip', h1.hand);
      step(
        'availability for the dealt-in VIP: saved, until saved + 1 day, no cards',
        st1?.status === 'saved' &&
          !('cards' in st1) &&
          Math.abs(Date.parse(st1.expires_at) - Date.parse(s1.created_at) - 86_400_000) < 2000,
        st1
      );
      const vd = await diamonds('vip');
      const vu = await usage('vip');
      const pv = (await rpc(P.vip.token, 'fn_rabbit_hunt_charge_preview', {})).body;
      const b1 = await hunt('vip', h1.hand);
      step(
        'the price shown before the tap is what the engine charged',
        PREVIEW_TO_CHARGE[pv?.source] === b1.body?.source,
        { preview: pv?.source, charged: b1.body?.source }
      );
      step(
        'a VIP buys a previous hand from the saved runout',
        b1.body?.success === true && (b1.body.cards || []).length === 5 - s1.board_len,
        { source: b1.body?.source, error: b1.body?.error }
      );
      step(
        'one reveal receipt, 0 diamonds, one allowance count',
        (await reveals('vip', h1.hand)).length === 1 &&
          (await diamonds('vip')) === vd &&
          (await usage('vip')) === vu + 1
      );
      const own = async (role, h) =>
        (
          await rpc(P[role].token, 'fn_rabbit_hunt_owned_runout', {
            p_table_id: T,
            p_hand_number: h,
          })
        ).body;
      const ov = await own('vip', h1.hand);
      step(
        'the bought run-out is kept: exactly the cards sold',
        ov?.owned === true &&
          sameCards(ov.cards, b1.body?.cards) &&
          Number(ov.board_len) === Number(s1.board_len),
        { kept: ov?.cards?.length, sold: b1.body?.cards?.length }
      );
      const op = await own('plain', h1.hand);
      const oo = await own('owner', h1.hand);
      step(
        'a kept run-out is readable only by its buyer',
        op?.owned === false && !op.cards && oo?.owned === false && !oo.cards,
        { plain: op, owner: oo }
      );
      const pr0 = (await receipts('plain')).length;
      const n2 = await hunt('plain', h2.hand);
      step(
        'a non-VIP is refused a previous hand before any charge',
        n2.body?.success === false &&
          /VIP/i.test(n2.body?.error || '') &&
          !n2.body?.cards &&
          (await reveals('plain', h2.hand)).length === 0 &&
          (await receipts('plain')).length === pr0,
        n2.body
      );
      const vu1 = await usage('vip');
      const re = await hunt('vip', h1.hand);
      step(
        'the bought hand reopens free',
        re.body?.success === true &&
          re.body?.source === 'already_revealed' &&
          (await usage('vip')) === vu1,
        re.body?.source
      );
      const o1 = await hunt('owner', h1.hand);
      const oNone = await hunt('owner', 1);
      const so1 = await status('owner', h1.hand);
      const soNone = await status('owner', 1);
      step(
        'not dealt in: the same answer as a hand with nothing saved',
        o1.body?.success === false &&
          !o1.body?.cards &&
          JSON.stringify(o1.body) === JSON.stringify(oNone.body) &&
          JSON.stringify(so1) === JSON.stringify(soNone),
        { engine: o1.body, status: so1 }
      );
    } finally {
      const leaves = {};
      for (const role of S.seated) {
        const seat = (
          await svc(
            `table_seats?table_id=eq.${T}&user_id=eq.${P[role].userId}&left_at=is.null&select=seat_number,occupancy_id`
          )
        )[0];
        if (seat)
          leaves[role] = await engine(P[role].token, '/leave-occupancy', {
            tableId: T,
            seatNumber: seat.seat_number,
            occupancyId: seat.occupancy_id,
          });
      }
      // A leave is finished when the seat row says so, not when the request
      // was answered: a mid-hand leave settles at the hand end. Waiting here
      // is what lets the cleanup below find nobody seated.
      const until = Date.now() + LEAVE_SETTLES_WITHIN_MS;
      let still = [];
      do {
        still = S.seated.length
          ? await svc(
              `table_seats?table_id=eq.${T}&left_at=is.null&user_id=in.(${S.seated
                .map((role) => P[role].userId)
                .join(',')})&select=user_id`
            )
          : [];
        if (Array.isArray(still) && !still.length) break;
        await sleep(2000);
      } while (Date.now() < until);
      step(
        'both certification players left their seats',
        Array.isArray(still) && still.length === 0,
        { leaves: Object.fromEntries(Object.entries(leaves).map(([r, l]) => [r, l.body])), still }
      );
      sockets.forEach((w) => {
        try {
          w.close();
        } catch {}
      });
    }

    // ---- Hand History in a real browser (isolated context, #9303 device continuity) ----
    const { chromium } = await import('playwright');
    const hh = (
      await svc(`hand_history?table_id=eq.${T}&hand_number=eq.${S.hands[1]}&select=id`)
    )[0];
    const browserId = fixtureBrowserId(P.vip.userId);
    const browser = await chromium.launch();
    try {
      const ctx = await browser.newContext({
        viewport: { width: 1300, height: 900 },
        storageState: {
          cookies: [],
          origins: [
            { origin: APP_ORIGIN, localStorage: [{ name: 'ca_device_id', value: browserId }] },
          ],
        },
      });
      const page = await ctx.newPage();
      const posts = [];
      page.on('response', async (rs) => {
        if (rs.request().method() === 'POST' && rs.url().includes('/rabbit-hunt'))
          posts.push(rs.status());
      });
      await page.goto(`${APP_ORIGIN}/hub/club-arena/`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await page.evaluate(
        ({ s }) => {
          localStorage.setItem('smarter-poker-auth', JSON.stringify(s));
          localStorage.setItem('club_arena_welcome_accepted', 'true');
        },
        {
          s: {
            access_token: P.vip.token,
            refresh_token: P.vip.refresh,
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: P.vip.user,
          },
        }
      );
      const open = async () => {
        await page.goto(`${APP_ORIGIN}/hub/club-arena/hand-history?hand=${hh.id}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        await page.waitForTimeout(9000);
      };
      await open();
      if (await page.getByRole('button', { name: 'This Is A New Device' }).count())
        throw new Error('the device prompt was shown; not taking over (owner rule)');
      if (await page.getByText('Please Review And Accept To Continue').count()) {
        for (let i = 0; i < 4; i++) {
          await page.evaluate(() =>
            document.querySelectorAll('*').forEach((el) => {
              const s = getComputedStyle(el);
              if (
                (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
                el.scrollHeight > el.clientHeight + 5
              ) {
                el.scrollTop = el.scrollHeight;
                el.dispatchEvent(new Event('scroll'));
              }
            })
          );
          await page.waitForTimeout(500);
        }
        const cb = page.locator('input.sc-check__box');
        if (await cb.count()) await cb.first().check({ force: true });
        await page.getByRole('button', { name: 'Accept & Continue' }).click({ timeout: 15_000 });
        await page.waitForTimeout(4000);
        await open();
      }
      const card = page.locator('.hand-card--linked').first();
      await card.click();
      await page.waitForTimeout(1200);
      await card.getByRole('button', { name: 'Open Hand Detail' }).click();
      const sec = page.locator('section.hdm-rabbit');
      await sec.waitFor({ timeout: 20_000 });
      await page.waitForTimeout(4000);
      const before = (await sec.innerText()).replace(/\s+/g, ' ');
      step(
        'Hand History shows the price before the tap',
        /Uses 1 VIP Rabbit Hunt \(\d+ Left This Month\)|Uses 1 Rabbit Hunt Credit|Free With Lifetime VIP|Costs \d+ Diamonds/.test(
          before
        ),
        before.slice(0, 240)
      );
      const btn = sec.getByRole('button', { name: /Show What Would Have Come/i });
      step(
        'Hand History offers the previous-hand purchase with its day limit',
        (await btn.count()) === 1 && /Available Until/i.test(before),
        before.slice(0, 200)
      );
      if (await btn.count()) {
        await btn.first().click();
        await page.waitForTimeout(6000);
      }
      const after = (await sec.innerText()).replace(/\s+/g, ' ');
      step(
        'Hand History buys the previous hand in a real browser',
        posts.length === 1 && posts[0] < 300 && (await reveals('vip', S.hands[1])).length === 1,
        { posts, after: after.slice(0, 200) }
      );
    } finally {
      await browser.close();
    }
  } catch (e) {
    error = String(e?.message || e);
    log('ERROR', error);
  } finally {
    const note = (name, ok, detail) => {
      cleanup.push({ step: name, ok, detail });
      log(ok ? 'CLEANUP' : 'CLEANUP FAILED', name, detail ?? '');
    };
    try {
      const outcome = S.clubId
        ? await settleRabbitHuntClub({
            c: { svc, svcRpc, rpc, sessionFor },
            clubId: S.clubId,
            clubName: S.clubName,
            ownerEmail: S.accounts.owner.email,
            memberIds: Object.values(S.accounts).map((a) => a.id),
            tableIds: S.tableId ? [S.tableId] : [],
            note,
          })
        : { settled: true, seated: [] };
      if (outcome.seated === null || outcome.seated.length) {
        // Nothing else is touched while a seat is live: the stale sweep
        // settles this club once everyone has left (settleStrandedRabbitHuntClub).
      } else {
        for (const role of ['vip', 'plain', 'owner']) {
          if (!S.accounts[role]) continue;
          try {
            await cleanupProductionE2EAccount({
              environment: envFor(role),
              expectedEmail: S.accounts[role].email,
            });
            note(`retire the ${role} account`, true);
          } catch (e) {
            let retainedOwner = false;
            if (role === 'owner' && S.clubId) {
              try {
                const club = (
                  await svc(`clubs?id=eq.${S.clubId}&select=id,owner_id,lifecycle_status`)
                )[0];
                retainedOwner = ownerRetainedAsRecord({
                  error: e,
                  club,
                  ownerId: S.accounts.owner.id,
                  clubId: S.clubId,
                });
              } catch {
                // Unreadable is not retained: the refusal below stands.
              }
            }
            if (retainedOwner) {
              note(
                'retire the owner account',
                true,
                `kept as the owner of record of retired club ${S.clubId}; its records are retained and never deleted`
              );
              continue;
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
  summary(
    [
      `### Rabbit Hunt Certification`,
      '',
      `- result: **${v.conclusion.toUpperCase()}** - ${v.reason}`,
      `- serving engine: \`${gate.releaseSha}\``,
      '',
      '| case | result |',
      '| --- | --- |',
      ...steps.map((s) => `| ${s.name} | ${s.ok ? 'PASS' : 'FAIL'} |`),
      ...cleanup.map((c) => `| cleanup: ${c.step} | ${c.ok ? 'done' : 'FAILED'} |`),
    ].join('\n')
  );
  console.log(`RABBIT_HUNT_CERTIFICATION ${v.conclusion.toUpperCase()}: ${v.reason}`);
  return v.conclusion === 'fail' ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    }
  );
}
