/**
 * A HAND-WRITTEN CHIP CORRECTION RE-CHECKS AT INSTALL THAT NOBODY ALREADY
 * MADE THE PLAYER WHOLE (2026-11-23). See scripts/ci/migration-made-whole-guard.mjs.
 *
 * 20261123002808 was proven, merged, and waited about ninety minutes for an
 * install slot. In that gap the member's agent re-sent him the same 10.00 by
 * hand. The file refused only on its own idempotency keys and would have paid
 * him twice. This pins that a migration settling through
 * fn_ca_adjustment_under_10_9 declares, and carries, a refusal that reads the
 * ledger for a competing credit after the triggering event, and that the
 * exact held bytes are caught.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  MADE_WHOLE_CHECKED_FROM,
  MADE_WHOLE_HEADER,
  callsHandSettlementDoor,
  hasCompetingCreditRefusal,
  isMadeWholeChecked,
  madeWholeDeclarations,
  madeWholeGuardGaps,
} from '../scripts/ci/migration-made-whole-guard.mjs';

const ROOT = resolve(__dirname, '..');
const DIR = join(ROOT, 'supabase/migrations');
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
const GIVE_BACK = '20261123024924_the_promo_a_refund_took_goes_back_to_twin2983.sql';
const HELD = '20261123002808_the_promo_a_refund_took_goes_back_to_the_two_members.sql';
const X = '20261124000000_x.sql';

const DECLARED = `${MADE_WHOLE_HEADER} refuses if any promo credit from the union promo wallet reached the member after the refund`;
const OWN_KEYS = `  IF EXISTS (SELECT 1 FROM public.chip_ledger WHERE idempotency_key = 'k') THEN
    RAISE EXCEPTION 'this make-good already exists';
  END IF;`;
const REFUSAL = `  IF EXISTS (SELECT 1 FROM public.chip_ledger l
              WHERE l.to_type = 'player_wallet' AND l.to_entity_id = c_user
                AND l.category IN ('promo', 'promo_send') AND l.created_at > v_refund_at) THEN
    RAISE EXCEPTION 'promo from the same fund already reached this member after the refund';
  END IF;`;
const PAY =
  "  v_adj := public.fn_ca_adjustment_under_10_9(NULL, c_user, 5.25, 'why', 'mig', 'who');";
const file = (header: string, ...body: string[]) =>
  `-- ${X}\n--\n${header}\n--\nBEGIN;\nDO $settle$\nDECLARE v_adj uuid; v_refund_at timestamptz; c_user uuid;\nBEGIN\n${body.join('\n')}\nEND\n$settle$;\nCOMMIT;\n`;

describe('a hand settlement re-checks at install that nobody already made the player whole', () => {
  it('every hand settlement from the cut-over on declares and carries the re-check', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.sql') && isMadeWholeChecked(f));
    for (const f of files) expect(madeWholeGuardGaps(f, read(f)), f).toEqual([]);
  });

  it('catches the exact held bytes: its own keys only, no declaration, no re-check', () => {
    const sql = read(HELD);
    expect(callsHandSettlementDoor(sql)).toBe(true);
    expect(sql).toContain('IF EXISTS (SELECT 1 FROM public.chip_ledger WHERE idempotency_key');
    expect(hasCompetingCreditRefusal(sql)).toBe(false);
    expect(madeWholeDeclarations(sql)).toEqual([]);
    const gaps = madeWholeGuardGaps(HELD, sql);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toContain(MADE_WHOLE_HEADER);
    expect(gaps[1]).toContain('already made the player whole');
  });

  it('the replacement that ran carries the re-check; with the declaration it passes whole', () => {
    // 20261123024924 is installed and is not edited: it predates the header
    // line, so it sits below the cut-over. Its body is the worked example.
    const sql = read(GIVE_BACK);
    expect(isMadeWholeChecked(GIVE_BACK)).toBe(false);
    expect(callsHandSettlementDoor(sql)).toBe(true);
    expect(hasCompetingCreditRefusal(sql)).toBe(true);
    const gaps = madeWholeGuardGaps(GIVE_BACK, sql);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain(MADE_WHOLE_HEADER);
    expect(
      madeWholeGuardGaps(GIVE_BACK, sql.replace('\nBEGIN;\n', `\n${DECLARED}\n\nBEGIN;\n`))
    ).toEqual([]);
  });

  it('accepts a declared settlement that refuses on a credit after the event', () => {
    expect(madeWholeGuardGaps(X, file(DECLARED, OWN_KEYS, REFUSAL, PAY))).toEqual([]);
    // The bound may be written either way round, inclusive, and beside other conditions.
    const flipped = REFUSAL.replace('l.created_at > v_refund_at', 'v_refund_at <= l.created_at');
    expect(madeWholeGuardGaps(X, file(DECLARED, flipped, PAY))).toEqual([]);
    const joined = REFUSAL.replace('IF EXISTS', 'IF v_adj IS NULL AND EXISTS');
    expect(madeWholeGuardGaps(X, file(DECLARED, joined, PAY))).toEqual([]);
  });

  it('refuses a settlement that checks only its own idempotency keys', () => {
    const gaps = madeWholeGuardGaps(X, file(DECLARED, OWN_KEYS, PAY));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain('never re-checks, at install');
  });

  it('refuses a re-check with no declaration, a placeholder, a short one, two of them, or one after BEGIN', () => {
    for (const header of [
      '--',
      `${MADE_WHOLE_HEADER} <one sentence naming what is checked>`,
      `${MADE_WHOLE_HEADER} checked`,
      `${DECLARED}\n${DECLARED}`,
    ]) {
      const gaps = madeWholeGuardGaps(X, file(header, REFUSAL, PAY));
      expect(gaps, header).toHaveLength(1);
      expect(gaps[0]).toContain('exactly one header line');
    }
    const late = file('--', REFUSAL, PAY).replace('BEGIN;\nDO', `BEGIN;\n${DECLARED}\nDO`);
    expect(madeWholeGuardGaps(X, late)).toHaveLength(1);
  });

  it('refuses a ledger read that is not a refusal on a later credit', () => {
    const notRefusals = [
      // No time bound: it could only ever find rows it names.
      REFUSAL.replace(' AND l.created_at > v_refund_at', ''),
      // NOT EXISTS demands a row; it does not refuse on a competing one.
      REFUSAL.replace('IF EXISTS', 'IF NOT EXISTS'),
      // A bounded read of another table.
      REFUSAL.replace('public.chip_ledger', 'public.wallet_credit_idempotency'),
      // The read exists but nothing is refused.
      REFUSAL.replace(/RAISE EXCEPTION[^;]*;/, "RAISE NOTICE 'seen';"),
      // The read exists only in a comment or a message.
      `  -- IF EXISTS (SELECT 1 FROM public.chip_ledger l WHERE l.created_at > v_refund_at) THEN RAISE EXCEPTION 'x';
  RAISE NOTICE 'IF EXISTS (SELECT 1 FROM public.chip_ledger l WHERE l.created_at > x) THEN RAISE EXCEPTION';`,
    ];
    for (const body of notRefusals) {
      const gaps = madeWholeGuardGaps(X, file(DECLARED, body, PAY));
      expect(gaps, body).toHaveLength(1);
      expect(gaps[0]).toContain('never re-checks, at install');
    }
  });

  it('judges only files whose install calls the door', () => {
    const notCalls = [
      'BEGIN;\nUPDATE public.t SET a = 1;\nCOMMIT;\n',
      "BEGIN;\n-- public.fn_ca_adjustment_under_10_9(...) was used last time\nSELECT 'fn_ca_adjustment_under_10_9(';\nCOMMIT;\n",
      'BEGIN;\nREVOKE ALL ON FUNCTION public.fn_ca_adjustment_under_10_9(uuid, uuid, numeric, text, text, text) FROM PUBLIC;\nCOMMIT;\n',
      'BEGIN;\nDROP FUNCTION IF EXISTS public.fn_ca_adjustment_under_10_9(uuid, uuid, numeric, text, text, text);\nCOMMIT;\n',
      'BEGIN;\nCREATE OR REPLACE FUNCTION public.fn_wrapper() RETURNS uuid LANGUAGE plpgsql AS $function$\nBEGIN\n  RETURN public.fn_ca_adjustment_under_10_9(NULL, NULL, 1, $r$why$r$, $m$mig$m$, $w$who$w$);\nEND $function$;\nCOMMIT;\n',
    ];
    for (const sql of notCalls) {
      expect(callsHandSettlementDoor(sql), sql).toBe(false);
      expect(madeWholeGuardGaps(X, sql), sql).toEqual([]);
    }
    for (const sql of [
      'BEGIN;\nSELECT public.fn_ca_adjustment_under_10_9(NULL, NULL, 1, NULL, NULL, NULL);\nCOMMIT;\n',
      'BEGIN;\nDO $$ BEGIN PERFORM fn_ca_adjustment_under_10_9 (NULL, NULL, 1, NULL, NULL, NULL); END $$;\nCOMMIT;\n',
    ]) {
      expect(callsHandSettlementDoor(sql), sql).toBe(true);
      expect(madeWholeGuardGaps(X, sql), sql).toHaveLength(2);
    }
  });

  it('judges only from the cut-over on, so settled history is not re-judged', () => {
    expect(isMadeWholeChecked(`${MADE_WHOLE_CHECKED_FROM}_x.sql`)).toBe(true);
    expect(isMadeWholeChecked(HELD)).toBe(false);
    expect(
      isMadeWholeChecked('20261116231529_the_house_pays_the_verified_timed_out_final_two_head.sql')
    ).toBe(false);
  });

  it('the place an agent reads before settling says so', () => {
    const law = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
    const at = law.indexOf('## 10.9 YOU DECIDE THE MONEY');
    const section = law.slice(at, law.indexOf('\n## ', at + 10));
    expect(section).toContain(MADE_WHOLE_HEADER);
    expect(section).toContain('scripts/ci/migration-made-whole-guard.mjs');
    const probe = readFileSync(join(ROOT, 'scripts/dev/probe-rpc.sql'), 'utf8');
    expect(probe).toContain(MADE_WHOLE_HEADER);
  });
});
