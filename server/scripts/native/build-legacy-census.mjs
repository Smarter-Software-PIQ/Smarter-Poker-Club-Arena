// Builds only the maintained ABI-specific addon. Never contacts a game host.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const args = Object.fromEntries(process.argv.slice(2).map((x) => {
  const n = x.indexOf('=');
  if (n < 3) throw Error('Use --headers=absolute --output=absolute');
  return [x.slice(2, n), x.slice(n + 1)];
}));
if (process.version !== 'v22.23.2' || process.versions.v8 !== '12.4.254.21-node.56' ||
    process.versions.modules !== '127' || !['darwin', 'linux'].includes(process.platform) ||
    !['arm64', 'x64'].includes(process.arch)) throw Error('Exact supported Node/V8/ABI required');
if (!path.isAbsolute(args.headers ?? '') || !path.isAbsolute(args.output ?? ''))
  throw Error('Absolute headers/output required');
const source = fileURLToPath(new URL('legacy-census.cc', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const control = fs.readFileSync(new URL('../legacy-engine-checkpoint.mjs', import.meta.url),'utf8');
const pin = /^export const LEGACY_CENSUS_NATIVE_SOURCE_SHA256 = '([0-9a-f]{64})';$/m.exec(control)?.[1];
if (pin !== sha(fs.readFileSync(source))) throw Error('Maintained native source pin mismatch');
const headers = [];
function walk(dir, prefix = '') {
  for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    const rel = prefix + item.name;
    if (item.isSymbolicLink()) throw Error('Header symlink refused');
    if (item.isDirectory()) walk(path.join(dir,item.name), rel + '/');
    else if (item.isFile()) headers.push([rel, sha(fs.readFileSync(path.join(dir,item.name)))]);
  }
}
walk(args.headers);
const compiler = process.platform === 'darwin' ? '/usr/bin/clang++' : 'c++';
const version = spawnSync(compiler, ['--version'], { encoding:'utf8', timeout:5000 });
if (version.status !== 0) throw Error('Compiler unavailable');
fs.mkdirSync(path.dirname(args.output), { recursive:true });
const options = ['-std=c++17', '-O2', '-shared', '-fPIC', '-fno-exceptions', '-I'+args.headers, '-DLEGACY_CENSUS_SOURCE_SHA256="'+pin+'"',
  ...(process.platform === 'darwin' ? ['-undefined','dynamic_lookup'] : []), source, '-o',args.output];
const build = spawnSync(compiler, options, { encoding:'utf8', timeout:60000 });
if (build.error || build.status !== 0) throw Error(build.stderr || String(build.error));
// Test-only instrumentation of the ACTUAL callback, never the shipped addon.
// Upstream's second QueryObjects loop retains one input handle per object;
// callback-created context/prototype handles must not grow on top of that.
const probeDir = fs.mkdtempSync(path.join(path.dirname(args.output), 'handle-scope-proof-'));
try {
  const actual = fs.readFileSync(source, 'utf8');
  const replaceOne = (text, from, to) => {
    assert.equal(text.split(from).length, 2, 'actual callback instrumentation anchor changed');
    return text.replace(from, to);
  };
  let instrumented = replaceOne(
    actual,
    'struct Attempt {',
    'struct Attempt {\n  uint64_t prototypeSteps = 0, identityHashes = 0; int firstHandles = 0, lastHandles = 0;'
  );
  instrumented = replaceOne(
    instrumented,
    '++lastAttempt.predicateVisits;',
    `
    const int probeHandles = v8::HandleScope::NumberOfHandles(context_->GetIsolate());
    if (!lastAttempt.predicateVisits) lastAttempt.firstHandles = probeHandles;
    lastAttempt.lastHandles = probeHandles;
    ++lastAttempt.predicateVisits;`
  );
  instrumented = replaceOne(
    instrumented,
    'NUMBER(predicateVisits);',
    'NUMBER(prototypeSteps); NUMBER(identityHashes); NUMBER(firstHandles); NUMBER(lastHandles); NUMBER(predicateVisits);'
  );
  instrumented = instrumented.replaceAll('cursor = cursor.As<v8::Object>()->GetPrototype();', '++lastAttempt.prototypeSteps; cursor = cursor.As<v8::Object>()->GetPrototype();');
  instrumented = instrumented.replaceAll('const int hash = ', '++lastAttempt.identityHashes; const int hash = ');
  const probeSource = path.join(probeDir, 'instrumented.cc');
  const probeAddon = path.join(probeDir, 'instrumented.node');
  fs.writeFileSync(probeSource, instrumented);
  const probeOptions = options.map((value) =>
    value === source ? probeSource : value === args.output ? probeAddon : value
  );
  const compiled = spawnSync(compiler, probeOptions, { encoding: 'utf8', timeout: 60000 });
  assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
  const probe = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=128',
      '-e',
      `
    const assert=require('node:assert/strict');
    const addon=require(process.argv[1]);
    const marker={}; let chain=marker;
    for(let i=0;i<32;i++) chain=Object.create(chain);
    globalThis.handleScopeFixture=Array.from({length:2000},()=>Object.create(chain));
    const result=addon.collect(marker,Date.now()+30000,process.availableMemory());
    const attempt=addon.diagnostics();
    assert.ok(globalThis.handleScopeFixture.every(x=>result.includes(x)),'exhaustive owners lost');
    assert.equal(result.length,2032,'unexpected prototype-owner output');
    const growth=attempt.lastHandles-attempt.firstHandles;
    console.log(JSON.stringify({schema:'legacy-census-handle-lifetime/v1',growth,attempt}));
    assert.ok(growth<=attempt.predicateVisits*2+128,
      'callback handle growth exceeds upstream per-object handles: '+growth+'/'+attempt.predicateVisits);
  `,
      probeAddon,
    ],
    { encoding: 'utf8', timeout: 40000, maxBuffer: 16384 }
  );
  assert.equal(probe.status, 0, probe.stdout + '\n' + probe.stderr + '\n' + String(probe.error));
  console.error(probe.stdout.trim());
  // Keep the original 2000-object/32-deep proof above. These additional
  // temporary builds instrument the actual cache, never the shipped binary.
  let cacheInstrumented = replaceOne(instrumented,
    'struct Attempt {',
    'struct Attempt {\n  uint64_t cachePins=0, positivePins=0, handlesBefore=0, handlesAfter=0;');
  cacheInstrumented = replaceOne(cacheInstrumented,
    'entries_[size_] = {prototype, matches, distance};',
    '++lastAttempt.cachePins; if(matches)++lastAttempt.positivePins; entries_[size_] = {prototype, matches, distance};');
  cacheInstrumented = replaceOne(cacheInstrumented,
    'lastAttempt.queryStartedAtMs = Now();',
    'lastAttempt.handlesBefore = v8::HandleScope::NumberOfHandles(isolate);\n  lastAttempt.queryStartedAtMs = Now();');
  cacheInstrumented = replaceOne(cacheInstrumented,
    'lastAttempt.queryEndedAtMs = Now();',
    'lastAttempt.queryEndedAtMs = Now();\n  lastAttempt.handlesAfter = v8::HandleScope::NumberOfHandles(isolate);');
  cacheInstrumented = replaceOne(cacheInstrumented,
    'NUMBER(predicateVisits);',
    'NUMBER(cachePins); NUMBER(positivePins); NUMBER(handlesBefore); NUMBER(handlesAfter); NUMBER(predicateVisits);');
  const cacheProbe = `
    const assert=require('node:assert/strict');
    const addon=require(process.argv[1]);
    const collision=process.argv[2]==='collision';
    const marker={}; const types=[class A{},class B{},class C{},class D{},class E{}];
    types.forEach(C=>Object.setPrototypeOf(C.prototype,marker));
    const owners=types.map(C=>new C());
    const detached=(()=>{const value=new types[2]();return()=>value})();
    const anchor=Object.create(Object.create(marker));
    const prototypes=Array.from({length:5000},()=>Object.create(Object.create(Object.create(anchor))));
    const extra=prototypes.map(p=>Object.create(p));
    globalThis.cacheFixture={types,owners,detached,prototypes,extra};
    const collect=()=>addon.collect(marker,Date.now()+30000,process.availableMemory());
    const first=collect(); const before=addon.diagnostics();
    for(const x of [...owners,detached(),...prototypes,...extra])assert.ok(first.includes(x));
    assert.ok(before.cachePins<=4096);
    if(collision)assert.ok(before.cachePins<=8);else assert.equal(before.cachePins,4096);
    assert.ok(before.handlesAfter-before.handlesBefore<=before.predicateVisits+before.cachePins+32);
    prototypes.forEach(p=>{
      const parent=Object.getPrototypeOf(p), grandparent=Object.getPrototypeOf(parent);
      for(const value of [p,parent,grandparent])Object.setPrototypeOf(value,null);
    });
    const second=collect(); const after=addon.diagnostics();
    for(const x of [...prototypes,...extra])assert.equal(second.includes(x),false);
    for(const x of [...owners,detached()])assert.ok(second.includes(x));
    assert.equal(after.handlesBefore,before.handlesBefore,'prior Collect pins survived');
    assert.ok(after.handlesAfter-after.handlesBefore<=after.predicateVisits+after.cachePins+32);
    assert.equal(after.positivePins,0,'shallow matching prototypes must not enter cache');
    console.log(JSON.stringify({schema:'legacy-census-prototype-cache-proof/v1',collision,before,after,complete:true}));
  `;
  const suffixProbe = `
    const assert=require('node:assert/strict');const addon=require(process.argv[1]);
    const marker={};class Owner{};Object.setPrototypeOf(Owner.prototype,marker);
    const active=new Owner();const detached=(()=>{const v=new Owner();return()=>v})();
    let tail=Object.prototype;for(let i=0;i<200;i++)tail=Object.create(tail);
    const wrappers=Number(process.argv[2]);
    const ballast=Array.from({length:100000},()=>{let value=tail;for(let i=0;i<wrappers;i++)value=Object.create(value);return value;});
    globalThis.suffixFixture={active,detached,ballast,tail,Owner};
    const result=addon.collect(marker,Date.now()+30000,process.availableMemory());
    const attempt=addon.diagnostics();
    assert(result.includes(active)&&result.includes(detached()));
    assert(!result.includes(ballast[0]));
    assert(attempt.predicateVisits>=200000);
    assert(attempt.identityHashes<=attempt.predicateVisits*2,'hash work grew with suffix depth');
    assert(attempt.prototypeSteps<(wrappers===2?1000000:2000000),'shared suffix classification repeated per unique wrapper');
    assert.equal(attempt.deadlineRefused,false);assert.equal(attempt.arrayAllocated,true);
    console.log(JSON.stringify({schema:'legacy-census-shared-suffix/v1',wrappers,attempt,detachedComplete:true}));
  `;
  const uniqueProbe = `
    const assert=require('node:assert/strict');const addon=require(process.argv[1]);
    const marker={};class Owner{};Object.setPrototypeOf(Owner.prototype,marker);
    const owner=new Owner(),chains=[];
    for(let i=0;i<1000;i++){let p=null;for(let j=0;j<200;j++)p=Object.create(p);chains.push(p);}
    globalThis.uniqueFixture={chains,owner};
    const result=addon.collect(marker,Date.now()+30000,process.availableMemory());
    assert(result.includes(owner));for(const x of chains)assert(!result.includes(x));
    const attempt=addon.diagnostics();
    assert(attempt.predicateVisits>=200000);assert.equal(attempt.matched,2);
    assert(attempt.identityHashes<=attempt.predicateVisits*2,'hash work grew with unshared depth');
    assert(attempt.cachePins<=4096);assert.equal(attempt.deadlineRefused,false);
    console.log(JSON.stringify({schema:'legacy-census-unshared-suffix/v1',attempt}));
  `;
  for (const collision of [false, true]) {
    let text = cacheInstrumented;
    if (collision) for (const name of ['prototype','candidate']) text = replaceOne(text,
      'const int hash = '+name+'->GetIdentityHash();',
      'const int hash = ('+name+'->GetIdentityHash(), 1);');
    fs.writeFileSync(probeSource, text);
    const compiledCache = spawnSync(compiler, probeOptions, {encoding:'utf8',timeout:60000});
    assert.equal(compiledCache.status,0,compiledCache.stderr || String(compiledCache.error));
    const qualified = spawnSync(process.execPath,
      ['--max-old-space-size=128','-e',cacheProbe,probeAddon,collision?'collision':'ordinary'],
      {encoding:'utf8',timeout:40000,maxBuffer:16384});
    assert.equal(qualified.status,0,qualified.stdout+'\n'+qualified.stderr+'\n'+String(qualified.error));
    console.error(qualified.stdout.trim());
    const unique = spawnSync(process.execPath,
      ['--max-old-space-size=256','-e',uniqueProbe,probeAddon],
      {encoding:'utf8',timeout:40000,maxBuffer:16384});
    assert.equal(unique.status,0,unique.stdout+'\n'+unique.stderr+'\n'+String(unique.error));
    console.error(unique.stdout.trim());
    if (!collision) for (const wrappers of [2, 4]) {
      const suffix = spawnSync(process.execPath,
        ['--max-old-space-size=256','-e',suffixProbe,probeAddon,String(wrappers)],
        {encoding:'utf8',timeout:40000,maxBuffer:16384});
      assert.equal(suffix.status,0,suffix.stdout+'\n'+suffix.stderr+'\n'+String(suffix.error));
      console.error(suffix.stdout.trim());
    }
  }
} finally {
  fs.rmSync(probeDir, { recursive: true, force: true });
}
const manifest = { schema:'legacy-native-census-build/v1', node:process.version,
  v8:process.versions.v8, modules:process.versions.modules, platform:process.platform,
  arch:process.arch, pointerCompression:process.config.variables.v8_enable_pointer_compression,
  sourceSHA256:sha(fs.readFileSync(source)), headersSHA256:sha(JSON.stringify(headers)),
  binarySHA256:sha(fs.readFileSync(args.output)), compiler:version.stdout.trim(),
  maxMatches:22096, managedOutputBytes:22096*8*4+65536, prototypeCacheBytes:1048576,
  qualification:'unqualified-build-only' };
fs.writeFileSync(args.output+'.json', JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest));
