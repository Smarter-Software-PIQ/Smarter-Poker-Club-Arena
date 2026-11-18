import { expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * NO OVERLAY CHIPS BEFORE THE ENTRY PERIOD ENDS (owner law, Dan 2026-11-14:
 * "NO CHIPS ARE EVER EVER EVER SUPPOSED TO GO TO ANY TOURNAMENT 'FOR
 * OVERLAYS' UNTIL THE REGISTRATION / REBUY / ADD ON PERIOD HAS OFFICALLY
 * ENDED"), on real isolated PostgreSQL.
 *
 * The five functions the migrations read or replace are installed from the
 * images captured from production on 2026-11-14 (fixtures/guarantee-entry-
 * close). Their callees are small stubs. Both migrations are installed: the
 * function migration (20261114161610) and the daily-window trigger
 * (20261114161611).
 */
const FIX = 'tests/unit/fixtures/guarantee-entry-close';
const M1 =
  'supabase/migrations/20261114161610_a_guarantee_moves_no_chips_until_every_entry_window_closes.sql';
const M2 =
  'supabase/migrations/20261114161611_the_ledger_refuses_overlay_chips_before_entry_close.sql';

const UNION = 'fade0000-0000-0000-0000-000000000001';
const CLUB = 'c1000000-0000-0000-0000-000000000001';

const STUB = `
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $r$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE TABLE public.clubs (id uuid PRIMARY KEY, asset text DEFAULT 'chips', chip_treasury numeric DEFAULT 0, updated_at timestamptz);
CREATE TABLE public.union_wallets (union_id uuid PRIMARY KEY, chip_balance numeric DEFAULT 0, promo_wallet numeric DEFAULT 0, updated_at timestamptz);
CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY, name text, status text, club_id uuid, union_id uuid, is_private boolean DEFAULT false,
  prize_pool numeric DEFAULT 0, prize_pool_finalized boolean DEFAULT false, guaranteed_prize numeric DEFAULT 0,
  bounty_pool numeric DEFAULT 0, late_reg_levels integer, rebuy_levels integer, late_reg_mins integer DEFAULT 0,
  current_level integer DEFAULT 0, started_at timestamptz, add_on_available boolean DEFAULT false,
  addon_from_start boolean DEFAULT false, addon_period_started_at timestamptz, addon_period_ends_at timestamptz,
  addon_period_triggered boolean DEFAULT false, is_rebuy boolean DEFAULT false, is_reentry boolean DEFAULT false,
  max_players integer, satellite_seats integer DEFAULT 0, variant text, tournament_type text DEFAULT 'MTT',
  satellite_target_id uuid, satellite_target uuid, buy_in_amount numeric DEFAULT 0, buy_in_fee numeric DEFAULT 0,
  payout_structure text, payout_depth_percent numeric, payout_percent numeric, is_mystery_bounty boolean DEFAULT false);
CREATE TABLE public.tournament_players (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, rebuys integer DEFAULT 0, status text DEFAULT 'playing');
CREATE TABLE public.tournament_escrow (tournament_id uuid PRIMARY KEY, prize_balance numeric DEFAULT 0, enforced boolean DEFAULT true);
CREATE TABLE public.chip_ledger (
  id bigserial PRIMARY KEY, performed_by uuid, from_type text, from_entity_id uuid, from_label text,
  to_type text, to_entity_id uuid, to_label text, amount numeric, category text, club_id uuid, tournament_id uuid,
  idempotency_key text, description text, metadata jsonb, status text DEFAULT 'posted', created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX chip_ledger_key ON public.chip_ledger (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE public.alerts (sev text, src text, msg text);
CREATE TABLE public.ca_declared_money_triggers (table_name text, trigger_name text, note text);
CREATE TABLE public.ca_money_rpc_registry (proname text PRIMARY KEY, status text, notes text);
-- The production money-function registry guard (ab_ca_money_rpc_registered),
-- so the install proves every function that writes a balance is registered.
CREATE FUNCTION public.fn_ca_money_rpc_balance_columns() RETURNS text[] LANGUAGE sql AS $$
  SELECT ARRAY['chip_balance','held_chips','locked_chips','credit_used','stack','balance','chips','prize','bounty_winnings','chip_treasury','promo_wallet'] $$;
CREATE FUNCTION public.fn_ca_money_rpc_writes_balances(p_src text) RETURNS boolean LANGUAGE sql AS $$
  SELECT COALESCE(
    p_src ~* 'UPDATE\s+(public\.)?(club_members|club_wallets|union_wallets|unions|table_seats|bbj_pools|clubs|agents|wallets|spin_bonus_pools|tournament_players)\y'
    OR p_src ~* 'INSERT\s+INTO\s+(public\.)?(club_members|club_wallets|union_wallets|unions|bbj_pools|clubs|agents|wallets|spin_bonus_pools)\y', false)
  AND COALESCE(p_src ~* ('\y(' || array_to_string(public.fn_ca_money_rpc_balance_columns(), '|') || ')\y'), false) $$;
CREATE FUNCTION public.fn_ca_money_rpc_registry_guard() RETURNS event_trigger LANGUAGE plpgsql AS $$
DECLARE obj record; v_name text; v_src text;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    IF obj.object_type <> 'function' OR obj.schema_name IS DISTINCT FROM 'public' THEN CONTINUE; END IF;
    SELECT p.proname, p.prosrc INTO v_name, v_src FROM pg_proc p WHERE p.oid = obj.objid AND p.prokind = 'f';
    IF v_name IS NULL OR NOT public.fn_ca_money_rpc_writes_balances(v_src) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.ca_money_rpc_registry g WHERE g.proname = v_name) THEN CONTINUE; END IF;
    RAISE EXCEPTION 'REFUSED: % writes balance columns and is not in ca_money_rpc_registry', v_name;
  END LOOP;
END $$;

CREATE FUNCTION public.fn_ca_tournament_is_unlimited(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.fn_ca_lock_settlement_lane_for_tournament(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.fn_raise_server_financial_alert(text, text, text, jsonb, text) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.alerts VALUES ($1, $2, $3) $$;
CREATE FUNCTION public.fn_tournament_payout_terms_committed_v1(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_ca_place_guarantee(numeric, numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT coalesce($1, 0) $$;
CREATE FUNCTION public.fn_ca_guarantee_place_floor(uuid, numeric, numeric, numeric) RETURNS numeric
  LANGUAGE sql AS $$ SELECT coalesce($3, 0) $$;
CREATE FUNCTION public.fn_ca_return_excess_start_overlay_locked(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
CREATE FUNCTION public.fn_ca_fund_free_buy_at_cutoff_locked(uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
CREATE FUNCTION public.fn_ca_return_excess_guarantee_promo_locked(uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
CREATE FUNCTION public.fn_ca_fund_union_guarantee_promo_locked(uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
-- The guarantee core: fund max(0, G - pool) from the union bank, journal it, finalize.
CREATE FUNCTION public.fn_ca_apply_prize_guarantee_core(p_tournament_id uuid, p_source text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t public.tournaments%ROWTYPE; v numeric; e numeric;
BEGIN
  SELECT * INTO t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  v := round(greatest(0, coalesce(t.guaranteed_prize, 0) - coalesce(t.prize_pool, 0)), 2);
  IF v > 0 THEN
    UPDATE public.union_wallets SET chip_balance = chip_balance - v WHERE union_id = t.union_id;
    INSERT INTO public.chip_ledger (from_type, from_entity_id, to_type, to_entity_id, amount, category, club_id, tournament_id, idempotency_key)
    VALUES ('union_bank', t.union_id, 'prize_liability', t.id, v, 'overlay', t.club_id, t.id, 'tourney:' || t.id || ':guarantee_overlay');
    INSERT INTO public.tournament_escrow (tournament_id, prize_balance) VALUES (t.id, v)
      ON CONFLICT (tournament_id) DO UPDATE SET prize_balance = public.tournament_escrow.prize_balance + v;
  END IF;
  UPDATE public.tournaments SET prize_pool = prize_pool + v, prize_pool_finalized = true WHERE id = t.id;
  SELECT prize_balance INTO e FROM public.tournament_escrow WHERE tournament_id = t.id;
  RETURN jsonb_build_object('ok', true, 'prize_pool', t.prize_pool + v, 'overlay', v,
    'bank_type', 'union', 'bank_entity_id', t.union_id, 'escrow_after', e);
END $$;
CREATE FUNCTION public.fn_finalize_tournament_entry_pool_locked(p_tournament_id uuid, p_source text, p_close_mode text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  r := public.fn_apply_prize_guarantee(p_tournament_id, p_source);
  IF coalesce((r->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Entry close could not fund/finalize its prize pool: %', r->>'reason';
  END IF;
  RETURN r || jsonb_build_object('entry_closed', true, 'finalized', true, 'close_mode', p_close_mode);
END $$;
`;

it('moves no guarantee chips until registration, rebuys and the add-on have all ended', () => {
  const root = resolve(__dirname, '../..');
  const bin = [
    '/opt/homebrew/bin',
    '/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/bin',
  ].find((dir) => ['initdb', 'pg_ctl', 'psql'].every((name) => existsSync(`${dir}/${name}`)));
  if (!bin)
    throw new Error('PostgreSQL binaries are required for the guarantee entry-close regression');
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const serverUser = 'nobody';
  const cache = asRoot ? tmpdir() : resolve(root, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(resolve(cache, 'guarantee-entry-close-'));
  if (asRoot) chmodSync(scratch, 0o777);
  const port = 20000 + Math.floor(Math.random() * 30000);
  const data = resolve(scratch, 'data');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LC_ALL: process.env.LC_ALL || 'C',
    PGHOST: '127.0.0.1',
    PGPORT: String(port),
    PGDATABASE: 'postgres',
    PGUSER: asRoot ? serverUser : process.env.USER || 'runner',
    PGSSLMODE: 'disable',
  };
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  const server = (cmd: string) => cmd === 'initdb' || cmd === 'pg_ctl';
  const run = (cmd: string, args: string[], input?: string) =>
    asRoot && server(cmd)
      ? execFileSync('runuser', ['-u', serverUser, '--', `${bin}/${cmd}`, ...args], {
          cwd: scratch,
          env,
          input,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      : execFileSync(`${bin}/${cmd}`, args, {
          cwd: root,
          env,
          input,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
  const sql = (text: string) => run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q'], text);
  const one = (text: string) =>
    run('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', text]).trim();
  const fixture = (name: string) =>
    readFileSync(resolve(root, FIX, `installed-${name}.sql`), 'utf8');
  let started = false;
  try {
    run('initdb', ['-D', data, '-A', 'trust']);
    run('pg_ctl', [
      '-D',
      data,
      '-l',
      resolve(scratch, 'postgres.log'),
      '-o',
      `-p ${port} -h 127.0.0.1 -k ''`,
      '-w',
      'start',
    ]);
    started = true;
    sql(STUB);
    for (const name of ['late', 'rebuy', 'close', 'apply', 'lock']) sql(`${fixture(name)};`);
    sql(`CREATE TRIGGER zz_ca_fund_overlay_on_lock BEFORE UPDATE OF status ON public.tournaments
           FOR EACH ROW EXECUTE FUNCTION public.fn_ca_fund_overlay_on_lock();`);
    sql(`INSERT INTO ca_money_rpc_registry (proname, status) VALUES
           ('fn_apply_prize_guarantee', 'approved'), ('fn_ca_fund_overlay_on_lock', 'approved'),
           ('fn_ca_apply_prize_guarantee_core', 'approved');
         CREATE EVENT TRIGGER ab_ca_money_rpc_registered ON ddl_command_end
           EXECUTE FUNCTION public.fn_ca_money_rpc_registry_guard();`);
    sql(`INSERT INTO clubs (id, chip_treasury) VALUES ('${CLUB}', 100000);
         INSERT INTO union_wallets (union_id, chip_balance) VALUES ('${UNION}', 100000);`);

    // The guard refuses an installed image it was not written against.
    const m1 = readFileSync(resolve(root, M1), 'utf8');
    const md5 = (fn: string) => one(`SELECT md5(pg_get_functiondef('${fn}'::regprocedure))`);
    const live = {
      close: md5('public.fn_close_tournament_entry_window(uuid,text)'),
      apply: md5('public.fn_apply_prize_guarantee(uuid,text)'),
      lock: md5('public.fn_ca_fund_overlay_on_lock()'),
    };
    sql(`CREATE OR REPLACE FUNCTION public.fn_close_tournament_entry_window(p_tournament_id uuid, p_source text DEFAULT 'x'::text)
         RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
    expect(() => sql(m1)).toThrow(/GUARANTEE_ENTRY_CLOSE_SOURCE_CHANGED/);
    sql(`${fixture('close')};`);
    const pointed = m1
      .replace('5ed928768855a0a51aafd8c2132dcef4', live.close)
      .replace('b7d1bbad342cb57717d8b6f24be03e08', live.apply)
      .replace('8d9f9f1d6f6806bac9aec0202de08997', live.lock);
    sql(pointed);
    sql(readFileSync(resolve(root, M2), 'utf8'));
    // The money-moving function is registered before it exists.
    expect(
      one(
        `SELECT status FROM ca_money_rpc_registry WHERE proname='fn_ca_fund_satellite_seats_at_close_locked'`
      )
    ).toBe('approved');

    const ev = (id: string, cols: string) =>
      sql(`INSERT INTO tournaments (id, name, club_id, union_id, ${cols.split('|')[0]})
           VALUES ('${id}', 'event ${id.slice(0, 4)}', '${CLUB}', '${UNION}', ${cols.split('|')[1]});`);
    const legs = (id: string) =>
      Number(
        one(
          `SELECT count(*) FROM chip_ledger WHERE to_entity_id='${id}' AND category IN ('overlay','promo_send')`
        )
      );
    const houseLeg = (id: string, key = 'NULL') =>
      sql(`INSERT INTO chip_ledger (from_type, from_entity_id, to_type, to_entity_id, amount, category, tournament_id, idempotency_key)
           VALUES ('union_bank', '${UNION}', 'prize_liability', '${id}', 10, 'overlay', '${id}', ${key});`);

    // 1. The Bankroll Builder shape: 9 late-registration levels, 12 rebuy
    //    levels, no add-on. Late registration closes at 9; the pool does not.
    const BB = 'b0000000-0000-0000-0000-000000000001';
    ev(
      BB,
      `status, late_reg_levels, rebuy_levels, current_level, is_rebuy, guaranteed_prize, prize_pool, started_at|'RUNNING', 9, 12, 9, true, 1000, 600, now() - interval '2 hours'`
    );
    // Level 8: registration is still open; the pool is open for that reason.
    sql(`UPDATE tournaments SET current_level = 8 WHERE id='${BB}';`);
    expect(one(`SELECT fn_tournament_late_registration_open('${BB}')`)).toBe('t');
    const stillEntering = JSON.parse(
      one(`SELECT fn_close_tournament_entry_window('${BB}', 'engine.test')`)
    );
    expect(stillEntering).toMatchObject({ ok: true, entry_closed: false });
    expect(stillEntering.reason).toBeUndefined();
    // Level 9: registration stops at its configured deadline.
    sql(`UPDATE tournaments SET current_level = 9 WHERE id='${BB}';`);
    expect(one(`SELECT fn_tournament_late_registration_open('${BB}')`)).toBe('f');
    const deferred = JSON.parse(
      one(`SELECT fn_close_tournament_entry_window('${BB}', 'engine.test')`)
    );
    expect(deferred).toMatchObject({ ok: true, entry_closed: false, reason: 'rebuy_window_open' });
    expect(one(`SELECT prize_pool_finalized FROM tournaments WHERE id='${BB}'`)).toBe('f');
    expect(legs(BB)).toBe(0);
    expect(
      JSON.parse(one(`SELECT fn_apply_prize_guarantee('${BB}', 'engine.test')`))
    ).toMatchObject({
      ok: false,
      reason: 'entry_period_open',
    });
    expect(legs(BB)).toBe(0);
    expect(() => houseLeg(BB)).toThrow(/GUARANTEE_CHIPS_BEFORE_ENTRY_CLOSE/);
    // A rebuy is still possible at level 10 and 11.
    expect(JSON.parse(one(`SELECT fn_ca_tournament_rebuy_window('${BB}')`)).open).toBe(true);
    // Level 12: the rebuy window closes and the guarantee is funded once.
    sql(`UPDATE tournaments SET current_level = 12 WHERE id='${BB}';`);
    const closed = JSON.parse(
      one(`SELECT fn_close_tournament_entry_window('${BB}', 'engine.test')`)
    );
    expect(closed).toMatchObject({ ok: true, entry_closed: true, finalized: true, overlay: 400 });
    expect(legs(BB)).toBe(1);
    expect(Number(one(`SELECT prize_pool FROM tournaments WHERE id='${BB}'`))).toBe(1000);
    // Retries, restarts and duplicate calls fund nothing a second time.
    expect(JSON.parse(one(`SELECT fn_apply_prize_guarantee('${BB}', 'engine.test')`)).ok).toBe(
      true
    );
    expect(
      JSON.parse(one(`SELECT fn_close_tournament_entry_window('${BB}', 'engine.test')`)).ok
    ).toBe(true);
    expect(legs(BB)).toBe(1);
    expect(Number(one(`SELECT prize_pool FROM tournaments WHERE id='${BB}'`))).toBe(1000);
    // Once the pool is final, no rebuy is offered.
    expect(JSON.parse(one(`SELECT fn_ca_tournament_rebuy_window('${BB}')`)).open).toBe(false);

    // 2. An add-on event ends at the actual add-on end, not before.
    const AO = 'a0000000-0000-0000-0000-000000000001';
    ev(
      AO,
      `status, late_reg_levels, rebuy_levels, current_level, is_rebuy, add_on_available, addon_period_triggered, addon_period_started_at, addon_period_ends_at, guaranteed_prize, prize_pool, started_at|'RUNNING', 10, 12, 10, true, true, true, now(), now() + interval '1 minute', 20000, 12000, now() - interval '2 hours'`
    );
    expect(one(`SELECT fn_ca_guarantee_entry_period_ended('${AO}')`)).toBe('f');
    // Rebuys and late registration stay open through the actual add-on end.
    expect(JSON.parse(one(`SELECT fn_ca_tournament_rebuy_window('${AO}')`)).open).toBe(true);
    expect(() => houseLeg(AO)).toThrow(/GUARANTEE_CHIPS_BEFORE_ENTRY_CLOSE/);
    expect(
      JSON.parse(one(`SELECT fn_apply_prize_guarantee('${AO}', 'engine.addon_period_end')`)).reason
    ).toBe('entry_period_open');
    sql(
      `UPDATE tournaments SET addon_period_ends_at = now() - interval '1 second' WHERE id='${AO}';`
    );
    expect(one(`SELECT fn_ca_guarantee_entry_period_ended('${AO}')`)).toBe('t');
    expect(
      JSON.parse(one(`SELECT fn_apply_prize_guarantee('${AO}', 'engine.addon_period_end')`))
    ).toMatchObject({
      ok: true,
      overlay: 8000,
    });

    // 3. A registering event has not started its period; a completed one has
    //    ended it (a later correction may post); a Free Buy entry's bounty
    //    part booked at sign-up is entry funding, not an overlay.
    const RG = 'c0000000-0000-0000-0000-000000000001';
    ev(RG, `status, late_reg_levels, guaranteed_prize|'REGISTERING', 6, 500`);
    expect(() => houseLeg(RG)).toThrow(/GUARANTEE_CHIPS_BEFORE_ENTRY_CLOSE/);
    houseLeg(RG, `'tourney:${RG}:promo_head:${'d'.repeat(8)}'`);
    expect(legs(RG)).toBe(1);
    const CP = 'c0000000-0000-0000-0000-000000000002';
    ev(
      CP,
      `status, late_reg_levels, guaranteed_prize, prize_pool_finalized|'COMPLETED', 6, 500, true`
    );
    houseLeg(CP);
    expect(legs(CP)).toBe(1);

    // 4. The settlement authorities close a finished event even when it
    //    finished inside its late-registration levels.
    const EF = 'e0000000-0000-0000-0000-000000000001';
    ev(
      EF,
      `status, late_reg_levels, current_level, guaranteed_prize, prize_pool, started_at|'RUNNING', 9, 3, 300, 100, now()`
    );
    expect(one(`SELECT fn_ca_guarantee_entry_period_ended('${EF}')`)).toBe('f');
    expect(
      JSON.parse(
        one(`SELECT fn_apply_prize_guarantee('${EF}', 'engine.fn_settle_tournament_places')`)
      )
    ).toMatchObject({
      ok: true,
      overlay: 200,
    });

    // 5. A satellite with late registration is not funded at its start; its
    //    seats are funded at its close. One with no entry period after the
    //    start is funded at the start, which is its close.
    const TGT = 'f0000000-0000-0000-0000-000000000009';
    ev(TGT, `status, buy_in_amount, buy_in_fee|'REGISTERING', 45, 5`);
    const SW = 'f0000000-0000-0000-0000-000000000001';
    ev(
      SW,
      `status, variant, tournament_type, satellite_seats, satellite_target_id, late_reg_levels, prize_pool|'REGISTERING', 'satellite', 'SATELLITE', 3, '${TGT}', 5, 60`
    );
    sql(`UPDATE tournaments SET status='RUNNING', started_at=now() WHERE id='${SW}';`);
    expect(legs(SW)).toBe(0);
    expect(Number(one(`SELECT prize_pool FROM tournaments WHERE id='${SW}'`))).toBe(60);
    sql(`UPDATE tournaments SET current_level = 5 WHERE id='${SW}';`);
    const sat = JSON.parse(one(`SELECT fn_close_tournament_entry_window('${SW}', 'engine.test')`));
    expect(sat).toMatchObject({ ok: true, entry_closed: true, finalized: true });
    expect(
      one(
        `SELECT amount FROM chip_ledger WHERE idempotency_key='tourney:${SW}:satellite_seat_overlay'`
      )
    ).toBe('90.00');
    expect(Number(one(`SELECT prize_pool FROM tournaments WHERE id='${SW}'`))).toBe(150);
    expect(JSON.parse(one(`SELECT fn_apply_prize_guarantee('${SW}', 'engine.test')`)).ok).toBe(
      true
    );
    expect(one(`SELECT fn_ca_fund_satellite_seats_at_close_locked('${SW}')`)).toBe('0');
    expect(legs(SW)).toBe(1);
    expect(Number(one(`SELECT prize_pool FROM tournaments WHERE id='${SW}'`))).toBe(150);

    const SN = 'f0000000-0000-0000-0000-000000000002';
    ev(
      SN,
      `status, variant, tournament_type, satellite_seats, satellite_target_id, late_reg_levels, rebuy_levels, prize_pool|'REGISTERING', 'satellite', 'SATELLITE', 2, '${TGT}', 0, 4, 40`
    );
    sql(`UPDATE tournaments SET status='RUNNING', started_at=now() WHERE id='${SN}';`);
    expect(legs(SN)).toBe(1);
    expect(Number(one(`SELECT prize_pool FROM tournaments WHERE id='${SN}'`))).toBe(100);
  } finally {
    if (started) {
      try {
        run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']);
      } catch {
        // already stopped
      }
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);
