import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runMaintenanceThawV3, assertMaintenanceThawRelease } from './old-eed-maintenanceThawV3.ts';
assert.equal(createHash('sha256').update(readFileSync(new URL('./old-eed-maintenanceThawV3.ts', import.meta.url))).digest('hex'), 'ea315cc4a88057382fcb56ccd2ed83b6a3e1ee4371b54a639336c938c403acf9');
const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const final = raw.results.at(-1);
const request = {
  announcedAt: Math.trunc(Number(raw.announcedAt)),
  freezeStartedAt: Date.parse(final.freeze_started_at),
  frozenSeconds: 300,
  ownershipToken: final.ownership_token,
  thawedBy: 'old EED qualification',
};
for (const responses of [raw.results, [raw.replay]]) {
  let calls = 0;
  const receipt = await runMaintenanceThawV3(request, async (args) => {
    assert.equal(Date.parse(args.p_freeze_started), request.freezeStartedAt);
    assert.equal(args.p_ownership_token, request.ownershipToken);
    assert.equal(args.p_frozen_seconds, 300);
    return responses[calls++];
  }, { signal: new AbortController().signal, sleep: async () => {} });
  assert.equal(calls, responses.length);
  assertMaintenanceThawRelease(request, receipt);
  assert.equal(receipt.creditedThroughAt, request.announcedAt + 420000);
  assert.equal(receipt.effectiveFrozenSeconds, 300.001);
}
console.log('PASS immutable EED client accepts original raw identity and complete promise receipt');

// Execute both actual pause owners with the SQL-qualified receipt values.
// The store adapter models token rotation; PostgreSQL above separately proves
// that same rotation across committed installments and all clock targets.
const captured = JSON.parse(readFileSync(new URL('./old-eed-modules.json', import.meta.url), 'utf8'));
const hashes = {
  MaintenanceBreak: 'eeb5342d32ea50d5c230dbe955382fa5eee823a1a90c9e5ebb9ab2f227e345c1',
  maintenanceSchedule: '4ff8b207c8c198fc2b475108fe2561a7c03d05506efac1d6673279bb059c06f6',
  maintenanceThawV3: 'ea315cc4a88057382fcb56ccd2ed83b6a3e1ee4371b54a639336c938c403acf9',
  reconnectFreeze: '3d7adc086968b678e6add4abdea9ca1693056ebbea6e3a258262db9b69f034d6',
  freezeState: 'a4f9065c9059bdf965c6e453ecb1996f849b75e318679ec72c76c6cb147125d0',
};
for (const [name, hash] of Object.entries(hashes)) {
  assert.equal(createHash('sha256').update(captured[name]).digest('hex'), hash);
}
const { mkdirSync, writeFileSync } = await import('node:fs');
const { dirname, join, resolve } = await import('node:path');
const { pathToFileURL } = await import('node:url');
const ts = (await import('typescript')).default;
for (const revision of ['eed06fe51dea622069c661a6213d5b031ff3a9e3', 'candidate']) {
  const folder = join(dirname(process.argv[2]), revision);
  mkdirSync(folder);
  writeFileSync(join(folder, 'package.json'), '{"type":"module"}');
  for (const name of ['MaintenanceBreak', 'maintenanceSchedule', 'maintenanceThawV3', 'reconnectFreeze', 'freezeState']) {
    const path = `server/src/maintenance/${name}.ts`;
    const source = revision === 'candidate' ? readFileSync(resolve(path), 'utf8') : captured[name];
    if (revision !== 'candidate' && name === 'MaintenanceBreak') {
      assert.equal(createHash('sha256').update(source).digest('hex'), 'eeb5342d32ea50d5c230dbe955382fa5eee823a1a90c9e5ebb9ab2f227e345c1');
    }
    writeFileSync(join(folder, `${name}.js`), ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText);
  }
  if (revision === 'candidate') writeFileSync(join(folder, 'maintenanceSchedulePolicy.json'), readFileSync('server/src/maintenance/maintenanceSchedulePolicy.json'));
  const { MaintenanceBreak } = await import(pathToFileURL(join(folder, 'MaintenanceBreak.js')));
  const promised = request.announcedAt + 420000;
  let now = promised - 2;
  let resumed = 0;
  let boundaryReads = 0;
  let row = { phase: 'counting_down', reason: 'Deployment Recovery', announcedAt: request.announcedAt,
    breakStartedAt: request.freezeStartedAt, breakEndsAt: promised - 1, ownershipToken: request.ownershipToken };
  const table = { pauseForMaintenance() {}, resumeFromMaintenance() { resumed++; },
    isParkedBetweenHands: () => true, isBetweenHands: () => true, isRunning: () => true };
  const owner = new MaintenanceBreak({
    now: () => now, engines: () => [['native-qualified-table', table]][Symbol.iterator](),
    isRunning: () => true, emit() {}, setTimer: () => ({}), clearTimer() {},
    store: {
      async load() { return row; },
      async claim(oldToken, newToken) { assert.equal(oldToken, row.ownershipToken); row = { ...row, ownershipToken: newToken }; return row; },
      async save() { assert.fail('adopted countdown must retain raw identity'); },
      async clear() { assert.fail('v3 owns the exact row clear'); },
      async loadReleaseBoundary() { boundaryReads++; return now < promised ? promised : null; },
    },
    async thaw(actual) {
      assert.equal(actual.freezeStartedAt, request.freezeStartedAt);
      assert.equal(actual.announcedAt, request.announcedAt);
      return { ...actual, creditedThroughAt: Date.parse(final.credited_through_at), effectiveFrozenSeconds: Number(final.effective_frozen_seconds) };
    },
  });
  await owner.start();
  assert.equal(owner.breakStartedAt, request.freezeStartedAt);
  assert.equal(owner.breakEndsAt, promised - 1);
  const ending = owner.end();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(resumed, 0, `${revision} cannot resume at the raw early end`);
  assert.ok(boundaryReads > 0, 'actual owner rechecks database release floor');
  now = promised;
  await ending;
  assert.equal(resumed, 1);
  await owner.stop();
  console.log(`PASS ${revision} actual adoption and end retain raw identity and wait for original promise`);
}
