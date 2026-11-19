/**
 * A REFUSED DEALT MANIFEST IS NAMED AT ITS SOURCE (2026-11-19).
 *
 * On 2026-11-18 fn_cash_capture_hand_manifest raised on every cash hand for 52
 * minutes (an ambiguous alias), its transaction rolled back, and the refusal
 * reached nobody. 20261119005831 wraps the body: the function's own refusals
 * and transient states raise as before, any other error writes one critical
 * financial_alerts row and returns a version-0 refusal the engine already
 * treats as a failed capture. These cases pin that shape, the moved md5 pin,
 * and the regression-window label's filters (Lightning hands excluded).
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FILE = '20261119005831_a_refused_dealt_manifest_is_named_at_its_source.sql';
const sql = readFileSync(join(resolve(__dirname, '../..'), 'supabase/migrations', FILE), 'utf8');
const engine = readFileSync(
  join(resolve(__dirname, '../..'), 'server/src/services/supabase/cashHandProvenance.ts'),
  'utf8'
);

function fnText(marker: string): string {
  const i = sql.indexOf(marker);
  const body = sql.indexOf('AS $function$', i) + 'AS $function$'.length;
  return sql.slice(i, sql.indexOf('$function$', body) + '$function$'.length);
}

const capture = fnText('CREATE OR REPLACE FUNCTION public.fn_cash_capture_hand_manifest(');
const handler = capture.slice(capture.indexOf('EXCEPTION WHEN OTHERS THEN'));

describe('a refused dealt manifest is named at its source', () => {
  it('re-raises every refusal the function makes on purpose, and nothing it did not write', () => {
    const own = [...capture.matchAll(/RAISE EXCEPTION '([^']+)'/g)].map((m) => m[1]);
    expect(own.length).toBeGreaterThanOrEqual(6);
    const listed = handler.slice(handler.indexOf('IF v_msg IN ('), handler.indexOf(') OR left(v_state'));
    for (const msg of own) expect(listed).toContain(`'${msg}'`);
    expect(handler).toContain("left(v_state,2) IN ('40','53','57','08') OR v_state IN ('55P03','55006')");
    expect(handler).toMatch(/THEN\s+RAISE;/);
  });

  it('names any other error once while unresolved and returns a refusal the engine rejects', () => {
    expect(handler).toContain("INSERT INTO public.financial_alerts(severity,source,message,context)");
    expect(handler).toContain("VALUES('critical','fn_cash_capture_hand_manifest'");
    expect(handler).toContain("fa.context->>'sqlstate'=v_state AND fa.context->>'error'=v_msg");
    expect(handler).toContain("RETURN jsonb_build_object('version',0,'refused',true");
    // The engine treats any receipt whose version is not 1 as a failed capture.
    expect(engine).toContain('data?.version !== 1');
  });

  it('keeps the dealt-chair capture and its unambiguous row source', () => {
    expect(capture).toContain('INSERT INTO smarter_private.cash_hand_chair_clubs');
    expect(capture).toContain('FROM jsonb_array_elements(v_chairs) AS chairs(chair)');
  });

  it('moves the original inventory proof pin to this exact body', () => {
    const md5 = createHash('md5').update(capture + '\n').digest('hex');
    const pin = fnText('CREATE OR REPLACE FUNCTION smarter_private.original_inventory_proof_sources_match()');
    expect(pin).toContain(`public.fn_cash_capture_hand_manifest(uuid,bigint,jsonb,text,uuid)','${md5}'`);
    expect(pin).not.toContain('cf57bbe03d7c79a003f14915523fd857');
    expect(sql).toContain(`'${md5}' AND smarter_private.original_inventory_proof_sources_match()`);
  });

  it('labels only the regression window, never a Lightning hand, never a table that never captured', () => {
    const insert = sql.slice(sql.indexOf('INSERT INTO smarter_private.cash_hand_provenance_explained_gaps'));
    expect(insert).toContain("p.accepted_at >= timestamptz '2026-11-18 20:12:48+00'");
    expect(insert).toContain("p.issues = '[\"original_dealt_manifest_missing\"]'::jsonb");
    expect(insert).toContain('lh.hand_history_id = p.hand_id');
    expect(insert).toContain('lh.host_table_id = p.table_id AND lh.hand_number = p.hand_number');
    expect(insert).toContain('q.manifest_id IS NOT NULL');
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON smarter_private\.cash_hand_provenance_explained_gaps/);
  });
});
