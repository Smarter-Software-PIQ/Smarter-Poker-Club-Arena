/**
 * THE FOUR PLAYED CERT HU CLUBS RETIRE WITH THEIR OWNERS (Dan, 2026-11-14)
 *
 * "REMOVE ANY AND ALL POSTDEPLOY TEST ACCOUNTS ACROSS THE POKER ARENA."
 *
 * Four reserved post-deploy identities remained, each the owner of a heads-up
 * rematch certification club whose run died on 2026-11-09. No door retires a
 * certification club after a Sit & Go was played (the welcome unwind refuses
 * it), so this is a one-time settlement of exactly these four ids. The law pins
 * the ids, every proof taken before anything moves, the platform doors the
 * settlement goes through, and the exact chips retired.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'supabase/migrations';
const name = readdirSync(dir).filter((file) =>
  file.endsWith('_the_four_played_cert_hu_clubs_retire_with_their_owners.sql')
);
if (name.length !== 1) throw new Error('Expected One Cert HU Retirement Migration');
const sql = readFileSync(`${dir}/${name[0]}`, 'utf8');
const code = sql.replace(/^--[^\n]*$/gm, '');

const CLUBS: Array<[string, string, string, string]> = [
  [
    '17b36e27-0671-404e-8d92-308e4ee69b8a',
    'Cert HU 12100714',
    'c18acfca-d33b-4ef8-a280-ba90a4d94e40',
    '99699.80',
  ],
  [
    '5db856cf-7a83-4a7e-9ed1-2ee4a83f141c',
    'Cert HU 05448714',
    'b6424182-88d2-46a7-a3d4-e7ea68ead245',
    '99700.00',
  ],
  [
    'e5d50964-7f44-47fe-948c-81bb8d633f25',
    'Cert HU 08278575',
    '54d534d6-5984-471b-86b2-5b9ff37cafc3',
    '99700.00',
  ],
  [
    'f5eebc0e-00f3-467c-b753-79cfebcaeda0',
    'Cert HU 10629595',
    '57bca7de-9099-47c2-8364-eba25cbf1ff7',
    '99699.90',
  ],
];

describe('the four played cert hu clubs retire with their owners', () => {
  it('is one transaction with short limits that never queues for the settlement lane', () => {
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(code).toContain("SET LOCAL lock_timeout = '1s';");
    expect(code).toContain("SET LOCAL statement_timeout = '60s';");
    expect(code).toContain(
      "pg_try_advisory_xact_lock(hashtextextended('ca:tournament-terminal-settlement:v1', 0))"
    );
    expect(code).toContain(
      "pg_try_advisory_xact_lock(hashtextextended('ca:hand-settlement-barrier:v1', 0))"
    );
    expect(code).toContain('CERT_HU_PLATFORM_FROZEN');
  });

  it('settles exactly these four clubs, owners and measured treasuries', () => {
    for (const [club, clubName, owner, treasury] of CLUBS) {
      expect(code).toContain(
        `('${club}'::uuid, '${clubName}', '${owner}'::uuid, ${treasury}::numeric)`
      );
    }
    expect(code.match(/'Cert HU \d{8}'/g)).toHaveLength(4);
    expect(code).toContain('v_retired_total IS DISTINCT FROM 399999.70::numeric');
  });

  it('proves identity, membership, custody, seats, games and pools before anything moves', () => {
    for (const refusal of [
      'CERT_HU_IDENTITY_REFUSED',
      'CERT_HU_OWNER_REFUSED',
      'CERT_HU_UNION_REFUSED',
      'CERT_HU_BANK_CHANGED',
      'CERT_HU_MEMBERSHIP_REFUSED',
      'CERT_HU_CUSTODY_REFUSED',
      'CERT_HU_SEATED_REFUSED',
      'CERT_HU_LIVE_GAME_REFUSED',
      'CERT_HU_POOLS_NOT_PRISTINE',
    ]) {
      expect(code).toContain(refusal);
    }
    expect(code).toContain("v_club.name NOT LIKE 'Cert HU %'");
    expect(code).toContain("v_email NOT LIKE 'ca-customization-cert-postdeploy-%@example.invalid'");
    expect(code).toContain('NOT public.fn_ca_reserved_certification_identity(m.user_id)');
  });

  it("goes through the platform's own doors and retires the estate to chip_retirement", () => {
    expect(code).toContain('public.atomic_cancel_tournament(v_t, c.owner_id)');
    expect(code).toContain('public.fn_spin_deactivate(c.club_id, c.owner_id)');
    expect(code).toContain(
      "public.fn_spin_move_owner_wallet(c.club_id, 'club', 'chip_treasury', 100)"
    );
    expect(code).toContain(
      "public.fn_ca_declare_ledger('burn', 'chip_retirement', NULL, NULL, v_key, NULL)"
    );
    expect(code).toContain("v_key := 'cert-hu-retire:' || c.club_id::text;");
    expect(code).toContain('CERT_HU_BURN_UNPROVEN');
    expect(code).toContain('CERT_HU_IMPACT_NOT_ZERO');
    expect(code).toContain('public.fn_retire_settled_club_core_20260906(c.club_id, c.club_name,');
  });

  it('deletes each owner with no actor claim, after its club holds nothing', () => {
    const deletion = code.indexOf("UPDATE public.profiles SET status = 'deleted'");
    const burn = code.indexOf("fn_ca_declare_ledger('burn', 'chip_retirement'");
    const core = code.indexOf('fn_retire_settled_club_core_20260906(c.club_id');
    expect(deletion).toBeGreaterThan(burn);
    expect(core).toBeGreaterThan(deletion);
    expect(code.slice(burn, deletion)).toContain(
      "PERFORM set_config('request.jwt.claims', COALESCE(v_prior_claims, ''), true);"
    );
    expect(code).toContain('CERT_HU_OWNER_NOT_RETIRED');
    expect(code).toContain('CERT_HU_FINAL_STATE');
  });
});
