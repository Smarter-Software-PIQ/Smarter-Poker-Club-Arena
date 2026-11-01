#!/usr/bin/env python3
"""One exact generated-cache quarantine; never repairs unknown generation entries."""
import argparse
import ctypes
import errno
import hashlib
import importlib.util
import json
import marshal
import os
from pathlib import Path
import re
import stat
import struct
import subprocess
import sys
import time
sys.dont_write_bytecode = True

OLD = '303d8cc7d38a97c3bcdc32a577b555232ad726bf'
CANONICAL = Path('/usr/local/lib/club-arena/engine-control-generations') / OLD
MANIFEST_SHA = 'acd9b46df488967ae6e0e4c380e52b0ab06d346521910f696257a04d926f3e5d'
SOURCE_HASHES = {'build-engine-image.sh': '7f84e871cfc3946167b90c71b847db8be757132b1326c3617d3dd4502331f65a', 'collect-monitoring-health.sh': 'd48c0b09800008d1436cfbc9050033b11f5663508b94b0116c4c41c17c70fe87', 'engine-release-activation-floor.py': '850c6056e1eb630b8ca6729b5b654c40612f1c25d692999c8cf5fe3b985ddef2', 'engine-release-database-proof.py': '7034aa6f2d42a7a321c1e610fa517acd165367512aa8f3e62aaee719a4703155', 'engine-release-inflight-hands.py': '780a118d1a1e738c93922741ea0945b3b0fdf6329dc4834fe5975fd0f8928892', 'engine-release-intake.sh': '9fd3ff4635fa6b3c5915f19d8e5cb216c184bc414fdaac297c4c1003c90d5fdd', 'engine-release-lightning-hold.py': '401a15fa30f663b8614cf962ed4650c7f55927d29705ab9bdef9dac0638ee6e4', 'engine-release-protocol-v1.schema': '7c5aba4d2bc572edc5ef84c5280e1ffe517e5949b41788c18eeb003abea74044', 'engine-release-recover.sh': 'b6186c0e752ee93c9d57e79cb963c4386ff70ff0ed2a52f141d8373013096b83', 'engine-release-seal.py': '7ea266198c0a59e223ba662027352f5a45291d7d9fe25753d3c7dd2ec63916b2', 'engine-release-transaction.sh': 'e87f2c5d97039656eb953c2155cab1b2948d93e8bbff85efa30385a95e841e20', 'engine-release-unit-wrapper.sh': 'e9abdbe2c97c3594b32a920285e78858c1e0497f00a8a7edd21b99ba0491dc9c', 'engine-supervisor.sh': '0f25f0945300a691295c9b1359ecf83561950f25ac6aec4f237a721642872a46', 'engine-up.sh': '1653b4675d6b52942a16c41de42548247b05c9607c37831a63e5c02a35866bde', 'install-engine-drill.sh': '1960c2d0fdeef2c263b74096867796f1507a8cf651bd2c422c11323725a24fbd', 'install-engine-intake.sh': '5476d126add86e299728488c97eb0f47c2bdeddb3b0b28d680db6535eea47f1b', 'install-engine-supervisor.sh': 'e48dacd744696866cef81cba7fba0cc8dd5adc2d69ec7aea0b2c22eadf2cca69', 'launch-engine-release.sh': '6ce9a4026a73fe42629b2f123346eeff0e3d3fccd3fa02a6615dfc9cf1b44fa5', 'legacy-census-scale-fixture.mjs': 'acfe13daa5f2e2497e662ec9bb2ff105bcb5a618b0ede81a16aab90afaba99c1', 'legacy-census-scale-preflight.py': '6b500d614771a05f611ffe594e24f54312f15a72e496f8692d6e9e7a7cf5f719', 'legacy-engine-checkpoint-guard.mjs': 'f8d47b7a6c3b4191b84ec124994428f96e037de49001cc5c5d53c456dcc42b50', 'legacy-engine-checkpoint.mjs': 'c94820db1f5b6619b66c36cab6a6b987bc4e54f80b187596ccb6770c8f5b3ee7', 'legacy-engine-checkpoint.sh': 'daf6b20dfe7ac3275c9002fbe2b3b8a87beed7d28f165a6deb2d6b32bd7dbddb', 'main-inspector-retirement-entry.mjs': 'b1a6141c4f11455f96d55b81acd24ba950f90902b96720467701f5ad0e2fa801', 'main-inspector-retirement.py': '80cc6afcd4aa40540603132b893e9d0880f08606b9a2aac6494aac1bea8bd7e5', 'main-inspector-socket-qualification.mjs': 'a34c84ab8e1cd0f92b645a02e89a379d863f07da0021a9930643f90eea8a5482', 'observe-engine-release.sh': 'ef8222a00e0146bba4735ad2aa2132ebddff578f7c59f935f22ab971d66d341f', 'prewarm-engine-image.sh': 'c97247de8ec5fa859694e72a36ec520df2650f3441e43ff2df5681d63a6b5cfa', 'retain-engine-images.sh': '8a75da29f558fa63f67e58d7a9b25db206847fbfc2f0c9934ced91e547934d4b', 'retained-original-checkpoint-guard.mjs': 'b8e43e73864d46db088096474d0334f22076e83c1ce70b8a50c382a3a2cae312', 'retire-owned-main-inspector.mjs': 'dd91b8fa3e514a032b8b1133b1985988710c07239f692e8aeef65d21427f5d44', 'verify-recovery-stack.sh': '6715f90d51bd897d8797f9ce5895f235808e941c6bada3969c43391964dbb780'}
CAP = 1048576


def require(value):
    if not value: raise ValueError('qualified control cache refused')


def digest(raw): return hashlib.sha256(raw).hexdigest()


def identity(s):
    return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)


def read_regular(fd,name,uid):
    child=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
    try:
        before=os.fstat(child)
        require(stat.S_ISREG(before.st_mode) and before.st_uid==uid and not before.st_mode&0o022 and before.st_nlink==1 and 0<before.st_size<=CAP)
        raw=os.read(child,CAP+1)
        require(len(raw)==before.st_size and identity(before)==identity(os.fstat(child)))
        return raw,before
    finally: os.close(child)


def bounded_names(fd,limit=35):
    names=[]
    with os.scandir(fd) as entries:
        for entry in entries:
            names.append(entry.name);require(len(names)<=limit)
    return sorted(names)


def refusal_snapshot(fd,limit):
    rows=[];truncated=False;unavailable=False
    try:
        with os.scandir(fd) as entries:
            for entry in entries:
                if len(rows)==limit: truncated=True;break
                rows.append((digest(os.fsencode(entry.name)),identity(entry.stat(follow_symlinks=False))))
    except OSError: unavailable=True
    return {'countLowerBound':len(rows),'truncated':truncated,'metadataUnavailable':unavailable,
            'metadataSHA256':digest(repr(sorted(rows)).encode())}


def git_read(repo,args,deadline,input_bytes=None):
    env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
    env.update(GIT_NO_REPLACE_OBJECTS='1',GIT_NO_LAZY_FETCH='1',GIT_OPTIONAL_LOCKS='0')
    remaining=deadline-time.monotonic();require(remaining>0)
    result=subprocess.run(['git','-C',str(repo),*args],env=env,input=input_bytes,
                          stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=min(2,remaining),check=True)
    require(len(result.stdout)<=2*CAP)
    return result.stdout


def protected_sources(repo,deadline):
    names=list(SOURCE_HASHES)
    query=''.join(OLD+':server/scripts/'+n+'\n' for n in names).encode()
    raw=git_read(repo,['cat-file','--batch'],deadline,query);offset=0;answer={}
    for name in names:
        end=raw.find(b'\n',offset);require(end>=0)
        fields=raw[offset:end].split();require(len(fields)==3 and fields[1]==b'blob' and fields[2].isdigit())
        size=int(fields[2]);require(0<size<=CAP);offset=end+1
        data=raw[offset:offset+size];require(len(data)==size and raw[offset+size:offset+size+1]==b'\n')
        require(digest(data)==SOURCE_HASHES[name]);answer[name]=data;offset+=size+1
    require(offset==len(raw))
    return answer


def rename_exclusive(source_fd,name,target_fd,target):
    libc=ctypes.CDLL(None,use_errno=True)
    if sys.platform=='linux':
        call=libc.renameat2;flag=1 # RENAME_NOREPLACE, required Linux provider primitive.
    elif sys.platform=='darwin':
        call=libc.renameatx_np;flag=4 # RENAME_EXCL: isolated Mac filesystem qualification only.
    else: raise ValueError('exclusive rename unavailable')
    call.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
    call.restype=ctypes.c_int
    if call(source_fd,os.fsencode(name),target_fd,os.fsencode(target),flag)!=0:
        number=ctypes.get_errno();raise OSError(number,os.strerror(number))


def private_child(fd,name,uid):
    try: os.mkdir(name,0o700,dir_fd=fd)
    except FileExistsError: pass
    child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
    info=os.fstat(child)
    require(info.st_uid==uid and stat.S_IMODE(info.st_mode)==0o700 and info.st_dev==os.fstat(fd).st_dev)
    return child


def cache_facts(cache_fd,sources,source_fd,uid):
    info=os.fstat(cache_fd)
    require(info.st_uid==uid and not info.st_mode&0o022)
    names=bounded_names(cache_fd,24);require(0<len(names)<=24)
    allowed={}
    for source in SOURCE_HASHES:
        if source.endswith('.py'):
            for opt in (0,1,2): allowed[source[:-3]+'.'+sys.implementation.cache_tag+('' if opt==0 else '.opt-'+str(opt))+'.pyc']=(source,opt)
    facts=[];stats={};total=0
    for name in names:
        require(name in allowed)
        raw,entry=read_regular(cache_fd,name,uid);total+=len(raw);require(total<=8*CAP and len(raw)>16)
        source,opt=allowed[name];source_info=os.stat(source,dir_fd=source_fd,follow_symlinks=False)
        require(raw[:4]==importlib.util.MAGIC_NUMBER)
        flags=struct.unpack('<I',raw[4:8])[0];require(flags in (0,1,3))
        if flags==0: require(struct.unpack('<II',raw[8:16])==(int(source_info.st_mtime)&0xffffffff,len(sources[source])&0xffffffff))
        else: require(raw[8:16]==importlib.util.source_hash(sources[source]))
        filename=str(CANONICAL/source)
        compiled=compile(sources[source],filename,'exec',dont_inherit=True,optimize=opt)
        # CPython's cache writer retains its caller's code object while marshaling.
        # Keep that same extra reference (not a cache-derived object); marshal's
        # reference flags otherwise differ on Python 3.14's borrowed call refs.
        retained=[compiled]
        require(raw[16:]==marshal.dumps(retained[0]));stats[name]=identity(entry)
        facts.append({'name':name,'sha256':digest(raw),'bytes':len(raw),'sourceSHA256':SOURCE_HASHES[source],'optimization':opt})
    return facts,stats,total,info


def durable_json(fd,name,value):
    child=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
    try:
        raw=(json.dumps(value,sort_keys=True)+'\n').encode();require(len(raw)<65536)
        require(os.write(child,raw)==len(raw));os.fsync(child)
    finally: os.close(child)
    os.fsync(fd)


def recover(parent,repo,run,uid=0):
    """Private fixture supplies owned paths/UID; production entry fixes both."""
    require(re.fullmatch(r'[1-9][0-9]{0,19}-[1-9][0-9]{0,3}',run) is not None)
    deadline=time.monotonic()+20
    parent_fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    generation=parent/'engine-control-generations'/OLD;descriptors=[parent_fd]
    try:
        require(os.fstat(parent_fd).st_uid==uid and not os.fstat(parent_fd).st_mode&0o022)
        link=parent/'engine-control';require(link.is_symlink() and link.resolve(strict=True)==generation)
        fd=os.open(generation,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);descriptors.append(fd)
        generation_info=os.fstat(fd);require(generation_info.st_uid==uid and not generation_info.st_mode&0o022)
        expected=set(SOURCE_HASHES)|{'control-sha','generation-files'}
        generation_entries=set(bounded_names(fd));has_cache='__pycache__' in generation_entries
        require(generation_entries in (expected,expected|{'__pycache__'}))
        manifest,manifest_info=read_regular(fd,'generation-files',uid)
        require(digest(manifest)==MANIFEST_SHA and set(manifest.decode('ascii').splitlines())==set(SOURCE_HASHES) and len(manifest.decode('ascii').splitlines())==32)
        control,control_info=read_regular(fd,'control-sha',uid);require(control==(OLD+'\n').encode())
        git_read(repo,['merge-base','--is-ancestor',OLD,'origin/main'],deadline)
        protected=protected_sources(repo,deadline);sources={};source_stats={}
        for name,expected_hash in SOURCE_HASHES.items():
            raw,info=read_regular(fd,name,uid);require(digest(raw)==expected_hash and raw==protected[name])
            sources[name]=raw;source_stats[name]=identity(info)
        before_entries={**source_stats,'generation-files':identity(manifest_info),'control-sha':identity(control_info)}
        def source_stable(cache_present):
            require(link.resolve(strict=True)==generation and set(bounded_names(fd))==(expected|{'__pycache__'} if cache_present else expected))
            require(all(identity(os.stat(n,dir_fd=fd,follow_symlinks=False))==i for n,i in before_entries.items()))
            require(read_regular(fd,'generation-files',uid)[0]==manifest and read_regular(fd,'control-sha',uid)[0]==control)
        def existing_child(selected,name):
            child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=selected)
            descriptors.append(child);info=os.fstat(child)
            require(info.st_uid==uid and stat.S_IMODE(info.st_mode)==0o700 and info.st_dev==generation_info.st_dev)
            return child
        resumed=not has_cache
        if resumed:
            # Only the exact original durable intent/archive can finish an interrupted move.
            qfd=existing_child(parent_fd,'engine-control-cache-quarantine')
            sfd=existing_child(qfd,OLD);run_fd=existing_child(sfd,run)
            intent=json.loads(read_regular(run_fd,'intent.json',uid)[0])
            require(isinstance(intent,dict) and set(intent)=={'schema','oldControlSha','runKey','manifestSHA256','cacheBindingSHA256','entries','bytes','cacheIdentity'})
            binding=intent['cacheBindingSHA256'];require(isinstance(binding,str) and re.fullmatch('[0-9a-f]{64}',binding))
            require(set(bounded_names(run_fd,4)) in ({'intent.json',binding},{'intent.json',binding,'receipt.json'}))
            cache_fd=os.open(binding,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=run_fd);descriptors.append(cache_fd)
        else:
            cache_fd=os.open('__pycache__',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);descriptors.append(cache_fd)
        facts,cache_stats,total,cache_info=cache_facts(cache_fd,sources,fd,uid)
        require(cache_info.st_dev==generation_info.st_dev)
        binding=digest(json.dumps({'control':OLD,'manifestSHA256':MANIFEST_SHA,'entries':facts},sort_keys=True).encode())
        preserved_identity=[cache_info.st_dev,cache_info.st_ino,cache_info.st_mode,cache_info.st_uid,cache_info.st_gid,cache_info.st_nlink,cache_info.st_size,cache_info.st_mtime_ns]
        receipt={'schema':'qualified-control-cache-quarantine/v1','oldControlSha':OLD,'runKey':run,
                 'manifestSHA256':MANIFEST_SHA,'cacheBindingSHA256':binding,'entries':facts,'bytes':total,'cacheIdentity':preserved_identity}
        def cache_stable():
            require(sorted(cache_stats)==bounded_names(cache_fd,24))
            require(all(identity(os.stat(n,dir_fd=cache_fd,follow_symlinks=False))==i for n,i in cache_stats.items()))
        source_stable(has_cache);cache_stable()
        if resumed:
            require(intent==receipt)
            if 'receipt.json' in bounded_names(run_fd,4):
                saved=json.loads(read_regular(run_fd,'receipt.json',uid)[0]);require(saved=={**receipt,'result':'quarantined-preserved'})
                return saved # Same operation's durable disposition; never rewrite it.
        else:
            quarantine_fd=private_child(parent_fd,'engine-control-cache-quarantine',uid);descriptors.append(quarantine_fd)
            sha_fd=private_child(quarantine_fd,OLD,uid);descriptors.append(sha_fd)
            os.mkdir(run,0o700,dir_fd=sha_fd) # Existing run is UNKNOWN: no overwrite/retry.
            run_fd=existing_child(sha_fd,run)
            durable_json(run_fd,'intent.json',receipt)
            for selected in (run_fd,sha_fd,quarantine_fd,parent_fd): os.fsync(selected)
            source_stable(True);cache_stable()
            require(identity(os.stat('__pycache__',dir_fd=fd,follow_symlinks=False))==identity(cache_info))
            rename_exclusive(fd,'__pycache__',run_fd,binding)
        try:
            os.fsync(fd);os.fsync(run_fd)
            moved=os.stat(binding,dir_fd=run_fd,follow_symlinks=False)
            require([moved.st_dev,moved.st_ino,moved.st_mode,moved.st_uid,moved.st_gid,moved.st_nlink,moved.st_size,moved.st_mtime_ns]==preserved_identity)
            source_stable(False);cache_stable()
        except Exception:
            # Commit-window races cannot be undone safely. Preserve all moved bytes,
            # the original intent, and bounded metadata evidence; never activate.
            moved_fd=None
            try:
                moved_fd=os.open(binding,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=run_fd)
                actual_archive=refusal_snapshot(moved_fd,24)
            except OSError:
                actual_archive={'metadataUnavailable':True}
            finally:
                if moved_fd is not None: os.close(moved_fd)
            evidence={'schema':'qualified-control-cache-refusal/v1','runKey':run,'cacheBindingSHA256':binding,
                      'result':'post-rename-unproved','generation':refusal_snapshot(fd,35),
                      'archive':actual_archive,
                      'movedNodeMetadataSHA256':digest(repr(identity(os.stat(binding,dir_fd=run_fd,follow_symlinks=False))).encode())}
            durable_json(run_fd,'refusal.json',evidence)
            raise
        receipt['result']='quarantined-preserved';durable_json(run_fd,'receipt.json',receipt)
        return receipt
    finally:
        for selected in reversed(descriptors): os.close(selected)


def main():
    p=argparse.ArgumentParser();p.add_argument('--run-id',required=True);p.add_argument('--control-sha',required=True);a=p.parse_args()
    require(os.geteuid()==0 and sys.platform=='linux' and re.fullmatch('[0-9a-f]{40}',a.control_sha))
    for fd,path in ((9,'/var/lock/club-arena-engine-up.lock'),(8,'/var/lock/club-arena-source.lock')):
        info=os.fstat(fd);require(stat.S_ISREG(info.st_mode) and info.st_uid==0 and Path(os.readlink('/proc/self/fd/'+str(fd))).resolve(strict=True)==Path(path).resolve(strict=True))
    repo=Path('/opt/club-arena');deadline=time.monotonic()+5
    git_read(repo,['merge-base','--is-ancestor',a.control_sha,'origin/main'],deadline)
    require(Path(__file__).read_bytes()==git_read(repo,['show',a.control_sha+':server/scripts/quarantine-generated-control-cache.py'],deadline))
    answer=recover(Path('/usr/local/lib/club-arena'),repo,a.run_id)
    print('ENGINE_CONTROL_CACHE_QUARANTINE='+json.dumps(answer,sort_keys=True))


if __name__=='__main__':
    try: main()
    except Exception:
        print('[qualified-control-cache] REFUSED: exact generated cache custody unproved',file=sys.stderr)
        raise SystemExit(1)
