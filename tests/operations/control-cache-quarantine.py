#!/usr/bin/env python3
"""Actual immutable-source files and native exclusive rename, in owned scratch only."""
import ctypes
import hashlib
import io
import importlib.util
import json
import marshal
import os
import py_compile
from pathlib import Path
import shlex
import stat
import struct
import subprocess
import sys
import tempfile
import tarfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
SPEC=importlib.util.spec_from_file_location('cache_quarantine',ROOT/'server/scripts/quarantine-generated-control-cache.py')
Q=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(Q)
CLEAN={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
CLEAN.update(GIT_NO_REPLACE_OBJECTS='1',GIT_NO_LAZY_FETCH='1',GIT_OPTIONAL_LOCKS='0')
ARCHIVE=subprocess.check_output(['git','-C',str(ROOT),'archive',Q.OLD,*['server/scripts/'+name for name in Q.SOURCE_HASHES]],env=CLEAN,timeout=10)
assert len(ARCHIVE)<=2*Q.CAP
with tarfile.open(fileobj=io.BytesIO(ARCHIVE)) as archive:
    SOURCES={name:archive.extractfile('server/scripts/'+name).read() for name in Q.SOURCE_HASHES}
assert all(hashlib.sha256(raw).hexdigest()==Q.SOURCE_HASHES[name] for name,raw in SOURCES.items())
INSTALLER=(ROOT/'server/scripts/install-engine-supervisor.sh').read_text()
RUN='41316608416-1'


class CacheQuarantine(unittest.TestCase):
    def scene(self,folder):
        parent=Path(folder).resolve();generation=parent/'engine-control-generations'/Q.OLD;generation.mkdir(parents=True)
        for name,raw in SOURCES.items(): (generation/name).write_bytes(raw)
        # The original manifest order is part of the qualified exact hash.
        old=SOURCES['install-engine-supervisor.sh'].decode();block=old.split('REQUIRED_FILES=(\n',1)[1].split('\n)',1)[0]
        names=[line.strip() for line in block.splitlines() if line.strip()]
        manifest=('\n'.join(names)+'\n').encode();self.assertEqual(Q.digest(manifest),Q.MANIFEST_SHA)
        (generation/'generation-files').write_bytes(manifest);(generation/'control-sha').write_text(Q.OLD+'\n')
        (parent/'engine-control').symlink_to(generation)
        return parent,generation

    def cache(self,generation,opt=0,flags=0,source='engine-release-database-proof.py',filename=None):
        directory=generation/'__pycache__';directory.mkdir(exist_ok=True)
        name=source[:-3]+'.'+sys.implementation.cache_tag+('' if opt==0 else '.opt-'+str(opt))+'.pyc'
        path=directory/name
        mode={0:py_compile.PycInvalidationMode.TIMESTAMP,1:py_compile.PycInvalidationMode.UNCHECKED_HASH,3:py_compile.PycInvalidationMode.CHECKED_HASH}[flags]
        py_compile.compile(str(generation/source),cfile=str(path),dfile=filename or str(Q.CANONICAL/source),
                           doraise=True,optimize=opt,invalidation_mode=mode)
        return path

    def snapshot(self,generation):
        return {str(p.relative_to(generation)):('symlink',os.readlink(p)) if p.is_symlink() else ('file',p.read_bytes(),p.stat().st_mode,p.stat().st_mtime_ns) if p.is_file() else ('directory',p.stat().st_mode) for p in generation.rglob('*')}

    def strict(self,parent,generation):
        start=INSTALLER.index('validate_v1_protocol() {');end=INSTALLER.index('\nquarantine_known_generated_cache()',start)
        functions=INSTALLER[start:end]
        shim=parent/'readlink';shim.write_text('#!/usr/bin/env python3\nfrom pathlib import Path\nimport sys\nprint(Path(sys.argv[-1]).resolve(strict=True))\n');shim.chmod(0o755)
        q=shlex.quote
        code='set -euo pipefail\nREPO_DIR='+q(str(ROOT))+'\nCONTROL_DIR='+q(str(parent/'engine-control'))+'\nGENERATION_ROOT='+q(str(parent/'engine-control-generations'))+'\nPROTOCOL_V1_FILE=engine-release-protocol-v1.schema\nPROTOCOL_V1_SHA256=7c5aba4d2bc572edc5ef84c5280e1ffe517e5949b41788c18eeb003abea74044\nCORE_FILES=(engine-supervisor.sh engine-up.sh engine-release-protocol-v1.schema engine-release-seal.py verify-recovery-stack.sh)\ndie(){ echo "$*" >&2; exit 1; }\n'
        code+='if ! type mapfile >/dev/null 2>&1; then mapfile(){ local target="$2" line; eval "$target=()"; while IFS= read -r line; do eval "$target+=(\\\"\\$line\\\")"; done; }; fi\n'
        return subprocess.run(['bash','-c',code+functions+'\nvalidate_active_generation '+Q.OLD],env={**CLEAN,'PATH':str(parent)+os.pathsep+CLEAN['PATH']},capture_output=True,text=True)

    def test_old_strict_refuses_cache_new_quarantine_preserves_then_strict_passes(self):
        with tempfile.TemporaryDirectory() as folder:
            parent,generation=self.scene(folder)
            self.assertEqual(self.strict(parent,generation).returncode,0)
            path=self.cache(generation);before=path.read_bytes()
            self.assertNotEqual(self.strict(parent,generation).returncode,0)
            result=Q.recover(parent,ROOT,RUN,os.getuid())
            self.assertEqual(result['result'],'quarantined-preserved')
            preserved=parent/'engine-control-cache-quarantine'/Q.OLD/RUN/result['cacheBindingSHA256']/path.name
            self.assertEqual(preserved.read_bytes(),before)
            self.assertFalse((generation/'__pycache__').exists())
            self.assertEqual(self.strict(parent,generation).returncode,0)
            self.assertEqual(json.loads((preserved.parent.parent/'receipt.json').read_text()),result)

    def test_each_supported_header_and_optimization_exact_payload(self):
        with tempfile.TemporaryDirectory() as folder:
            parent,generation=self.scene(folder)
            for flags,opt in ((0,0),(1,1),(3,2)): self.cache(generation,opt,flags)
            result=Q.recover(parent,ROOT,RUN,os.getuid())
            self.assertEqual(len(result['entries']),3)

    def test_unknown_files_sources_headers_payload_and_metadata_refuse_untouched(self):
        cases=('foreign','magic','flags','timestamp','sourcehash','payload','filename','child-symlink','child-hardlink','cache-symlink','writable-cache','writable-file','extra-generation','source-change','manifest-change','wrong-control','empty-cache','too-many','oversized')
        for case in cases:
            with self.subTest(case=case),tempfile.TemporaryDirectory() as folder:
                parent,generation=self.scene(folder);path=self.cache(generation,flags=3 if case=='sourcehash' else 0,filename='foreign.py' if case=='filename' else None)
                raw=path.read_bytes()
                if case=='foreign': path.rename(path.with_name('foreign.pyc'))
                if case=='magic': path.write_bytes(b'bad!'+raw[4:])
                if case=='flags': path.write_bytes(raw[:4]+struct.pack('<I',2)+raw[8:])
                if case in ('timestamp','sourcehash'): path.write_bytes(raw[:8]+b'0'*8+raw[16:])
                if case=='payload': path.write_bytes(raw+b'x')
                if case=='child-symlink': path.unlink();path.symlink_to(generation/'engine-release-database-proof.py')
                if case=='child-hardlink': os.link(path,path.with_name('other.pyc'))
                if case=='cache-symlink':
                    actual=parent/'foreign-cache';path.parent.rename(actual);(generation/'__pycache__').symlink_to(actual)
                if case=='writable-cache': path.parent.chmod(0o777)
                if case=='writable-file': path.chmod(0o666)
                if case=='extra-generation': (generation/'unknown').write_text('retained')
                if case=='source-change': (generation/'engine-release-database-proof.py').write_text('changed')
                if case=='manifest-change': (generation/'generation-files').write_text('changed')
                if case=='wrong-control': (generation/'control-sha').write_text('f'*40+'\n')
                if case=='empty-cache': path.unlink()
                if case=='too-many':
                    for i in range(25): (path.parent/('unknown'+str(i))).write_text('retained')
                if case=='oversized': path.write_bytes(b'x'*(Q.CAP+1))
                before=self.snapshot(generation)
                with self.assertRaises((ValueError,OSError)): Q.recover(parent,ROOT,RUN,os.getuid())
                self.assertEqual(self.snapshot(generation),before)
                self.assertFalse((parent/'engine-control-cache-quarantine').exists())

    def test_source_or_cache_race_before_rename_refuses(self):
        for target in ('source','cache'):
            with self.subTest(target=target),tempfile.TemporaryDirectory() as folder:
                parent,generation=self.scene(folder);path=self.cache(generation)
                original=Q.private_child;changed=False
                def race(*args):
                    nonlocal changed
                    fd=original(*args)
                    if not changed:
                        changed=True
                        (generation/'engine-release-database-proof.py' if target=='source' else path).write_text('foreign concurrent bytes')
                    return fd
                with patch.object(Q,'private_child',side_effect=race),self.assertRaises(ValueError): Q.recover(parent,ROOT,RUN,os.getuid())
                self.assertTrue((generation/'__pycache__').is_dir())
                self.assertEqual((generation/'engine-release-database-proof.py' if target=='source' else path).read_text(),'foreign concurrent bytes')

    def test_native_exclusive_rename_never_overwrites(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'source').mkdir();(root/'target').mkdir();(root/'source/original').write_text('preserved')
            fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
            try:
                with self.assertRaises(FileExistsError): Q.rename_exclusive(fd,'source',fd,'target')
            finally: os.close(fd)
            self.assertEqual((root/'source/original').read_text(),'preserved');self.assertEqual(list((root/'target').iterdir()),[])

    def test_recreated_cache_remains_refused_preserving_quarantine(self):
        with tempfile.TemporaryDirectory() as folder:
            parent,generation=self.scene(folder);path=self.cache(generation);original_bytes=path.read_bytes();rename=Q.rename_exclusive
            def recreate(*args):
                rename(*args);(generation/'__pycache__').mkdir();(generation/'__pycache__/unknown').write_text('foreign retained')
            with patch.object(Q,'rename_exclusive',side_effect=recreate),self.assertRaises(ValueError): Q.recover(parent,ROOT,RUN,os.getuid())
            self.assertEqual((generation/'__pycache__/unknown').read_text(),'foreign retained')
            preserved=list((parent/'engine-control-cache-quarantine'/Q.OLD/RUN).glob('*/'+path.name));self.assertEqual(len(preserved),1);self.assertEqual(preserved[0].read_bytes(),original_bytes)
            self.assertNotEqual(self.strict(parent,generation).returncode,0)

    def test_existing_run_unknown_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            parent,generation=self.scene(folder);self.cache(generation)
            existing=parent/'engine-control-cache-quarantine'/Q.OLD/RUN;existing.mkdir(parents=True,mode=0o700);existing.parent.chmod(0o700);existing.parent.parent.chmod(0o700)
            (existing/'retained').write_text('unknown receipt');before=self.snapshot(generation)
            with self.assertRaises(FileExistsError): Q.recover(parent,ROOT,RUN,os.getuid())
            self.assertEqual(self.snapshot(generation),before);self.assertEqual((existing/'retained').read_text(),'unknown receipt')

    def test_commit_window_child_race_refuses_preserving_every_moved_byte(self):
        with tempfile.TemporaryDirectory() as folder:
            parent,generation=self.scene(folder);path=self.cache(generation);rename=Q.rename_exclusive
            changed=b'unknown bytes written by the concurrent fixture owner'
            def race(*args):
                path.write_bytes(changed);rename(*args)
            with patch.object(Q,'rename_exclusive',side_effect=race),self.assertRaises(ValueError): Q.recover(parent,ROOT,RUN,os.getuid())
            run=parent/'engine-control-cache-quarantine'/Q.OLD/RUN
            archived=list(run.glob('*/'+path.name));self.assertEqual(len(archived),1);self.assertEqual(archived[0].read_bytes(),changed)
            self.assertTrue((run/'intent.json').is_file() and (run/'refusal.json').is_file());self.assertFalse((run/'receipt.json').exists())
            with self.assertRaises((ValueError,OSError)): Q.recover(parent,ROOT,RUN,os.getuid())
            self.assertEqual(archived[0].read_bytes(),changed)

    def test_commit_window_directory_swap_preserves_foreign_and_original_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            parent,generation=self.scene(folder);path=self.cache(generation);original=path.read_bytes();rename=Q.rename_exclusive
            def swap(*args):
                path.parent.rename(parent/'foreign-retained-original')
                path.parent.mkdir();(path.parent/'foreign').write_bytes(b'unknown preserved directory')
                rename(*args)
            activation=[]
            with patch.object(Q,'rename_exclusive',side_effect=swap),self.assertRaises(ValueError):
                Q.recover(parent,ROOT,RUN,os.getuid());activation.append(True)
            self.assertEqual(activation,[])
            self.assertEqual((parent/'foreign-retained-original'/path.name).read_bytes(),original)
            run=parent/'engine-control-cache-quarantine'/Q.OLD/RUN
            archived=list(run.glob('*/foreign'));self.assertEqual(len(archived),1);self.assertEqual(archived[0].read_bytes(),b'unknown preserved directory')
            evidence=json.loads((run/'refusal.json').read_text());self.assertEqual(evidence['archive']['countLowerBound'],1)
            self.assertFalse((run/'receipt.json').exists())

    def test_actual_process_exit_after_rename_resumes_original_disposition_once(self):
        with tempfile.TemporaryDirectory() as folder:
            parent,generation=self.scene(folder);path=self.cache(generation);original=path.read_bytes()
            pid=os.fork()
            if pid==0:
                rename=Q.rename_exclusive
                def interrupt(*args): rename(*args);os._exit(73)
                Q.rename_exclusive=interrupt
                try: Q.recover(parent,ROOT,RUN,os.getuid())
                except BaseException: os._exit(74)
                os._exit(75)
            _,status=os.waitpid(pid,0);self.assertEqual(os.waitstatus_to_exitcode(status),73)
            run=parent/'engine-control-cache-quarantine'/Q.OLD/RUN
            self.assertTrue((run/'intent.json').is_file());self.assertFalse((run/'receipt.json').exists())
            with patch.object(Q,'rename_exclusive',side_effect=AssertionError('duplicate move')):
                first=Q.recover(parent,ROOT,RUN,os.getuid());before=(run/'receipt.json').stat()
                again=Q.recover(parent,ROOT,RUN,os.getuid())
            self.assertEqual(first,again);self.assertEqual((run/'receipt.json').stat().st_ino,before.st_ino)
            self.assertEqual((run/first['cacheBindingSHA256']/path.name).read_bytes(),original)
            self.assertEqual(self.strict(parent,generation).returncode,0)
            # A recreated cache after interruption is UNKNOWN, never another move.
            (generation/'__pycache__').mkdir();(generation/'__pycache__/foreign').write_text('retained')
            with self.assertRaises((ValueError,OSError)): Q.recover(parent,ROOT,RUN,os.getuid())
            self.assertEqual((generation/'__pycache__/foreign').read_text(),'retained')

    def test_original_strict_validator_and_production_entry_bindings_are_preserved(self):
        old=subprocess.check_output(['git','-C',str(ROOT),'show','41551479ba47a4f077d6ed83f1b388c2b068fdd3:server/scripts/install-engine-supervisor.sh'],env=CLEAN).decode()
        def strict(source): return source[source.index('validate_active_generation() {'):source.index('\n}',source.index('validate_active_generation() {'))+2]
        self.assertEqual(strict(INSTALLER),strict(old))
        call=INSTALLER.index('    quarantine_known_generated_cache "$ACTIVE_CONTROL_SHA"')
        self.assertGreater(call,INSTALLER.index('flock -w 90 8'));self.assertLess(call,INSTALLER.index('    validate_active_generation "$ACTIVE_CONTROL_SHA"'))
        binding=INSTALLER.index("sha + ':server/scripts/quarantine-generated-control-cache.py'")
        execution=INSTALLER.index('30s python3 -I -B "$helper"')
        self.assertLess(binding,execution)
        self.assertIn("GIT_NO_LAZY_FETCH='1'",INSTALLER[binding-700:execution])
        helper=(ROOT/'server/scripts/quarantine-generated-control-cache.py').read_text()
        self.assertIn("recover(Path('/usr/local/lib/club-arena'),repo,a.run_id)",helper)
        self.assertIn("os.geteuid()==0 and sys.platform=='linux'",helper)
        self.assertNotIn('marshal.loads',helper);self.assertNotIn('shutil',helper)
        self.assertIn("sys.platform=='linux'",helper);self.assertIn('call=libc.renameat2;flag=1',helper)


if __name__=='__main__': unittest.main()
