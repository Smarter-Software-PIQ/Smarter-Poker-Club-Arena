import {readFile,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const TYPES=Object.freeze(['FUNCTION','RELATION','TYPE','OTHER']);
const MAX_BYTES=512*1024,MAX_LINE=96,MAX_US=45000000;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const refuse=code=>{throw Object.assign(new Error('ISOLATED_NATIVE_DUMP_PROTOCOL_REFUSED'),{diagnosticKind:code});};
const requireFrame=value=>{if(!value)refuse('FD3_PROTOCOL');};

export function safeNativeDumpDiagnostic(value) {
  const uint=(number,max)=>Number.isSafeInteger(number) && number>=0 && number<=max;
  const currentScope=value?.version===2 && value.object_scope==='effective-selected-components' && value.query_scope==='actual-network-requests';
  const legacyScope=value?.version===1 && value.object_scope===undefined && value.query_scope===undefined;
  if((!currentScope && !legacyScope) || !uint(value.records,100000) || !uint(value.bytes,MAX_BYTES) ||
    typeof value.stream_closed!=='boolean' || typeof value.pairs_complete!=='boolean')return null;
  const types={};
  for(const type of TYPES){
    const bucket=value.types?.[type];if(!bucket)return null;
    const fields=['objects_started','objects_completed','queries_started','queries_completed',
      'object_elapsed_us','query_elapsed_us','query_max_us'];
    if(!fields.every(key=>uint(bucket[key],key.endsWith('_us')?MAX_US:100000)))return null;
    types[type]=Object.fromEntries(fields.map(key=>[key,bucket[key]]));
  }
  const span=item=>item===null?null:item && TYPES.includes(item.type) &&
    uint(item.started_at_us,MAX_US) && uint(item.unpaired_since_received_ms,45000)?
    {type:item.type,started_at_us:item.started_at_us,unpaired_since_received_ms:item.unpaired_since_received_ms}:undefined;
  const object=span(value.last_unpaired_object),query=span(value.last_unpaired_query);
  if(object===undefined || query===undefined)return null;
  return {version:value.version,...(currentScope?{object_scope:value.object_scope,query_scope:value.query_scope}:{}),records:value.records,bytes:value.bytes,stream_closed:value.stream_closed,
    pairs_complete:value.pairs_complete,types,last_unpaired_object:object,last_unpaired_query:query};
}

// The only retained strings are closed types. Raw frames are discarded as soon
// as parsed; counters, two open spans and a short partial frame are constant state.
export function createNativeDumpDiagnostic() {
  let partial='',bytes=0,sequence=0,lastUs=0,object=null,query=null,closed=false,retired=false;
  const buckets=Object.fromEntries(TYPES.map(type=>[type,{objects_started:0,objects_completed:0,
    object_elapsed_us:0,queries_started:0,queries_completed:0,query_elapsed_us:0,query_max_us:0}]));
  const frame=(line,receivedMs)=>{
    const match=/^D1 ([1-9][0-9]{0,5}) ([OQ]) ([BE]) (FUNCTION|RELATION|TYPE|OTHER) (0|[1-9][0-9]{0,7})$/.exec(line);
    requireFrame(match);
    const [,seqText,kind,edge,type,timeText]=match,seq=Number(seqText),us=Number(timeText);
    requireFrame(seq===sequence+1 && seq<=100000 && us>=lastUs && us<=MAX_US);
    sequence=seq;lastUs=us;const bucket=buckets[type];
    if(kind==='O' && edge==='B'){
      requireFrame(!object && !query);object={type,us,receivedMs};bucket.objects_started++;
    }else if(kind==='O'){
      requireFrame(object?.type===type && !query);bucket.objects_completed++;
      bucket.object_elapsed_us+=us-object.us;object=null;
    }else if(edge==='B'){
      requireFrame(object?.type===type && !query);query={type,us,receivedMs};bucket.queries_started++;
    }else{
      requireFrame(query?.type===type && object?.type===type);bucket.queries_completed++;
      const elapsed=us-query.us;bucket.query_elapsed_us+=elapsed;
      bucket.query_max_us=Math.max(bucket.query_max_us,elapsed);query=null;
    }
  };
  return {
    push(chunk,receivedMs){
      requireFrame(!retired && !closed && Number.isSafeInteger(receivedMs) && receivedMs>=0 && receivedMs<=45000);
      bytes+=chunk.length;if(bytes>MAX_BYTES)refuse('FD3_LIMIT');
      // Latin1 preserves byte length. Non-ASCII bytes cannot match the grammar.
      for(const char of chunk.toString('latin1')){
        if(char==='\n'){frame(partial,receivedMs);partial='';}
        else {partial+=char;if(partial.length>MAX_LINE)refuse('FD3_LIMIT');}
      }
    },
    finish({allowEmpty=false}={}){requireFrame(!retired && !closed && partial==='' && (sequence>0 || allowEmpty));closed=true;},
    snapshot(observedMs){
      requireFrame(!retired && Number.isSafeInteger(observedMs) && observedMs>=0 && observedMs<=45000);
      const open=span=>span?{type:span.type,started_at_us:span.us,
        unpaired_since_received_ms:Math.max(0,observedMs-span.receivedMs)}:null;
      return {version:2,object_scope:'effective-selected-components',query_scope:'actual-network-requests',records:sequence,bytes,stream_closed:closed,
        pairs_complete:closed && sequence>0 && !object && !query,
        types:Object.fromEntries(TYPES.map(type=>[type,{...buckets[type]}])),
        last_unpaired_object:open(object),last_unpaired_query:open(query)};
    },
    clear(){partial='';object=null;query=null;retired=true;}
  };
}

const capabilities=new WeakSet();
const ARCHIVE_SHA='5367f6fb2ec97efe1eb2e0c7926bb33438e51b0bd3a9733b88498056a7dc9a7e';
export async function verifyNativeDumpBinary(env) {
  const fail=()=>{throw new Error('ISOLATED_NATIVE_DUMP_BINARY_REFUSED');};
  if(!path.isAbsolute(env.RUNNER_TEMP ?? '') || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ||
    !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID ?? '') || !/^[1-9][0-9]{0,5}$/.test(env.GITHUB_RUN_ATTEMPT ?? ''))fail();
  const root=path.join(await realpath(env.RUNNER_TEMP),'isolated-schema-native');
  const read=async(relative,maximum,executable=false)=>{
    const file=path.join(root,relative),details=await lstat(file);
    if(!details.isFile() || details.isSymbolicLink() || details.nlink!==1 || details.uid!==process.getuid() ||
      details.size<=0 || details.size>maximum || (details.mode&0o022)!==0 ||
      (executable && (details.mode&0o111)===0) || await realpath(file)!==file)fail();
    return readFile(file);
  };
  const manifest=JSON.parse((await read('manifest.json',16384)).toString());
  const sourceHash=async name=>digest(await readFile(fileURLToPath(new URL(name,import.meta.url))));
  if(manifest.version!==1 || manifest.scope!=='isolated-native-dump-diagnostic' ||
    manifest.source_version!=='17.11' || manifest.control_sha!==env.GITHUB_SHA ||
    manifest.run_id!==env.GITHUB_RUN_ID || manifest.run_attempt!==Number(env.GITHUB_RUN_ATTEMPT) ||
    manifest.archive_sha256!==ARCHIVE_SHA ||
    manifest.builder_sha256!==await sourceHash('./native-dump-diagnostic.py') ||
    manifest.helper_sha256!==await sourceHash('./native-dump-diagnostic.c') ||
    manifest.function_batch_helper_sha256!==await sourceHash('./native-dump-function-batch.c') ||
    manifest.function_batch_contract_sha256!==await sourceHash('./native-dump-function-batch-test.c') ||
    manifest.transport!=='consecutive-stock-function-executions-v1' ||
    manifest.qualification?.synthetic_routine_count!==5507 ||
    manifest.qualification?.function_batch_max!==128 ||
    manifest.qualification?.native_batch_result_faults_refused!==true ||
    manifest.qualification?.filtered_zero_one_equal!==true ||
    manifest.qualification?.diagnostic_object_scope!=='effective-selected-components' ||
    manifest.binary_sha256!==digest(await read('bin/pg_dump',32*1024*1024,true)) ||
    manifest.libpq_sha256!==digest(await read('lib/libpq.so.5',16*1024*1024)) ||
    !['passed','sql_bytes_equal','fd3_records_valid','cluster_absent'].every(key=>manifest.qualification?.[key]===true))fail();
  const result=Object.freeze({executable:path.join(root,'bin/pg_dump'),library:path.join(root,'lib'),
    binary_sha256:manifest.binary_sha256,postgres_version:'17.11'});
  capabilities.add(result);return result;
}

export function nativeDumpCapability(value) {
  if(!capabilities.has(value))throw new Error('ISOLATED_NATIVE_DUMP_BINARY_REFUSED');
  return value;
}
