/**
 * A TREASURY GIFT IS LOOKED UP BY ITS OWN OCCUPANCY.
 *
 * pg_cron job 117 (public.sp_prune_hand_history) ran 15.9-19.6 s per page,
 * back to back every 10 seconds, while it caught up on 2026-11-24 (max 40.4 s,
 * DatabaseRepliesLost saturation). Measured on production: each doomed horse
 * hand reaches public.fn_pnl_cash_hand_evidence up to three times (the
 * accounting-ready guard and both compaction steps) at ~26 ms a call, and ~10
 * ms of every call was smarter_private.original_treasury_participant_gift
 * running the full byte-exact proof original_treasury_gift_evidence for EVERY
 * gift witness, per participant, before comparing occupancies. The cost grew
 * with every witness ever admitted, for every participant of every hand.
 *
 * The proof's occupancy_id IS the witness source path
 * seat_event.after_row.occupancy_id cast to uuid, and the witness table holds
 * one gift per occupancy (original_treasury_gift_occupancy_once). So a witness
 * whose source occupancy is canonical text and differs from the participant's
 * can never match and is skipped; non-canonical text is still proven. Same
 * set, same count, same answer (539 production participants: 0 differences;
 * all 4 witnesses' own chairs: the same proof). Per call 13x less work.
 *
 * These pins fail on the old shape: the live definition must carry the
 * prefilter, and no later migration may redefine the function without it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const file = files.find((f) => f.includes('a_treasury_gift_is_looked_up_by_its_own_occupancy'));
const sql = file ? readFileSync(join(MIGRATIONS, file), 'utf8') : '';
const PREFILTER =
  "AND ((w.source#>>'{seat_event,after_row,occupancy_id}')=(p_participant->>'occupancy_id')";
const CANONICAL_FALLBACK = "!~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')";

describe('a treasury gift is looked up by its own occupancy', () => {
  it('the migration exists', () => {
    expect(file, 'the occupancy prefilter migration must not be deleted').toBeTruthy();
  });

  it('amends the live definition at exactly one anchor and re-reads it', () => {
    expect(sql).toContain('pg_get_functiondef(v_proc)');
    expect(sql).toContain('TREASURY_GIFT_PREFILTER_ANCHOR_NOT_UNIQUE');
    expect(sql).toContain('TREASURY_GIFT_PREFILTER_DID_NOT_LAND');
    expect(sql).toContain(
      " WHERE w.kind='gift' AND v->>'status'='proven' AND v->>'table_id'=p_table::text"
    );
    expect(sql).toMatch(/@live-proof: position\('original_treasury_gift_occupancy_once prefilter'/);
  });

  it('skips only witnesses that can never match and still proves non-canonical text', () => {
    expect(sql).toContain(PREFILTER);
    expect(sql).toContain(CANONICAL_FALLBACK);
  });

  it('keeps every original filter, the exactly-one rule and the exception handler', () => {
    for (const kept of [
      "AND v->>'status'='proven' AND v->>'table_id'=p_table::text",
      "AND v->>'occupancy_id'=p_participant->>'occupancy_id'",
      'IF n<>1 THEN RETURN NULL;END IF;RETURN g;',
    ]) {
      expect(sql).toContain(kept);
    }
  });

  it('proves every witness still finds its own chair and no foreign one', () => {
    expect(sql).toContain('TREASURY_GIFT_PREFILTER_LOST_A_PROOF');
    expect(sql).toContain('TREASURY_GIFT_PREFILTER_MATCHED_A_FOREIGN_CHAIR');
  });

  it('moves the original-inventory pin on the changed body in the same transaction', () => {
    // The 2026-11-07 class: a changed body left pinned by its old md5 turns
    // original_inventory_proof_sources_match() false and the generation NULL.
    expect(sql).toContain('TREASURY_GIFT_PREFILTER_PIN_NOT_UNIQUE');
    expect(sql).toContain('v_psm_new := replace(v_psm, v_old_gift, v_new_gift);');
    expect(sql).toContain('TREASURY_GIFT_PREFILTER_PIN_POSTIMAGE');
    expect(sql).toContain('TREASURY_GIFT_PREFILTER_SOURCES_STILL_DIFFER');
    expect(sql).toContain('TREASURY_GIFT_PREFILTER_STALE_PIN');
    expect(sql).not.toMatch(/^--\s*@stale-pin-ok:/m);
    expect(sql).toMatch(
      /@live-proof: .*original_inventory_proof_sources_match\(\) IS TRUE AND smarter_private\.original_inventory_basis_generation\(\) LIKE 'original-inventory-245-v1:%'/
    );
  });

  it('no later migration redefines the gift lookup without the prefilter', () => {
    expect(file).toBeTruthy();
    const later = files.filter((f) => f > (file as string));
    for (const f of later) {
      const text = readFileSync(join(MIGRATIONS, f), 'utf8');
      if (/FUNCTION\s+smarter_private\.original_treasury_participant_gift\s*\(/i.test(text)) {
        expect(text, `${f} redefines original_treasury_participant_gift`).toContain(PREFILTER);
      }
    }
  });
});
