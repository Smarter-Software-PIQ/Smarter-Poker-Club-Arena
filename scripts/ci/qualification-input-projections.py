#!/usr/bin/env python3
"""Bind qualification execution/admission inputs without pinning unrelated CI jobs.

Dependency-free, directly invoked, and fail closed on unsupported workflow shape.
Never runs a qualification, modifies a financial result, or publishes anything.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_OUTPUT = 'scripts/qualification/ci-accounting-inputs.json'
ADMISSION_OUTPUT = 'scripts/qualification/ci-admission-inputs.json'
BINDINGS = {
    'tests/fixtures/earlybird-fee-custody/source-binding.json': 'repository_files',
    'scripts/qualification/cash-native-hosted.manifest.json': 'files',
    'scripts/qualification/cash-original17/source-binding.json': 'files',
    'scripts/qualification/original-flow-eligibility/source-binding.json': 'files',
    'scripts/qualification/weekly-cohort-cutoff/source-binding.json': 'files',
    'scripts/qualification/weekly-initial-selector/source-binding.json': 'files',
    'scripts/qualification/weekly-standalone-selector/source-binding.json': 'files',
    'tests/fixtures/full-weekly-accounting/source-binding.json': 'repository_fixtures',
    'tests/fixtures/legacy-fee-finality/source-binding.json': 'repository_files',
    'tests/fixtures/sep8-spin-custody/source-binding.json': 'repository_files',
}
SELF = 'scripts/ci/qualification-input-projections.py'



def workflow_projection(source: str) -> dict:
    # The current maintained workflow uses block mappings and two-space job
    # headings. No lossy YAML parsing, shell normalization or guessed anchors.
    if '\t' in source or len(re.findall(r'^jobs:\s*$', source, re.M)) != 1:
        raise ValueError('Unsupported workflow job mapping; preserve qualification')
    prefix, jobs = re.split(r'^jobs:\s*\n', source, maxsplit=1, flags=re.M)
    headings = list(re.finditer(r'^  ([A-Za-z0-9_-]+):\s*\n', jobs, re.M))
    if not headings or len({m[1] for m in headings}) != len(headings):
        raise ValueError('Missing or duplicate workflow job headings')
    blocks = {m[1]: jobs[m.start():headings[i+1].start() if i+1 < len(headings) else len(jobs)]
              for i, m in enumerate(headings)}
    for required in ('changes', 'accounting_postgres'):
        if required not in blocks:
            raise ValueError('Qualification job missing: ' + required)
    # Accounting's admission is owned by `changes`; any newly introduced
    # producer dependency must be modeled before this projection can qualify.
    consumed = sorted(set(re.findall(r'needs\.changes\.outputs\.([A-Za-z0-9_]+)', blocks['accounting_postgres'])))
    if 'server' not in consumed:
        raise ValueError('Accounting admission must retain its declared server dependency')
    changes = blocks['changes']
    output_header = re.search(r'^    outputs:\s*\n', changes, re.M)
    if not output_header:
        raise ValueError('Immutable admission output mapping missing')
    next_field = re.search(r'^    [A-Za-z0-9_-]+:', changes[output_header.end():], re.M)
    output_end = output_header.end() + next_field.start() if next_field else len(changes)
    selected_outputs = {}
    for line in changes[output_header.end():output_end].splitlines(keepends=True):
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        entry = re.fullmatch(r'      ([A-Za-z0-9_]+):[^\n]+\n?', line)
        if not entry:
            raise ValueError('Unsupported admission output shape')
        if entry[1] in consumed:
            selected_outputs[entry[1]] = line
    if set(selected_outputs) != set(consumed):
        raise ValueError('A consumed qualification output is missing')
    blocks['changes'] = changes[:output_header.end()] + ''.join(selected_outputs[key] for key in consumed) + changes[output_end:]
    context = prefix + ''.join(blocks[name] for name in ('changes', 'accounting_postgres'))
    scalar_indent = None
    for line in context.splitlines():
        indent = len(line) - len(line.lstrip())
        if scalar_indent is not None and (not line.strip() or indent > scalar_indent):
            continue
        scalar_indent = None
        if re.search(r'(?:^\s*|:\s*|[\[,]\s*)[&*][A-Za-z_][\w-]*', line):
            raise ValueError('Qualification anchors/aliases require explicit dependency support')
        if re.search(r':\s*[|>][+-]?\s*(?:#.*)?$', line):
            scalar_indent = indent
    accounting = blocks['accounting_postgres']
    if not re.search(r'^    needs: changes\s*$', accounting, re.M):
        raise ValueError('Accounting dependencies changed; qualification projection must be extended')
    return {'schemaVersion': 1, 'source': '.github/workflows/ci.yml',
            'scope': 'Global workflow context, exact accounting execution and immutable admission producer',
            'globalContext': prefix, 'consumedClassifierFlags': [key for key in consumed if key in {'src','server','tests','phase4','fixture'}], 'jobs': {name: blocks[name] for name in ('changes', 'accounting_postgres')}}


def admission_paths(root: Path) -> list[str]:
    paths = {'.github/workflows/ci.yml', 'scripts/ci/classify-ci-changes.mjs',
             WORKFLOW_OUTPUT, ADMISSION_OUTPUT, SELF}
    for name, section in BINDINGS.items():
        document = json.loads((root / name).read_text())
        if not isinstance(document.get(section), dict) or not document[section]:
            raise ValueError('Missing active source map: ' + name)
        required = {SELF, WORKFLOW_OUTPUT, ADMISSION_OUTPUT}
        if not required.issubset(document[section]):
            raise ValueError('Qualification projection pin missing: ' + name)
        if {'.github/workflows/ci.yml', 'scripts/ci/classify-ci-changes.mjs', 'tests/unit/fixtureNativeCi.test.ts'} & set(document[section]):
            raise ValueError('Whole-workflow/classifier/test-catalog coupling retained: ' + name)
        paths.update(document[section])
    return sorted(paths)


def admission_projection(root: Path, paths: list[str], consumed_flags=('server', 'phase4')) -> dict:
    code = r"""
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const m = await import('./scripts/ci/classify-ci-changes.mjs');
const {paths,consumedFlags} = JSON.parse(readFileSync(0, 'utf8'));
const unknown = m.classifyChangedPaths(null);
const keys = ['fixture','phase4','server','src','tests'];
if (JSON.stringify(Object.keys(unknown).sort()) !== JSON.stringify(keys) || !Object.values(unknown).every(value => value === true)) throw Error('Unknown input must retain all suites');
const immutableDiffSHA256 = createHash('sha256').update(m.classifyGitChanges.toString() + m.gitEnvironmentForCwd.toString()).digest('hex');
process.stdout.write(JSON.stringify({schemaVersion:1,source:'scripts/ci/classify-ci-changes.mjs',immutableDiffSHA256,unknown,
  consumedFlags,cases:Object.fromEntries(paths.map(path => {const flags=m.classifyChangedPaths([path]);return [path,Object.fromEntries(consumedFlags.map(key=>[key,flags[key]]))]}))}));
"""
    result = subprocess.run(['node', '--input-type=module', '-e', code], cwd=root,
                            input=json.dumps({'paths': paths, 'consumedFlags': list(consumed_flags)}), text=True, capture_output=True, timeout=30, check=True)
    return json.loads(result.stdout)


def encoded(value: dict) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()


def expected(root: Path) -> dict[str, bytes]:
    workflow = workflow_projection((root / '.github/workflows/ci.yml').read_text())
    admission = admission_projection(root, admission_paths(root), workflow['consumedClassifierFlags'])
    return {WORKFLOW_OUTPUT: encoded(workflow), ADMISSION_OUTPUT: encoded(admission)}


def check(root: Path = ROOT) -> None:
    for name, value in expected(root).items():
        if (root / name).read_bytes() != value:
            raise ValueError('Qualification input projection differs: ' + name + '; inspect the actual connected change before regenerating')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--check', action='store_true')
    group.add_argument('--write', action='store_true', help='Explicit source generation only; never changes qualification status or source pins')
    args = parser.parse_args()
    if args.write:
        for name, value in expected(ROOT).items():
            (ROOT / name).write_bytes(value)
        print('Generated execution/admission projections; source pins and qualification results untouched.')
    else:
        check()
        print('Qualification workflow and admission projections match their actual inputs.')


if __name__ == '__main__':
    main()
