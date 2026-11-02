// Mandatory rollback-only PostgreSQL proof; never a product certificate.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const hash = text => createHash('sha256').update(text).digest('hex');
const tables = ['crew_members','insurance_offer_events','insurance_transactions','referrals','fixture_expression_precedence_probe'];
const sourceCases = [
  ['crew_members','crew_members_role_check','role',"'owner'::character varying, 'admin'::character varying, 'member'::character varying"],
  ['insurance_offer_events','insurance_offer_events_event_check','event',"'offered'::character varying, 'accepted'::character varying, 'declined'::character varying, 'timeout'::character varying, 'cashed_out'::character varying, 'settled'::character varying"],
  ['insurance_transactions','insurance_transactions_bank_type_check','bank_type',"'union'::character varying, 'club'::character varying"],
  ['referrals','referrals_status_check','status',"'pending'::character varying, 'completed'::character varying"],
];
// Independently literal native target, not values copied from a mapping result.
const expectedTargets = [
  "CHECK (role::text = ANY (ARRAY['owner'::character varying::text, 'admin'::character varying::text, 'member'::character varying::text]))",
  "CHECK (event::text = ANY (ARRAY['offered'::character varying::text, 'accepted'::character varying::text, 'declined'::character varying::text, 'timeout'::character varying::text, 'cashed_out'::character varying::text, 'settled'::character varying::text]))",
  "CHECK (bank_type::text = ANY (ARRAY['union'::character varying::text, 'club'::character varying::text]))",
  "CHECK (status::text = ANY (ARRAY['pending'::character varying::text, 'completed'::character varying::text]))",
];
export async function assertNativeSchemaExpressionContract(db, {schemaCataloguePayload, buildCatalogueRestorePlan}) {
  assert.equal((await db.query(`SELECT current_database()='club_arena_qualification'
    AND current_user='postgres' AND session_user='postgres'
    AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS safe`)).rows[0].safe,true);
  const absent = async () => (await db.query(`SELECT bool_and(to_regclass('public.'||name) IS NULL) AS absent
    FROM unnest($1::text[]) names(name)`,[tables])).rows[0].absent;
  assert.equal(await absent(),true);
  assert.equal((await db.query("SELECT to_regprocedure('public.fixture_expression_precedence_function()') IS NULL AS absent")).rows[0].absent,true);
  await db.query('BEGIN');
  let failure;
  try {
    for (const [relation,name,column,values] of sourceCases)
      await db.query(`CREATE TABLE public.${relation} (${column} varchar,
        CONSTRAINT ${name} CHECK (${column}::text = ANY (ARRAY[${values}]::text[])))`);
    await db.query(`CREATE TABLE public.fixture_expression_precedence_probe(a integer,b integer,c integer,
      CONSTRAINT fixture_expression_same CHECK (((a>0 AND b>0) AND c>0)),
      CONSTRAINT fixture_expression_mixed CHECK ((a>0 OR b>0) AND NOT(c=7)),
      CONSTRAINT fixture_expression_other CHECK (a>0 OR (b>0 AND NOT(c=7))));
      CREATE INDEX fixture_expression_precedence_index ON public.fixture_expression_precedence_probe(a)
        WHERE ((a>0 OR b>0) AND NOT(c=7));
      CREATE FUNCTION public.fixture_expression_precedence_function() RETURNS trigger LANGUAGE plpgsql
        AS 'BEGIN RETURN NEW; END';
      CREATE TRIGGER fixture_expression_precedence_trigger BEFORE UPDATE ON public.fixture_expression_precedence_probe
        FOR EACH ROW WHEN ((old.a IS DISTINCT FROM new.a OR old.b IS DISTINCT FROM new.b)
          AND NOT(old.c IS DISTINCT FROM new.c)) EXECUTE FUNCTION public.fixture_expression_precedence_function()`);
    // Source payload is created only from independently specified original
    // constants, before reading any native catalogue or definitions.
    const body = {access:[],roles:[],memberships:[],functions:[],columns:[],policies:[],
      constraints:sourceCases.map(([relation,name,column,values]) => ['public',relation,name,
        `CHECK (${column}::text = ANY (ARRAY[${values}]::text[]))`,true]),triggers:[],indexes:[],rls:[]};
    const originalText = (await db.query('SELECT $1::jsonb::text AS text',[JSON.stringify(body)])).rows[0].text;
    const original = {version:1,scope:'complete-schema-catalogue',encoding:'postgres-jsonb-text-sha256/v1',
      catalogue_text:originalText,catalogue_digest:hash(originalText)};
    const planned = await buildCatalogueRestorePlan(db,original);
    assert.equal(original.catalogue_text,originalText);
    assert.equal(original.catalogue_digest,hash(originalText));
    assert.equal(planned.mapping.version,2);
    assert.equal(planned.mapping.constraint_changed_rows_count,4);
    assert.equal(planned.mapping.changed_rows_count,0);
    assert.notEqual(planned.expected_catalogue_digest,original.catalogue_digest);
    assert.deepEqual(JSON.parse(planned.expected_catalogue_text).constraints,
      sourceCases.map(([relation,name],i)=>['public',relation,name,expectedTargets[i],true]));
    const observed = JSON.parse((await schemaCataloguePayload(db)).catalogue_text);
    for (const [i,[relation,name]] of sourceCases.entries()) {
      assert.deepEqual(observed.constraints.filter(row=>row[0]==='public'&&row[1]===relation&&row[2]===name),
        [['public',relation,name,expectedTargets[i],true]]);
    }
    const constraints = observed.constraints.filter(row=>row[1]==='fixture_expression_precedence_probe');
    const definition = name => constraints.find(row=>row[2]===name)?.[3];
    assert.equal(definition('fixture_expression_same'),'CHECK (a > 0 AND b > 0 AND c > 0)');
    assert.equal(definition('fixture_expression_mixed'),'CHECK ((a > 0 OR b > 0) AND NOT c = 7)');
    assert.equal(definition('fixture_expression_other'),'CHECK (a > 0 OR b > 0 AND NOT c = 7)');
    assert.notEqual(definition('fixture_expression_mixed'),definition('fixture_expression_other'));
    const index = observed.indexes.find(row=>row.indexname==='fixture_expression_precedence_index');
    assert.equal(index?.indexdef,'CREATE INDEX fixture_expression_precedence_index ON public.fixture_expression_precedence_probe USING btree (a) WHERE (a > 0 OR b > 0) AND NOT c = 7');
    assert.equal(observed.triggers.find(row=>row[2]==='fixture_expression_precedence_trigger')?.[3],
      'CREATE TRIGGER fixture_expression_precedence_trigger BEFORE UPDATE ON public.fixture_expression_precedence_probe FOR EACH ROW WHEN ((old.a IS DISTINCT FROM new.a OR old.b IS DISTINCT FROM new.b) AND NOT old.c IS DISTINCT FROM new.c) EXECUTE FUNCTION public.fixture_expression_precedence_function()');
    // Independently derived truth table distinguishes changed precedence.
    assert.deepEqual((await db.query(`SELECT (a>0 OR b>0) AND NOT(c=7) AS grouped,
      a>0 OR (b>0 AND NOT(c=7)) AS other FROM (VALUES(1,0,7),(0,1,7),(0,1,8),(0,0,8)) v(a,b,c)`)).rows,
      [{grouped:false,other:true},{grouped:false,other:false},{grouped:true,other:true},{grouped:false,other:false}]);
    for (const change of [row=>{row[0]='auth';},row=>{row[1]+='_changed';},row=>{row[2]+='_changed';},
      row=>{row[3]=row[3].replace("'owner'","'changed'");},
      row=>{row[3]=row[3].replace("'owner'::character varying, 'admin'","'admin'::character varying, 'owner'");},
      row=>{row[3]=row[3].replace('character varying','text');},
      row=>{row[3]=row[3].replace(' = ANY',' <> ALL');}]) {
      const altered = structuredClone(body);change(altered.constraints[0]);
      const text = (await db.query('SELECT $1::jsonb::text AS text',[JSON.stringify(altered)])).rows[0].text;
      await assert.rejects(buildCatalogueRestorePlan(db,{...original,catalogue_text:text,catalogue_digest:hash(text)}),
        /SCHEMA_CATALOGUE_RESTORE_MAP_REFUSED/);
    }
    await db.query('SAVEPOINT expression_fault');
    await assert.rejects(db.query('SELECT 1/0'),error=>error.code==='22012');
    await db.query('ROLLBACK TO SAVEPOINT expression_fault');
  } catch (error) { failure=error; }
  finally { try { await db.query('ROLLBACK'); } catch(error) { failure??=error; } }
  if(failure) throw failure;
  assert.equal(await absent(),true);
  assert.equal((await db.query(`SELECT current_user='postgres' AND session_user='postgres'
    AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS safe`)).rows[0].safe,true);
  assert.equal((await db.query("SELECT to_regprocedure('public.fixture_expression_precedence_function()') IS NULL AS absent")).rows[0].absent,true);
  return {scope:'native-schema-expression-contract',source_array_constraints:4,
    pretty_boolean_precedence:true,original_digest_unchanged:true,rollback_absent:true};
}
