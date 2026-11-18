/**
 * LAW: A CASH HAND NEVER WAITS ON THE UNION WALLET ROW
 *
 * Owner ruling, 2026-11-17: a tournament problem must be isolated and must
 * never affect another tournament or a cash game.
 *
 * That evening a tournament settlement held Midway Union's one union_wallets
 * row for 45 s per attempt for 90 minutes. Every cash hand's post-commit
 * envelope banked its rake by updating that same row
 * (fn_ca_process_hand_post_commit_obligations -> atomic_distribute_rake), so
 * every cash table waited on it: 2,676 statement timeouts in 25 minutes.
 *
 * 20261118035606 took the wallet out of the envelope's rake step. The envelope
 * stores the obligation in cash_rake_pending and the hand's own projection
 * continuation banks it with the unchanged atomic_distribute_rake call, never
 * waiting for the wallet (20261118034950). This law pins, from the files:
 *
 *   1. the envelope the switch produces from the production text: it is the
 *      pinned postimage, its rake step stores the obligation, it does not call
 *      atomic_distribute_rake and writes no union_wallets row itself;
 *   2. every public function that postimage calls. The list is closed, so a
 *      new callee is a reviewed change. One of them still writes the wallet
 *      row: record_insurance_transaction (insurance_wallet, insured hands
 *      only). It is named here as the one open exposure, not excused;
 *   3. the banker asks for the wallet row NOWAIT before it banks, and the
 *      continuation runs it before any table or player lock is taken;
 *   4. nothing here is driven by a timer (CLAUDE.md 10.12);
 *   5. no later migration puts the call back into the envelope;
 *   6. the two-session proof on real PostgreSQL stays wired
 *      (scripts/ci/test-deadlock-lock-orders-r5.py).
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const PART1 = '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall.sql';
const SWITCH = '20261118035606_a_cash_hand_never_waits_on_a_tournament_wallet_lock.sql';
const ENVELOPE = 'fn_ca_process_hand_post_commit_obligations';
const PRE = '8b81e8bb218cacb235832285e4fbbb24';
const POST = 'da123635a0f1cdb035bd9b518ebf07f0';

const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
/** SQL with comments blanked: behaviour cannot live in one. */
const code = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const dollar = (sql: string, tag: string) => {
  const parts = sql.split(`$${tag}$`);
  expect(parts.length, `exactly one $${tag}$ block`).toBe(3);
  return parts[1];
};
const WRITES_UNION_WALLETS =
  /(insert\s+into|update|delete\s+from)\s+(only\s+)?(public\.)?union_wallets\b/i;

const part1 = read('supabase', 'migrations', PART1);
const sw = read('supabase', 'migrations', SWITCH);
const fixture = JSON.parse(
  read('scripts', 'ci', 'fixtures', 'cash-rake-pending', 'live-definitions.json')
) as { functions: Record<string, { md5: string; definition: string }> };
const live = fixture.functions[ENVELOPE].definition;
const removed = dollar(sw, 'oenv0');
const added = dollar(sw, 'nenv0');
const postimage = live.replace(removed, added);

describe('a cash hand never waits on the union wallet row', () => {
  it('the switch turns the production envelope into the pinned postimage', () => {
    expect(md5(live)).toBe(PRE);
    expect(live.split(removed).length, 'the anchor occurs exactly once').toBe(2);
    expect(md5(postimage)).toBe(POST);
    expect(sw).toContain(`'${PRE}', '${POST}'`);
  });

  it('the rake step stores the obligation instead of banking it', () => {
    expect(code(removed)).toMatch(/public\.atomic_distribute_rake\s*\(/);
    expect(code(added)).not.toMatch(/atomic_distribute_rake\s*\(/);
    expect(code(added)).toMatch(
      /INSERT INTO public\.cash_rake_pending \(hand_id, table_id, hand_number, amount, rake\)[\s\S]*ON CONFLICT \(hand_id\) DO NOTHING;/
    );
  });

  it('the envelope neither calls atomic_distribute_rake nor writes union_wallets itself', () => {
    const body = code(postimage);
    expect(body).not.toMatch(/atomic_distribute_rake\s*\(/);
    expect(body).not.toMatch(WRITES_UNION_WALLETS);
  });

  it('the envelope calls a closed list of functions, and the one that still takes the wallet row is named', () => {
    // A call, not an INSERT's column list or the function's own header.
    const body = code(postimage);
    const callees = [
      ...new Set(
        [...body.matchAll(/\b(?:public|smarter_private)\.([a-z_0-9]+)\s*\(/g)]
          .filter((m) => !/(INSERT INTO|FUNCTION)\s+$/.test(body.slice(0, m.index)))
          .map((m) => m[1])
      ),
    ].sort();
    expect(callees).toEqual([
      'bbj_record_contribution',
      'f06_wait_table_lane',
      'fn_platform_frozen',
      'fn_union_pnl_certify_posthand_escrow',
      'fn_union_pnl_prove_posthand_escrow',
      'original_inventory_proof_sources_match',
      'posthand_escrow_original_snapshot',
      'promo_apply_playthrough',
      // OPEN EXPOSURE, NOT RAKE: updates union_wallets.insurance_wallet for an
      // insured hand. Read on production 2026-11-18, it is the only function
      // reachable from this envelope that writes a union_wallets row.
      'record_insurance_transaction',
      'resolve_pending_addon',
    ]);
  });

  it('the banker never waits for the wallet row, and banks with the unchanged call', () => {
    const banker = code(
      dollar(part1.split('CREATE FUNCTION public.fn_ca_bank_pending_cash_rake')[1], 'fn')
    );
    const nowait = banker.search(
      /FROM public\.union_wallets w\s+WHERE w\.union_id = v_union\s+FOR NO KEY UPDATE NOWAIT;/
    );
    const call = banker.search(/FROM public\.atomic_distribute_rake\s*\(/);
    const gone = banker.search(
      /DELETE FROM public\.cash_rake_pending c WHERE c\.hand_id = p_hand_id;/
    );
    expect(nowait).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(nowait);
    expect(gone).toBeGreaterThan(call);
    expect(banker).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(banker).toMatch(
      /WHEN lock_not_available THEN\s+RETURN jsonb_build_object\('status', 'busy'/
    );
    expect(banker).not.toMatch(WRITES_UNION_WALLETS);
    expect(code(part1)).not.toMatch(/CREATE OR REPLACE FUNCTION public\.atomic_distribute_rake/);
  });

  it('the continuation banks before it takes any table or player lock, and ends its pass', () => {
    const projection = dollar(part1, 'nproj0');
    const bank = projection.indexOf('public.fn_ca_bank_pending_cash_rake(p_hand_id)');
    const lane = projection.indexOf('LOCK ORDER 1b');
    expect(bank).toBeGreaterThan(-1);
    expect(lane).toBeGreaterThan(bank);
    expect(code(projection.slice(0, lane))).toMatch(/'reason', 'predecessor_pending'/);
    expect(code(projection.slice(0, lane))).not.toMatch(
      /pg_advisory_xact_lock|f06_wait_table_lane/
    );
    // The outbox row is that continuation: it may not leave while the rake is pending.
    expect(code(dollar(part1, 'ntrg0'))).toMatch(
      /fn_ca_bank_pending_cash_rake\(OLD\.hand_id\);\s+IF v_result->>'status' IS DISTINCT FROM 'banked' THEN\s+RAISE EXCEPTION/
    );
  });

  it('a stored rake is on the felt in the tally and in both meters', () => {
    expect(code(dollar(part1, 'ntally0'))).toMatch(
      /WHEN 'cash_rake_pending' THEN\s+k_old := 'table_stack'; k_new := 'table_stack';/
    );
    for (const tag of ['nsupply0', 'nacct0'])
      expect(code(dollar(part1, tag))).toMatch(
        /\+ \(SELECT COALESCE\(sum\(rp\.amount\), 0\)\s+FROM public\.cash_rake_pending rp/
      );
    expect(code(part1)).toMatch(
      /CREATE CONSTRAINT TRIGGER zz_ca_balance_has_its_ledger_row\s+AFTER INSERT OR UPDATE OF amount, table_id OR DELETE ON public\.cash_rake_pending\s+DEFERRABLE INITIALLY DEFERRED/
    );
  });

  it('no timer banks rake', () => {
    for (const sql of [part1, sw]) expect(code(sql)).not.toMatch(/cron\.(schedule|alter_job)/);
  });

  it('no later migration puts the call back into the envelope', () => {
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && f.slice(0, 14) > SWITCH.slice(0, 14))
      .filter((f) => {
        const sql = code(readFileSync(join(MIGRATIONS, f), 'utf8'));
        return sql.includes(ENVELOPE) && /atomic_distribute_rake\s*\(/.test(sql);
      });
    expect(
      later,
      'a migration after the switch names the hand envelope and calls atomic_distribute_rake. ' +
        'Rake is banked by fn_ca_bank_pending_cash_rake from the projection continuation, never by the envelope.'
    ).toEqual([]);
  });

  it('the two-session proof stays wired', () => {
    const harness = read('scripts', 'ci', 'test-deadlock-lock-orders-r5.py');
    expect(harness).toContain('prove_cash_rake_never_waits_on_the_union_wallet()');
    expect(harness).toContain('AFTER, the hand envelope completes while the wallet row is held');
    expect(harness).toContain("equal the '\n          'uncontended reference exactly'");
    const workflow = read('.github', 'workflows', 'deadlock-lock-orders-r5.yml');
    for (const f of [PART1, SWITCH]) expect(workflow).toContain(`supabase/migrations/${f}`);
  });
});
