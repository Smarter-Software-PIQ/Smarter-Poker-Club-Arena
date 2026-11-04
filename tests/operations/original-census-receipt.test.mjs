import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, unlinkSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { cachedOriginalCensus, ORIGINAL_CENSUS, originalCensusTarget } from '../../scripts/ci/profile-engine-main-thread.mjs';

const start = ORIGINAL_CENSUS.notBeforeMs + 1000;
const result = { predicateVisits: 500, validPredicateVisits: 450, matched: 3,
  queryStartedAtMs: start, firstValidAtMs: start + 60000, lastValidAtMs: start + 61000,
  queryEndedAtMs: start + 62000, overflow: false, deadlineRefused: true, arrayAllocated: false };
const require = createRequire(import.meta.url);

function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'original-census-receipt-'));
  const path = join(folder, 'original.cjs');
  writeFileSync(path, `module.exports={sourceSHA256:${JSON.stringify(ORIGINAL_CENSUS.sourceSHA256)},maxMatches:22096,managedOutputBytes:772608,prototypeCacheBytes:1048576,calls:0,collect(){throw new Error('must never collect')},diagnostics(){this.calls++;return ${JSON.stringify(result)}}};`);
  const addon = require(path);
  unlinkSync(path);
  t.after(() => { delete require.cache[path]; rmSync(folder, {recursive:true, force:true}); });
  const binding = {...ORIGINAL_CENSUS, path};
  const targetProcess = {pid:1,version:'v22.23.2',versions:{v8:'12.4.254.21-node.56',modules:'127'},
    env:{GIT_COMMIT_SHA:ORIGINAL_CENSUS.engineSha},getBuiltinModule:process.getBuiltinModule};
  const read = () => runInNewContext(`(${cachedOriginalCensus.toString()})(binding)`, {binding,process:targetProcess});
  return {addon,binding,targetProcess,read,path};
}

test('reads exactly ten original scalars once from a real retained cache entry after unlink', t => {
  const f = fixture(t);
  assert.deepEqual(JSON.parse(JSON.stringify(f.read())), result);
  assert.equal(f.addon.calls,1);
  assert.equal(require.cache[f.path].loaded,true);
});

test('missing, foreign, replaced, or expired receipts refuse without loading or collecting', t => {
  const f = fixture(t);
  const refuse = () => assert.throws(f.read,/original_census_unavailable/);
  f.binding.path += '-missing'; refuse(); f.binding.path = f.path;
  f.targetProcess.pid=2; refuse(); f.targetProcess.pid=1;
  f.targetProcess.env.GIT_COMMIT_SHA='f'.repeat(40); refuse();
  f.targetProcess.env.GIT_COMMIT_SHA=ORIGINAL_CENSUS.engineSha;
  f.addon.sourceSHA256='f'.repeat(64); refuse(); f.addon.sourceSHA256=ORIGINAL_CENSUS.sourceSHA256;
  assert.equal(f.addon.calls,0,'identity refusals cannot invoke diagnostics');
  for (const replacement of [
    {...result,queryStartedAtMs:0}, {...result,queryEndedAtMs:0},
    {...result,queryEndedAtMs:ORIGINAL_CENSUS.notAfterMs+1},
    {...result,firstValidAtMs:result.queryEndedAtMs+1},
    {...result,validPredicateVisits:result.predicateVisits+1},
    {...result,predicateVisits:Infinity}, {...result,overflow:0}, {...result,secret:'must not export'},
    new Proxy(result,{ownKeys(){throw new Error('must not run proxy trap')}}),
  ]) { f.addon.diagnostics=()=>replacement; refuse(); }
  f.addon.diagnostics=()=>Object.defineProperty({...result},'matched',{get(){throw new Error('must not invoke getter')}});
  refuse();
});

test('an expired pre-predicate scan remains observable without inventing its missing first-valid timestamp', t => {
  const f=fixture(t);
  const expired={...result,validPredicateVisits:0,matched:0,firstValidAtMs:0,lastValidAtMs:0};
  f.addon.diagnostics=()=>expired;
  assert.deepEqual(JSON.parse(JSON.stringify(f.read())),expired);
});

test('the original target cannot be selected by a foreign PID and the maintained workflow runs these regressions', async () => {
  await assert.rejects(originalCensusTarget('ws://127.0.0.1:9229/x',2),/original_census_identity_refused/);
  const workflow=readFileSync('.github/workflows/profile-engine-main-thread.yml','utf8');
  assert.match(workflow,/node --test[^\n]+tests\/operations\/original-census-receipt\.test\.mjs/);
  assert.match(workflow,/python3 -B tests\/operations\/original-census-receipt-host\.test\.py/);
  assert.match(workflow,/inputs\.mode == 'legacy_census_receipt'/);
  assert.match(workflow,/github\.ref == format\('refs\/heads\/\{0\}'/);
  const source=cachedOriginalCensus.toString();
  assert.doesNotMatch(source,/\.collect\(|queryObjects|\.gc\(|setPrototypeOf|delete |loader\(/);
});
