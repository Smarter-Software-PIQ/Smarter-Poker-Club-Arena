import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {LEGACY_CENSUS_NATIVE_SOURCE_SHA256, loadLegacyNativeCensus, legacyNativeCensusMemoryAdmission} from '../../server/scripts/legacy-engine-checkpoint.mjs';
const cpp = fs.readFileSync(new URL('../../server/scripts/native/legacy-census.cc',import.meta.url));
const js = fs.readFileSync(new URL('../../server/scripts/legacy-engine-checkpoint.mjs',import.meta.url),'utf8');
test('protected control source pin binds the exact native implementation',()=>{
 assert.equal(createHash('sha256').update(cpp).digest('hex'),LEGACY_CENSUS_NATIVE_SOURCE_SHA256);
});
test('native preallocation ceiling derives from maintained owner and topology ceilings',()=>{
 const limits=JSON.parse(/const limits = (\[[0-9, ]+\]);/.exec(js)[1]);
 const prototypes=Number(/cachedPrototypes >= ([0-9]+)/.exec(js)[1]);
 const terms=/constexpr size_t kMatches = ([0-9 +]+);/.exec(cpp.toString())[1].split('+').map(Number);
 assert.equal(terms.reduce((a,b)=>a+b,0),limits.reduce((a,b)=>a+b,0)+prototypes);
 assert.equal(terms.reduce((a,b)=>a+b,0),22096);
});
test('unowned native descriptors refuse before filesystem access or loading',()=>{
 for (const descriptor of [null,{}, {schema:'legacy-native-census-artifact/v1',path:'/tmp/unowned.node'}])
  assert.throws(()=>loadLegacyNativeCensus(descriptor),/artifact identity refused/);
});
test('native admission reports and requires the full cache reserve at both boundaries',()=>{
 const used=10000000, heap=32*1024*1024+772608+1048576, process=used*8+32*1024*1024+1048576;
 const exact={usedHeapBytes:used,availableHeapBytes:heap,availableProcessBytes:process};
 assert.equal(legacyNativeCensusMemoryAdmission(exact,1048576).ok,true);
 assert.equal(legacyNativeCensusMemoryAdmission(exact,1048576).prototypeCacheBytes,1048576);
 assert.equal(legacyNativeCensusMemoryAdmission({...exact,availableHeapBytes:heap-1},1048576).ok,false);
 assert.equal(legacyNativeCensusMemoryAdmission({...exact,availableProcessBytes:process-1},1048576).ok,false);
 for(const bad of [undefined,null,true,'1048576',0,1048575,1048577])
  assert.equal(legacyNativeCensusMemoryAdmission(exact,bad),null);
});
test('cache metadata is exact before any native filesystem read',()=>{
 const descriptor={schema:'legacy-native-census-artifact/v1',path:'/app/.legacy-census-checkpoint-1-1/legacy-census.node',
  manifestPath:'/app/.legacy-census-checkpoint-1-1/legacy-census.node.json',binarySHA256:'b'.repeat(64),
  manifestSHA256:'c'.repeat(64),sourceSHA256:'d'.repeat(64),candidateSHA:'a'.repeat(40),
  candidateImageId:'sha256:'+'e'.repeat(64),candidateSourceTree:'f'.repeat(40)};
 for(const bad of [undefined,null,true,'1048576',0,1048575,1048577])
  assert.throws(()=>loadLegacyNativeCensus({...descriptor,prototypeCacheBytes:bad}),/artifact identity refused/);
});
