import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { classifyChangedPaths } from '../../scripts/ci/classify-ci-changes.mjs';
const root = resolve(__dirname, '../..');
const migration =
  'supabase/migrations/20261116195435_pko_predecessor_evidence_is_read_in_one_bounded_joined_query.sql';
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const sql = read(migration);
const runner = read('scripts/dev/probe-causal-pko-predecessors-pg17.sh');
const native = read('scripts/dev/fixtures/causal-pko-predecessors/full-native.py');

describe('PKO joined evidence preserves the accepted proof and its native gate', () => {
  it('pins the unchanged independent validator used by the differential oracle', () => {
    const original = read(
      'supabase/migrations/20260914133503_pko_heads_follow_accepted_knockout_dependencies.sql'
    );
    const body = original
      .split('CREATE OR REPLACE FUNCTION public.fn_pko_candidate_accepted_scope_v1(')[1]
      .split('AS $function$')[1]
      .split('$function$;')[0];
    expect(createHash('md5').update(body).digest('hex')).toBe('34c837517891f25a801a6ec1f7f6b511');
    expect(sql).not.toContain(
      'CREATE OR REPLACE FUNCTION public.fn_pko_candidate_accepted_scope_v1('
    );
    expect(sql).toContain('scope_limit constant integer:=10000;');
    expect(sql).toContain('ORDER BY c.hand_number,c.eliminated_user_id LIMIT 10001');
    expect(sql).toContain("'predecessor_scope_incomplete'");
    expect(sql).toContain("p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'");
    expect(sql).toContain('FROM PUBLIC,anon,authenticated,service_role');
  });
  it('executes differential refusal and realistic scope cases before the real financial races', () => {
    for (const name of ['batched-evidence.sql', 'batched-cost.sql']) {
      expect(runner).toContain(`-f "$FIX/${name}"`);
      expect(native).toContain(`'${name}'`);
      expect(
        classifyChangedPaths([`scripts/dev/fixtures/causal-pko-predecessors/${name}`]).server
      ).toBe(true);
    }
    expect(runner.indexOf('-f "$FIX/batched-evidence.sql"')).toBeLessThan(
      runner.indexOf('python3 -B "$FIX/full-native.py"')
    );
    expect(native).toContain('qualify_batch_installation(e,root,db)');
    expect(native).toContain(
      "e.sql(scene,file=root/BATCH_MIGRATION,label='joined-evidence-migration')"
    );
    expect(native).toContain('if shared:qualify_races(e,root,native,scene)');
    expect(native).toContain("'body_acl_refusals':6");
    expect(native).toContain('paths=[MIGRATION,BATCH_MIGRATION,');
    expect(read('scripts/dev/fixtures/causal-pko-predecessors/batched-evidence.sql')).toContain(
      'old_result IS NOT DISTINCT FROM new_result'
    );
    expect(read('scripts/dev/fixtures/causal-pko-predecessors/batched-cost.sql')).toContain(
      "'1255 scope and all proof details equal the original'"
    );
  });
});
