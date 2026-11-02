import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixtureBootstrapFailureDiagnostic as diagnose} from '../fixture-server.mjs';
import {schemaRestorePsqlArguments, schemaRestoreOwnerEnvironment} from '../schema-restore-owner.mjs';

test('full preflight emits bounded setup, restore, substep and cleanup failures while normal start remains private',()=>{
  const error=Object.assign(new Error('PRIVATE SQL AND FIXTURE CREDENTIALS'),{actual:'PRIVATE',expected:'PRIVATE',stderr:'PRIVATE',sqlstate:'PRIVATE'});
  for(const stage of ['archives','application-schema','schema-preflight-catalogue-parity','schema-preflight-auth-users','cleanup']){
    assert.equal(diagnose({preimageOnly:false,schemaMode:null,stage,error}),null);
    for(const [preimageOnly,schemaMode,prefix] of [[true,null,'fixture-preimage-'],[false,'preflight','fixture-preflight-']]){
      const row=diagnose({preimageOnly,schemaMode,stage,error});
      assert.deepEqual(row,{status:'failed',stage:prefix+stage,error:'Error'});
      assert.ok(!JSON.stringify(row).includes('PRIVATE'));
    }
  }
});
test('real catches use shared emitter and the separate guarded installer preserves strict stop and ordinary application identity',async()=>{
  const s=await readFile(new URL('../fixture-server.mjs',import.meta.url),'utf8');
  assert.equal((s.match(/const diagnostic = fixtureBootstrapFailureDiagnostic/g)||[]).length,3);
  const restore=s.slice(s.indexOf("stage = 'application-schema';"),s.indexOf('const applicationOwner =',s.indexOf("stage = 'application-schema';")));
  assert.ok(restore.includes('schemaRestorePsqlArguments, schemaRestoreOwnerEnvironment'));
  assert.ok(schemaRestorePsqlArguments.includes('--single-transaction'));
  assert.ok(schemaRestorePsqlArguments.includes('ON_ERROR_STOP=1'));
  assert.ok(schemaRestorePsqlArguments.includes('VERBOSITY=sqlstate'));
  assert.equal(schemaRestorePsqlArguments[schemaRestorePsqlArguments.indexOf('-U')+1],'supabase_admin');
  assert.deepEqual(schemaRestoreOwnerEnvironment,{PGOPTIONS:'-c search_path=pg_catalog -c session_preload_libraries='});
  assert.ok(restore.includes('throw schemaRestoreFailure(error)'));
  assert.ok(s.includes('const applicationOwner = await assertApplicationOwnerBoundary(db)'));
  assert.ok(s.includes('renderSchemaRestorePlan(originalSchema)'));
  assert.ok(s.includes("schemaRoot + '/source-schema.sql', originalSchema"));
  assert.ok(s.indexOf('await qualifySchemaRestoreOwner({ supervisor, db })')<s.indexOf("stage = 'genuine-service-schema-preimage'"));
  assert.ok(s.includes('SCHEMA_PREFLIGHT_STAGES.includes(next)'));
  assert.ok(s.includes("stage = 'schema-preflight-' + next"));
});
