import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createRequire } from 'node:module';
import { NativeDatabaseOwner } from '../../operations/release/fixture/runtime-files.mjs';
import { realtimeMigrated } from '../../operations/release/fixture/fixture-server.mjs';
import {
  REALTIME_CONTROL_DATABASE, REALTIME_SEED_EXPRESSION, realtimeControlConnection,
  createRealtimeControlDatabase, assertRealtimeControlIsolation,
} from '../../operations/release/fixture/realtime-control-plane.mjs';

// Use the fixture's locked driver in the same dependency topology as native CI.
const fixtureRequire = createRequire(
  new URL('../../operations/release/fixture/package.json', import.meta.url)
);
const pg = fixtureRequire('pg');
assert.equal(
  fixtureRequire('pg/package.json').version,
  fixtureRequire('./package.json').dependencies.pg
);

function owner() {
  const clients=[];
  return {clients,own(c){clients.push(c);return c;},async end(c){await c.end();}};
}

test('private control bootstrap validates original admin, uses one new fixed database, and closes its client', async () => {
  const calls=[],scope=owner();
  class Client {
    constructor(options){assert.deepEqual(options,realtimeControlConnection);}
    async connect(){calls.push('connect');}
    async query(sql){calls.push(sql);return {rows:[{owned_control:true}]};}
    async end(){calls.push('end');}
  }
  const admin={query:async sql=>{calls.push(sql);return {rows:[{owned_control_bootstrap:true}]};}};
  await createRealtimeControlDatabase(admin,Client,scope);
  assert.equal(calls.filter(x=>x==='CREATE DATABASE club_arena_realtime_control OWNER supabase_admin').length,1);
  assert.ok(calls.includes('REVOKE CONNECT ON DATABASE club_arena_realtime_control FROM PUBLIC'));
  assert.ok(calls.includes('CREATE SCHEMA _realtime AUTHORIZATION supabase_admin'));
  assert.equal(calls.at(-1),'end');
  assert.equal(calls.some(x=>/ALTER DATABASE|ALTER ROLE/.test(x)),false);
  let created=false;
  await assert.rejects(createRealtimeControlDatabase({query:async()=>({rows:[{owned_control_bootstrap:false}]})},class {constructor(){created=true;}},owner()),/CONTROL_BOOTSTRAP_REQUIRED/);
  assert.equal(created,false);
  const occupied=[];
  await assert.rejects(createRealtimeControlDatabase({query:async sql=>{
    occupied.push(sql);if(sql.startsWith('CREATE DATABASE'))throw Object.assign(Error('occupied'),{code:'42P04'});
    return {rows:[{owned_control_bootstrap:true}]};
  }},Client,owner()),/occupied/);
  assert.equal(occupied.length,2);
});

test('ordinary login admission refuses a granted connection or unrelated startup failure and always closes', async () => {
  for(const failure of [null,'28P01','42501']) {
    const scope=owner();let ended=false;
    class Client {
      constructor(options){assert.equal(options.user,'postgres');assert.equal(options.database,REALTIME_CONTROL_DATABASE);}
      async connect(){if(failure)throw Object.assign(Error('private driver message'),{code:failure});}
      async end(){ended=true;}
    }
    const app={query:async()=>({rows:[{isolated_control:true}]})};
    if(failure==='42501')await assertRealtimeControlIsolation(app,Client,scope);
    else await assert.rejects(assertRealtimeControlIsolation(app,Client,scope),/CONTROL_LOGIN_REQUIRED/);
    assert.equal(ended,true);
  }
});

test('actual pg startup42501 denial closes without marking NativeDatabaseOwner failed', {timeout:5000}, async () => {
  const server=net.createServer(socket=>{
    socket.once('data',()=>{
      const fields=Buffer.from('SFATAL\0VFATAL\0C42501\0Mfixture denial\0\0');
      const header=Buffer.alloc(5);header[0]=69;header.writeInt32BE(fields.length+4,1);
      socket.end(Buffer.concat([header,fields]));
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const scope=new NativeDatabaseOwner();
  class Client extends pg.Client {
    constructor(options){super({...options,host:'127.0.0.1',port:server.address().port,ssl:false});}
  }
  try {
    await assertRealtimeControlIsolation({query:async()=>({rows:[{isolated_control:true}]})},Client,scope);
    assert.equal(scope.failure,null);assert.equal(scope.signal.aborted,false);
  } finally {
    await scope.close();await new Promise(resolve=>server.close(resolve));
  }
});

test('real migration witness requires exact application set and separate control tenant witness', async () => {
  const calls=[];
  const app={query:async sql=>{calls.push(['app',sql]);return {rows:[sql.includes('owned_service_bootstrap')?{owned_service_bootstrap:true}:{complete:true}]};}};
  const control={query:async sql=>{calls.push(['control',sql]);return {rows:[sql.includes('owned_control')?{owned_control:true}:{complete:true}]};}};
  assert.equal(await realtimeMigrated(app,control),true);
  assert.ok(calls.find(([kind,sql])=>kind==='app'&&sql.includes('count(*)=83')&&sql.includes('min(version)=20211116024918')&&sql.includes('max(version)=20260827120000')&&sql.includes('262da2efb4aa494a7d90cf451fc9cce5')&&sql.includes('skip_broadcast')&&sql.includes("to_regnamespace('_realtime') IS NULL")));
  assert.ok(calls.find(([kind,sql])=>kind==='control'&&sql.includes('_realtime.tenants')&&sql.includes('migrations_ran=83')));
  assert.equal(await realtimeMigrated(app,{query:async sql=>({rows:[sql.includes('owned_control')?{owned_control:true}:{complete:false}]})}),false);
  assert.equal(await realtimeMigrated({query:async sql=>({rows:[sql.includes('owned_service_bootstrap')?{owned_service_bootstrap:true}:{complete:false}]})},control),false);
  await assert.rejects(realtimeMigrated(app,{query:async()=>({rows:[{owned_control:false}]})}),/CONTROL_IDENTITY_REQUIRED/);
});

test('stock seed retains control Repo config while deriving only its tenant target from scoped environment', () => {
  assert.equal((REALTIME_SEED_EXPRESSION.match(/Realtime.Release.seeds\(Realtime.Repo\)/g)||[]).length,1);
  const asserted=REALTIME_SEED_EXPRESSION.indexOf('Keyword.fetch!(config, :database)');
  const target=REALTIME_SEED_EXPRESSION.indexOf('System.put_env("DB_NAME", "club_arena_qualification")');
  const seed=REALTIME_SEED_EXPRESSION.indexOf('Realtime.Release.seeds(Realtime.Repo)');
  assert.ok(asserted>=0&&asserted<target&&target<seed);
  assert.match(REALTIME_SEED_EXPRESSION,/after\s+System.put_env\("DB_NAME", original\)/);
  assert.equal(REALTIME_SEED_EXPRESSION.includes('Application.put_env'),false);
});
