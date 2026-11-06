import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { declaredContractSelection } from '../../scripts/ci/source-contract-inventory.mjs';
test('native input declarations defeat filename collisions but preserve real inputs and drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'contract-inputs-'));
  try {
    mkdirSync(join(root, 'tests'));
    writeFileSync(join(root, 'tests/native.test.ts'), 'native source');
    const entry = { test: 'tests/native.test.ts', owner: 'test owner', invariant: 'native behavior',
      inputs: ['tests/fixtures/native/', 'scripts/native.py'],
      declarationFiles: {'tests/native.test.ts':createHash('sha256').update('native source').digest('hex')} };
    const inventory = {version:1,tests:[entry]};
    const selected = paths => declaredContractSelection(root, paths, inventory).get(entry.test).selected;
    assert.equal(selected(['tests/fixtures/unrelated/source-binding.json']), false);
    for (const path of ['tests/fixtures/native/source-binding.json','tests/fixtures/native/new.sql','scripts/native.py','tests/native.test.ts'])
      assert.equal(selected([path]), true);
    writeFileSync(join(root, entry.test), 'new source with an undeclared dependency');
    assert.equal(selected(['unrelated.md']), true);
    rmSync(join(root, entry.test));
    assert.equal(selected(['unrelated.md']), true);
    writeFileSync(join(root, 'target'), 'native source');
    symlinkSync(join(root, 'target'), join(root, entry.test));
    assert.equal(selected(['unrelated.md']), true);
    assert.throws(()=>declaredContractSelection(root, ['../escape'], inventory));
    assert.throws(()=>declaredContractSelection(root, [], {version:1,tests:[entry,entry]}));
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('actual native wrapper closure and both owning selection entrypoints are connected', () => {
  const root = process.cwd();
  const inventory = JSON.parse(readFileSync('scripts/ci/source-contract-inputs.json','utf8'));
  const wrapper = 'tests/a-waiting-release-withdrawal-keeps-its-original-owner.law.test.ts';
  const result = declaredContractSelection(root, ['tests/fixtures/unrelated/source-binding.json'], inventory);
  assert.equal(result.get(wrapper).selected, false);
  for (const input of ['scripts/ci/withdraw-waiting-engine-release.py','tests/operations/pinned-history-sources.py',
    'server/scripts/engine-release-transaction.sh','.github/workflows/auto-deploy-hetzner.yml'])
    assert.equal(declaredContractSelection(root,[input],inventory).get(wrapper).selected,true);
  const cli=execFileSync(process.execPath,['scripts/ci/source-contract-inventory.mjs','tests/fixtures/unrelated/source-binding.json'],{encoding:'utf8'});
  assert.equal(cli.trim(),wrapper);
  const hook=readFileSync('.husky/pre-push','utf8');
  assert.match(hook,/UNCHANGED_NATIVE_CONTRACTS=\$\(node .*source-contract-inventory\.mjs.*\|\| exit 1/);
  assert.match(hook,/\$UNCHANGED_NATIVE_CONTRACTS.*continue/);
  assert.match(readFileSync('scripts/ci/ui-test-selection.mjs','utf8'),/if \(declared\.has\(p\)\) return declared\.get\(p\)\.selected/);
});
