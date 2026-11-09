import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runOwnedCommand } from '../server/scripts/qualification/retained-original-checkpoint/owned-command.mjs';

test('timeout terminates the actual launcher and its inherited-pipe worker', () => {
  const started = performance.now();
  const result = runOwnedCommand(
    process.execPath,
    [
      '-e',
      `
    const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
    console.log(child.pid);
    setInterval(()=>{},1000);
  `,
    ],
    { encoding: 'utf8', timeout: 500, maxBuffer: 4096 }
  );
  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.equal(result.status, null);
  assert.ok(performance.now() - started < 4000);
  const pid = Number(result.stdout.trim());
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const state = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], {
    encoding: 'utf8',
    timeout: 500,
  });
  assert.ok(state.status === 1 || /^Z/.test(state.stdout.trim()), state.stdout);
});
test('successful output and real failure status remain authoritative', () => {
  const options = { encoding: 'utf8', timeout: 1000, maxBuffer: 4096 };
  const good = runOwnedCommand(process.execPath, ['-e', 'console.log("exact receipt")'], options);
  assert.equal(good.status, 0);
  assert.equal(good.stdout.trim(), 'exact receipt');
  const bad = runOwnedCommand(process.execPath, ['-e', 'process.exit(73)'], options);
  assert.equal(bad.status, 73);
});

test('an absent owned group returns its result without requiring a process census', (t) => {
  t.mock.method(process, 'kill', (pid, signal) => {
    assert.ok(pid < 0);
    assert.equal(signal, 'SIGKILL');
    throw Object.assign(new Error('owned group absent'), { code: 'ESRCH' });
  });
  // The actual child uses an absolute executable; only the subsequent ps census
  // is unavailable. Kernel-confirmed absence must not depend on that census.
  const originalPath = process.env.PATH;
  process.env.PATH = '/nonexistent-owned-command-regression';
  try {
    const result = runOwnedCommand(process.execPath, ['-e', 'console.log("absent receipt")'], {
      encoding: 'utf8',
      timeout: 1000,
      maxBuffer: 4096,
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), 'absent receipt');
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
});

test('a successfully signalled group still refuses an unreadable census', (t) => {
  t.mock.method(process, 'kill', (pid, signal) => {
    assert.ok(pid < 0);
    assert.equal(signal, 'SIGKILL');
  });
  const originalPath = process.env.PATH;
  process.env.PATH = '/nonexistent-owned-command-regression';
  try {
    assert.throws(
      () =>
        runOwnedCommand(process.execPath, ['-e', ''], {
          encoding: 'utf8',
          timeout: 1000,
          maxBuffer: 4096,
        }),
      /Owned qualification process cleanup unreadable/
    );
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
});

test('group termination permission errors remain authoritative', (t) => {
  const denied = Object.assign(new Error('owned group denied'), { code: 'EPERM' });
  t.mock.method(process, 'kill', () => {
    throw denied;
  });
  assert.throws(
    () =>
      runOwnedCommand(process.execPath, ['-e', ''], {
        encoding: 'utf8',
        timeout: 1000,
        maxBuffer: 4096,
      }),
    (error) => error === denied
  );
});

test('historical capacity preserves all cases and distinct cleanup headroom', async () => {
  const { readFileSync } = await import('node:fs');
  const driver = readFileSync(
    new URL(
      '../server/scripts/qualification/retained-original-checkpoint/qualify.mjs',
      import.meta.url
    ),
    'utf8'
  );
  const wrapper = readFileSync(
    new URL(
      '../server/src/engine/RetainedHistoricalCheckpointQualification.test.ts',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(driver, /nativeMode \? 180000 : 480000/);
  assert.match(driver, /runOwnedCommand\(program, args/);
  assert.match(driver, /nativeMode \? 60000 : 360000/);
  assert.match(driver, /result\.numTotalTests === \(nativeMode \? 72 : 80\)/);
  assert.match(driver, /result\.numPassedTests === \(nativeMode \? 2 : 80\)/);
  assert.match(driver, /result\.numFailedTests === 0/);
  assert.match(wrapper, /timeout: 510_000/);
  assert.match(wrapper, /}, 540_000\)/);
});
