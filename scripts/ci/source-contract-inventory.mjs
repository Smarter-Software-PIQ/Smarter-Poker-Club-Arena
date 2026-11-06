// Reviewed dependency closures for expensive native wrappers. Every declaration
// is bound to the source that defines its reads; drift retains the test.
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executionInventory } from './vendor/agentExecution.mjs';
const safe = path => typeof path === 'string' && path && !isAbsolute(path) &&
  !path.includes('\\') && !path.includes('\0') &&
  !path.replace(/\/$/, '').split('/').some(part => !part || part === '.' || part === '..');
export function nativeContractInventory(inventory) {
  return executionInventory(inventory.tests.map(entry => ({...entry, id:entry.test,
    command:entry.test.endsWith('.mjs') ? ['node','--test',entry.test] : ['vitest','run',entry.test], runtime:entry.runtime || 'Node22/Python3/Git',
    environment:'isolated-native-fixture', risks:['verification','engine'], always:false,
    durationSeconds:entry.observedSeconds ?? null, replaces:entry.replacement ?? null})));
}
export function declaredContractSelection(root, changed, inventory) {
  if (!Array.isArray(changed) || !changed.every(safe) || inventory?.version !== 1 || !Array.isArray(inventory.tests))
    throw Error('Complete source-contract inputs required');
  nativeContractInventory(inventory);
  const decisions = new Map();
  for (const entry of inventory.tests) {
    if (!safe(entry.test) || decisions.has(entry.test) || !entry.owner || !entry.invariant ||
        !Array.isArray(entry.inputs) || !entry.inputs.length || !entry.inputs.every(safe) ||
        !entry.declarationFiles || !Object.hasOwn(entry.declarationFiles, entry.test))
      throw Error('Invalid source-contract dependency declaration');
    let valid = true;
    for (const [path, expected] of Object.entries(entry.declarationFiles)) {
      if (!safe(path) || !/^[0-9a-f]{64}$/.test(expected)) throw Error('Unsafe declaration identity');
      try { const file = resolve(root, path);
        valid &&= lstatSync(file).isFile() && realpathSync(file) === resolve(realpathSync(root), path) &&
          createHash('sha256').update(readFileSync(file)).digest('hex') === expected; }
      catch { valid = false; }
    }
    const affected = changed.filter(path => path === entry.test || Object.hasOwn(entry.declarationFiles, path) ||
      entry.inputs.some(input => input.endsWith('/') ? path.startsWith(input) : path === input));
    decisions.set(entry.test, { selected: !valid || affected.length > 0,
      reason: !valid ? 'Declaration source drift; retain native coverage' : affected.length ? 'Declared native input changed' : 'Reviewed native closure unchanged',
      affected, owner: entry.owner, invariant: entry.invariant });
  }
  return decisions;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inventory = JSON.parse(readFileSync(resolve('scripts/ci/source-contract-inputs.json'), 'utf8'));
  const decisions = declaredContractSelection(process.cwd(), process.argv.slice(2), inventory);
  // Emit only proved omissions. Missing/invalid inventory fails the caller.
  for (const [test, decision] of decisions) if (!decision.selected) console.log(test);
}
