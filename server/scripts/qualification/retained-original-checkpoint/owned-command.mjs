import { spawnSync } from 'node:child_process';

// Each command owns a fresh POSIX process group. Killing only the launcher on a
// timeout leaves Vitest workers running after their scratch directory is removed.
export function runOwnedCommand(program, args, options) {
  const result = spawnSync(program, args, {
    ...options,
    detached: true,
    killSignal: 'SIGKILL',
  });
  if (!result.pid) return result;
  try {
    process.kill(-result.pid, 'SIGKILL');
  } catch (error) {
    // ESRCH confirms that the owned process group no longer exists.
    if (error.code === 'ESRCH') return result;
    throw error;
  }
  const deadline = performance.now() + 2000;
  while (true) {
    const census = spawnSync('ps', ['-axo', 'pgid=,stat='], {
      encoding: 'utf8',
      timeout: 500,
      maxBuffer: 1024 * 1024,
    });
    if (census.error || census.status !== 0)
      throw Error('Owned qualification process cleanup unreadable');
    const owned = census.stdout
      .trim()
      .split('\n')
      .map((row) => row.trim().split(/\s+/))
      .filter(([group]) => group === String(result.pid));
    // Zombies have terminated and cannot execute or retain open file descriptors;
    // their parent/init owns reaping. Never mistake a live worker for that state.
    if (owned.every(([, state]) => /^Z/.test(state))) return result;
    if (performance.now() >= deadline)
      throw Error('Owned qualification process cleanup unconfirmed');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}
