/**
 * LAW: A CASH HAND NEVER WAITS ON THE UNION'S BBJ POOL OR INSURANCE BANK
 *
 * Owner rulings, 2026-11-17: a tournament problem must be isolated and must
 * never affect another tournament or a cash game; promo chips must never
 * cause payout issues.
 *
 * #11256 took the union_wallets row out of the cash hand's post-commit
 * envelope (rake stored in cash_rake_pending). Two union-wide shared rows were
 * still reached inside the transaction the engine's settlement barrier waits
 * on: the union's one BBJ pool ('bbj-pool:' advisory lock, bbj_pools FOR
 * UPDATE, ca_bbj_alloc_state, held to COMMIT) and the union's insurance bank
 * (record_insurance_transaction upserts union_wallets.insurance_wallet).
 * Every BBJ hand on production is also a raked hand (6,216 of 6,216 read
 * 2026-11-18), so until #11256 they queued on union_wallets first; with it,
 * the pool becomes the union's single queue.
 *
 * 20261118071736 stores both obligations in hand_bank_obligation_pending; the
 * hand's own projection continuation banks them with the unchanged calls,
 * never waiting for the pool or the bank (20261118071728). This law pins:
 *
 *   1. the envelope the switch produces from #11256's postimage: pinned
 *      md5, the BBJ and insurance steps store, nothing in it locks the pool,
 *      calls bbj_record_contribution / record_insurance_transaction /
 *      atomic_distribute_rake, or writes a union-wide row;
 *   2. the envelope's callees are a closed list, now with no union-wide writer;
 *   3. the banker takes the pool lock with try, the pool and bank rows NOWAIT,
 *      before the calls; busy is caught; the continuation runs it before any
 *      table or player lock and ends its pass; the outbox cannot leave early;
 *   4. a stored obligation is on the felt in the tally and both meters;
 *   5. no timer; no later migration puts the calls back into the envelope;
 *   6. the two-session proof on real PostgreSQL stays wired.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const RAKE_SWITCH = '20261118035606_a_cash_hand_never_waits_on_a_tournament_wallet_lock.sql';
const PART1 = '20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on.sql';
const SWITCH = '20261118071736_a_cash_hand_never_waits_on_the_union_bbj_pool_or_insurance_b.sql';
const ENVELOPE = 'fn_ca_process_hand_post_commit_obligations';
const LIVE = '8b81e8bb218cacb235832285e4fbbb24';
const PRE = 'da123635a0f1cdb035bd9b518ebf07f0';
const POST = '11f769218554c9585f92ee2c5745e61f';

const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
/** SQL with comments blanked: behaviour cannot live in one. */
const code = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const dollar = (sql: string, tag: string) => {
  const parts = sql.split(`$${tag}$`);
  expect(parts.length, `exactly one $${tag}$ block`).toBe(3);
  return parts[1];
};
const once = (text: string, from: string, to: string) => {
  expect(text.split(from).length, 'the anchor occurs exactly once').toBe(2);
  return text.replace(from, to);
};
const UNION_WIDE_WRITE =
  /(insert\s+into|update|delete\s+from)\s+(only\s+)?(public\.)?(union_wallets|club_wallets|bbj_pools|ca_bbj_alloc_state)\b/i;

const rakeSwitch = read('supabase', 'migrations', RAKE_SWITCH);
const part1 = read('supabase', 'migrations', PART1);
const sw = read('supabase', 'migrations', SWITCH);
const fixture = JSON.parse(
  read('scripts', 'ci', 'fixtures', 'cash-rake-pending', 'live-definitions.json')
) as { functions: Record<string, { md5: string; definition: string }> };
const bankFixture = JSON.parse(
  read('scripts', 'ci', 'fixtures', 'hand-bank-pending', 'live-definitions.json')
) as { functions: Record<string, { md5: string; definition: string }> };
const live = fixture.functions[ENVELOPE].definition;
const pre = once(live, dollar(rakeSwitch, 'oenv0'), dollar(rakeSwitch, 'nenv0'));
const post = once(
  once(pre, dollar(sw, 'oenv1'), dollar(sw, 'nenv1')),
  dollar(sw, 'oenv2'),
  dollar(sw, 'nenv2')
);
const banker = code(
  dollar(part1.split('CREATE FUNCTION public.fn_ca_bank_pending_hand_obligations')[1], 'fn')
);

describe("a cash hand never waits on the union's BBJ pool or insurance bank", () => {
  it("the switch turns #11256's envelope into the pinned postimage", () => {
    expect(md5(live)).toBe(LIVE);
    expect(md5(pre)).toBe(PRE);
    expect(md5(post)).toBe(POST);
    expect(sw).toContain(`'${PRE}', '${POST}'`);
  });

  it('the BBJ and insurance steps store their obligations instead of banking them', () => {
    expect(code(dollar(sw, 'oenv1'))).toMatch(/'bbj-pool:'/);
    expect(code(dollar(sw, 'oenv1'))).toMatch(/public\.bbj_record_contribution\s*\(/);
    expect(code(dollar(sw, 'oenv2'))).toMatch(/public\.record_insurance_transaction\s*\(/);
    for (const tag of ['nenv1', 'nenv2'])
      expect(code(dollar(sw, tag))).toMatch(
        /INSERT INTO public\.hand_bank_obligation_pending[\s\S]*ON CONFLICT \(hand_id, kind, item_key\) DO NOTHING;/
      );
  });

  it('nothing in the envelope locks the pool, banks, or writes a union-wide row', () => {
    const body = code(post);
    expect(body).not.toMatch(/'bbj-pool:'/);
    expect(body).not.toMatch(/bbj_pools[\s\S]{0,200}FOR UPDATE/);
    expect(body).not.toMatch(
      /(bbj_record_contribution|record_insurance_transaction|atomic_distribute_rake)\s*\(/
    );
    expect(body).not.toMatch(UNION_WIDE_WRITE);
  });

  it('the envelope calls a closed list of functions, none of which writes a union-wide row', () => {
    const body = code(post);
    const callees = [
      ...new Set(
        [...body.matchAll(/\b(?:public|smarter_private)\.([a-z_0-9]+)\s*\(/g)]
          .filter((m) => !/(INSERT INTO|FUNCTION)\s+$/.test(body.slice(0, m.index)))
          .map((m) => m[1])
      ),
    ].sort();
    expect(callees).toEqual([
      'f06_wait_table_lane',
      'fn_platform_frozen',
      'fn_union_pnl_certify_posthand_escrow',
      'fn_union_pnl_prove_posthand_escrow',
      'original_inventory_proof_sources_match',
      'posthand_escrow_original_snapshot',
      // Per player (club_members, player_stats), never union- or club-wide.
      'promo_apply_playthrough',
      // Per table and per player (table_seats, the player's wallet).
      'resolve_pending_addon',
    ]);
  });

  it('the banker never waits for the pool or the bank, and makes the unchanged calls', () => {
    const tryPool = banker.search(/IF NOT pg_try_advisory_xact_lock\(hashtextextended\(\s*'bbj-pool:'/);
    const poolRow = banker.search(/FOR UPDATE NOWAIT;/);
    const bbjCall = banker.search(/FROM public\.bbj_record_contribution\s*\(/);
    const bankRow = banker.search(
      /FROM public\.union_wallets w\s+WHERE w\.union_id = v_union FOR NO KEY UPDATE NOWAIT;/
    );
    const insCall = banker.search(/FROM public\.record_insurance_transaction\s*\(/);
    expect(tryPool).toBeGreaterThan(-1);
    expect(poolRow).toBeGreaterThan(tryPool);
    expect(bbjCall).toBeGreaterThan(poolRow);
    expect(bankRow).toBeGreaterThan(bbjCall);
    expect(insCall).toBeGreaterThan(bankRow);
    expect(banker).toMatch(/FROM public\.club_wallets w\s+WHERE[\s\S]*FOR NO KEY UPDATE NOWAIT;/);
    expect(banker).not.toMatch(/pg_advisory_xact_lock\s*\(/);
    expect(banker).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(banker).toMatch(/WHEN lock_not_available THEN\s+v_state := 'busy';/);
    // The called functions are the production text, unchanged by this work.
    for (const name of ['bbj_record_contribution', 'record_insurance_transaction', 'fn_bbj_allocate']) {
      const f = bankFixture.functions[name];
      expect(md5(f.definition)).toBe(f.md5);
      for (const sql of [part1, sw])
        expect(code(sql)).not.toMatch(new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${name}\\b`));
    }
  });

  it('the continuation banks before it takes any table or player lock, and ends its pass', () => {
    const projected = [
      ['oproj1', 'nproj1'],
      ['oproj2', 'nproj2'],
      ['oproj3', 'nproj3'],
      ['oproj4', 'nproj4'],
    ].reduce(
      (text, [o, n]) => once(text, dollar(part1, o), dollar(part1, n)),
      fixture.functions.fn_project_hand_side_effects.definition.replace(
        dollar(read('supabase', 'migrations', '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall.sql'), 'oproj0'),
        dollar(read('supabase', 'migrations', '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall.sql'), 'nproj0')
      )
    );
    expect(md5(projected)).toBe('39d043cda727119e0a6d883a3fb25d50');
    const bank = projected.indexOf('public.fn_ca_bank_pending_hand_obligations(p_hand_id)');
    const lane = projected.indexOf('PERFORM smarter_private.f06_wait_table_lane(v_table_id)');
    expect(bank).toBeGreaterThan(-1);
    expect(lane).toBeGreaterThan(bank);
    const before = code(projected.slice(bank, lane));
    expect(before).not.toMatch(/pg_advisory_xact_lock|player-stats:/);
    expect(before).toMatch(/IF v_hand_bank IS NOT NULL THEN\s+RETURN jsonb_build_object\(\s+'ok', false,\s+'reason', 'predecessor_pending'/);
    expect(code(dollar(part1, 'ntrg1'))).toMatch(
      /fn_ca_bank_pending_hand_obligations\(OLD\.hand_id\);\s+IF v_result->>'status' IS DISTINCT FROM 'banked' THEN\s+RAISE EXCEPTION/
    );
  });

  it('a stored obligation is on the felt in the tally and in both meters, and owed in the audit', () => {
    expect(code(dollar(part1, 'ntally1'))).toMatch(
      /WHEN 'hand_bank_obligation_pending' THEN\s+k_old := 'table_stack'; k_new := 'table_stack';/
    );
    for (const tag of ['nsupply1', 'nacct1'])
      expect(code(dollar(part1, tag))).toMatch(
        /\+ \(SELECT COALESCE\(sum\(bp\.felt_amount\), 0\)\s+FROM public\.hand_bank_obligation_pending bp/
      );
    expect(code(part1)).toMatch(
      /CREATE CONSTRAINT TRIGGER zz_ca_balance_has_its_ledger_row\s+AFTER INSERT OR UPDATE OF felt_amount, table_id OR DELETE ON public\.hand_bank_obligation_pending\s+DEFERRABLE INITIALLY DEFERRED/
    );
    expect(code(dollar(part1, 'ninv2'))).toMatch(/NOT EXISTS \(SELECT 1 FROM hand_bank_obligation_pending bp/);
    expect(code(dollar(part1, 'ninv3'))).toMatch(/FROM hand_bank_obligation_pending bp\s+WHERE bp\.created_at < v_grace/);
  });

  it('no timer banks a drop or an insurance leg', () => {
    for (const sql of [part1, sw]) expect(code(sql)).not.toMatch(/cron\.(schedule|alter_job)/);
  });

  it('no later migration puts the pool or the bank back into the envelope', () => {
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && f.slice(0, 14) > SWITCH.slice(0, 14))
      .filter((f) => {
        const sql = code(readFileSync(join(MIGRATIONS, f), 'utf8'));
        return (
          sql.includes(ENVELOPE) &&
          /(bbj_record_contribution|record_insurance_transaction)\s*\(|'bbj-pool:'/.test(sql)
        );
      });
    expect(
      later,
      'a migration after the switch names the hand envelope and banks the BBJ drop or an insurance leg. ' +
        'They are banked by fn_ca_bank_pending_hand_obligations from the projection continuation, never by the envelope.'
    ).toEqual([]);
  });

  it('the two-session proof stays wired', () => {
    const harness = read('scripts', 'ci', 'test-deadlock-lock-orders-r5.py');
    expect(harness).toContain('    prove_hand_bank_never_waits_on_the_union_pool()\n');
    expect(harness).toContain(
      'AFTER, the BBJ hand envelope completes while the pool and the wallet are held'
    );
    expect(harness).toContain("'equal the uncontended reference exactly'");
    const workflow = read('.github', 'workflows', 'deadlock-lock-orders-r5.yml');
    for (const f of [PART1, SWITCH]) expect(workflow).toContain(`supabase/migrations/${f}`);
    expect(workflow).toContain('scripts/ci/fixtures/hand-bank-pending/**');
  });
});
