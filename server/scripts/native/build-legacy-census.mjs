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
// Exercise the shipped collector's bounded phase records and callback removal.
const phaseProbe = String.raw`
const assert = require('node:assert/strict');
const addon = require(process.argv[1]);
const marker = Object.create(null); class Owner {};
Object.setPrototypeOf(Owner.prototype, marker);
const owner = new Owner(); globalThis.phaseOwner = owner;
const found = addon.collect(marker, Date.now()+59000, process.availableMemory(), 'eed-80s-v1');
assert(found.includes(owner));
const before = addon.diagnostics();
assert(before.gcBegins > 0 && before.gcBegins === before.gcEnds);
assert.equal(before.traceRecords, before.phaseTraceAvailable ? 4 : 0);
global.gc();
assert.deepEqual(addon.diagnostics(), before, 'GC callbacks must be removed after collect');
console.log(JSON.stringify(before));
`;
const phase = spawnSync(process.execPath, ['--expose-gc','-e',phaseProbe,args.output],
  {encoding:'utf8', timeout:10000, maxBuffer:16384});
assert.equal(phase.status,0,phase.stderr+'\n'+String(phase.error));
const phases = (phase.stderr.trim() ? phase.stderr.trim().split('\n') : []).map(line => {
  assert(line.startsWith('legacy-census-phase '));
  const row = JSON.parse(line.slice('legacy-census-phase '.length));
  assert.equal(row.sourceSHA256,pin);
  assert.deepEqual(Object.keys(row).sort(),['atMs','gcBegins','gcEnds','gcDurationMs','phase','predicateVisits','schema','sourceSHA256','startedAtMs'].sort());
  return row;
});
assert(phases.length <= 20);
if (phases.length) {
  assert.equal(phases[0].phase,'query_begin');
  assert.equal(phases.at(-1).phase,'query_end');
  assert.equal(phases.filter(row => row.phase === 'first_predicate').length,1);
}
console.error(JSON.stringify({schema:'legacy-census-phase-proof/v1',records:phases.length,callbacksRemoved:true}));
// Test-only instrumentation of the ACTUAL callback, never the shipped addon.
// Upstream's second QueryObjects loop retains one input handle per object;
// callback-created context/prototype handles must not grow on top of that.
const probeDir = fs.mkdtempSync(path.join(path.dirname(args.output), 'handle-scope-proof-'));
try {
  if (process.platform === 'linux') {
    // Qualification-only child owns its FIFO and signal disposition. No helper
    // enters the production image; the actual shipped addon is unchanged.
    const sinkSource = path.join(probeDir, 'sink-proof.cc');
    const sinkAddon = path.join(probeDir, 'sink-proof.node');
    fs.writeFileSync(sinkSource, String.raw`
#include <node.h>
#include <fcntl.h>
#include <unistd.h>
#include <signal.h>
#include <string>
#include <cerrno>
static int saved=-1, reader=-1, expected=0;
static struct sigaction original;
static sigset_t originalMask;
static bool closedDuringGC=false, closeCallback=false;
void CloseReader(v8::Isolate*,v8::GCType,v8::GCCallbackFlags,void*) {
  if(reader>=0){close(reader);reader=-1;closedDuringGC=true;}
}
void Setup(const v8::FunctionCallbackInfo<v8::Value>& args) {
  int ends[2]; if(pipe(ends)!=0) _exit(91);
  saved=dup(2); reader=ends[0];
  fcntl(ends[1],F_SETFL,O_NONBLOCK);
  const int mode=args[0].As<v8::Int32>()->Value();
  if(mode==1) { char fill[4096]{}; while(write(ends[1],fill,sizeof(fill))>0){} }
  fcntl(ends[1],F_SETFL,0);
  if(mode==2){args.GetIsolate()->AddGCPrologueCallback(CloseReader,nullptr);closeCallback=true;}
  if(dup2(ends[1],2)<0)_exit(92);close(ends[1]);
  expected=fcntl(2,F_GETFL);
  sigaction(SIGPIPE,nullptr,&original);sigprocmask(SIG_SETMASK,nullptr,&originalMask);
  struct sigaction action{};action.sa_handler=SIG_DFL;sigemptyset(&action.sa_mask);
  sigaction(SIGPIPE,&action,nullptr);
}
void Finish(const v8::FunctionCallbackInfo<v8::Value>& args) {
  if(closeCallback)args.GetIsolate()->RemoveGCPrologueCallback(CloseReader,nullptr);
  const bool flags=fcntl(2,F_GETFL)==expected;
  sigset_t current;sigprocmask(SIG_SETMASK,nullptr,&current);
  const bool mask=sigismember(&current,SIGPIPE)==sigismember(&originalMask,SIGPIPE);
  struct sigaction action;sigaction(SIGPIPE,nullptr,&action);
  const bool disposition=action.sa_handler==SIG_DFL;
  dup2(saved,2);close(saved);saved=-1;
  sigaction(SIGPIPE,&original,nullptr);
  std::string trace;
  if(reader>=0){fcntl(reader,F_SETFL,O_NONBLOCK);char bytes[4096];ssize_t n;
    while((n=read(reader,bytes,sizeof(bytes)))>0 && trace.size()<131072)trace.append(bytes,n);
    close(reader);reader=-1;}
  auto* isolate=args.GetIsolate();auto context=isolate->GetCurrentContext();auto out=v8::Object::New(isolate);
  out->Set(context,v8::String::NewFromUtf8Literal(isolate,"flags"),v8::Boolean::New(isolate,flags)).Check();
  out->Set(context,v8::String::NewFromUtf8Literal(isolate,"mask"),v8::Boolean::New(isolate,mask)).Check();
  out->Set(context,v8::String::NewFromUtf8Literal(isolate,"disposition"),v8::Boolean::New(isolate,disposition)).Check();
  out->Set(context,v8::String::NewFromUtf8Literal(isolate,"closedDuringGC"),v8::Boolean::New(isolate,closedDuringGC)).Check();
  out->Set(context,v8::String::NewFromUtf8Literal(isolate,"trace"),v8::String::NewFromUtf8(isolate,trace.c_str(),v8::NewStringType::kNormal,trace.size()).ToLocalChecked()).Check();
  args.GetReturnValue().Set(out);
}
void Init(v8::Local<v8::Object> exports){NODE_SET_METHOD(exports,"setup",Setup);NODE_SET_METHOD(exports,"finish",Finish);}
NODE_MODULE(NODE_GYP_MODULE_NAME,Init)
`);
    const sinkBuilt=spawnSync(compiler,['-std=c++17','-shared','-fPIC','-I'+args.headers,sinkSource,'-o',sinkAddon],{encoding:'utf8',timeout:60000});
    assert.equal(sinkBuilt.status,0,sinkBuilt.stderr);
    for(const mode of [0,1,2]) {
      const result=spawnSync(process.execPath,['-e',String.raw`
const assert=require('node:assert/strict');const sink=require(process.argv[1]);const addon=require(process.argv[2]);const mode=Number(process.argv[3]);
const marker={};class Owner{};Object.setPrototypeOf(Owner.prototype,marker);const owner=new Owner();globalThis.owner=owner;
sink.setup(mode);
const found=addon.collect(marker,Date.now()+59000,process.availableMemory(),'eed-80s-v1');
const state=sink.finish();assert(found.includes(owner));assert(state.flags&&state.mask&&state.disposition);
assert.equal(addon.diagnostics().phaseTraceAvailable,true);
assert.equal(state.closedDuringGC,mode===2);
const lines=state.trace.split('\n').filter(x=>x.startsWith('legacy-census-phase '));
assert.equal(lines.length,mode===0?4:0);
for(const line of lines){const row=JSON.parse(line.slice(20));assert.equal(row.sourceSHA256,addon.sourceSHA256);}
console.log(JSON.stringify({mode,complete:true,flagsUnchanged:true,signalMaskUnchanged:true,signalDispositionUnchanged:true,records:lines.length}));
`,sinkAddon,args.output,String(mode)],{encoding:'utf8',timeout:10000,maxBuffer:16384});
      assert.equal(result.status,0,result.stdout+'\n'+result.stderr+'\n'+String(result.error));
      console.error(result.stdout.trim());
    }
  }
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
