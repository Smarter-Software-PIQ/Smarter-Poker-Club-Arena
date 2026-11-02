import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CONSTRAINT_RESTORE_RULES} from '../schema-catalogue-restore-map.mjs';

test('canonical expression observer uses genuine native pretty deparsers and retains complete metadata',async()=>{
  const source=await readFile(new URL('../../native/component-semantic-observations.mjs',import.meta.url),'utf8');
  assert.ok(source.includes('pg_get_constraintdef(k.oid,true),k.convalidated'));
  assert.ok(source.includes('pg_get_triggerdef(t.oid,true),t.tgenabled'));
  assert.ok(source.includes("jsonb_set(to_jsonb(i), '{indexdef}',"));
  assert.ok(source.includes('pg_get_indexdef((quote_ident(schemaname)'));
  assert.ok(source.includes("quote_ident(indexname))::regclass,0,true)"));
  for(const key of ['access','roles','memberships','functions','columns','policies','constraints','triggers','indexes','rls'])
    assert.ok(source.includes("'"+key+"'"));
  assert.ok(source.includes('SET LOCAL search_path = pg_catalog'));
});

test('four source-bound coercion rules preserve exact operands, order, names, casts and operator',()=>{
  assert.equal(CONSTRAINT_RESTORE_RULES.length,4);
  const crew=CONSTRAINT_RESTORE_RULES.find(r=>r.name==='crew_members_role_check');
  assert.equal(crew.original,"CHECK (role::text = ANY (ARRAY['owner'::character varying, 'admin'::character varying, 'member'::character varying]::text[]))");
  assert.equal(crew.restored,"CHECK (role::text = ANY (ARRAY['owner'::character varying::text, 'admin'::character varying::text, 'member'::character varying::text]))");
  assert.deepEqual(CONSTRAINT_RESTORE_RULES.map(r=>[r.schema,r.relation,r.name]),[
    ['public','crew_members','crew_members_role_check'],
    ['public','insurance_offer_events','insurance_offer_events_event_check'],
    ['public','insurance_transactions','insurance_transactions_bank_type_check'],
    ['public','referrals','referrals_status_check']]);
  for(const rule of CONSTRAINT_RESTORE_RULES){assert.ok(Object.isFrozen(rule));assert.match(rule.original,/ = ANY /);assert.match(rule.restored,/ = ANY /);}
});

test('mandatory native smoke invokes actual injected source adapter and actual canonical observer',async()=>{
  const smoke=await readFile(new URL('../native-smoke.mjs',import.meta.url),'utf8');
  const proof=await readFile(new URL('../schema-expression-proof.mjs',import.meta.url),'utf8');
  assert.ok(smoke.includes("import { assertNativeSchemaExpressionContract } from './schema-expression-proof.mjs'"));
  assert.ok(smoke.includes("await import(controlModules + '../fixture/schema-catalogue-restore-map.mjs')"));
  assert.ok(smoke.includes('await assertNativeSchemaExpressionContract(db, {schemaCataloguePayload, buildCatalogueRestorePlan})'));
  for(const required of ['source_array_constraints:4','pretty_boolean_precedence:true','original_digest_unchanged:true',
    'rollback_absent:true','await schemaCataloguePayload(db)','await buildCatalogueRestorePlan(db,original)',
    'fixture_expression_mixed','fixture_expression_other','fixture_expression_precedence_trigger',
    'fixture_expression_precedence_index',"await db.query('ROLLBACK')","db.query('SELECT 1/0')"])
    assert.ok(proof.includes(required),required);
  assert.ok(!proof.includes('CONSTRAINT_RESTORE_RULES'));
});
