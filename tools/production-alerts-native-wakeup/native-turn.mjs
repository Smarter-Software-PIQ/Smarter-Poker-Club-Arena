import { DatabaseSync } from 'node:sqlite';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { TARGET } from './core.mjs';
// Read-only proof that the native turn which consumed an accepted queue message
// has ended. Used only to release a halted operation: the canonical chat took
// the message, its turn finished (for example "application network permission
// was revoked" on 2026-11-14), and the batch has no durable outcome. Any doubt
// returns false so the operation stays retained exactly as before.
export function uuidV7Millis(uuid) {
  const hex = String(uuid).replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(hex) || hex[12] !== '7') return null;
  return Number.parseInt(hex.slice(0, 12), 16);
}
export function lastRecordEndsTurnAfter(tail, sinceMillis) {
  const lines = String(tail)
    .split('\n')
    .filter((line) => line.trim());
  if (!lines.length) return false;
  let record;
  try {
    record = JSON.parse(lines[lines.length - 1]);
  } catch {
    return false;
  }
  // started_at has whole-second resolution while the queued message id carries
  // milliseconds: on 2026-11-20 a turn woke 80 ms after its message, within the
  // same second, so started_at*1000 read as before the message and the halted
  // operation was retained for days. The turn id is a UUIDv7 minted when the
  // turn starts; use its milliseconds, and fall back to started_at only when the
  // turn id carries no time.
  const started =
    uuidV7Millis(record?.payload?.turn_id) ?? Number(record?.payload?.started_at) * 1000;
  return (
    record?.type === 'event_msg' &&
    record.payload.type === 'task_complete' &&
    Number.isFinite(started) &&
    started >= sinceMillis
  );
}
export function createNativeTurnProbe({
  codexHome = join(homedir(), '.codex'),
  openFile = open,
} = {}) {
  return async function nativeTurnEnded(active) {
    const since = uuidV7Millis(active?.messageId);
    if (since === null) return false;
    let queue, state;
    try {
      queue = new DatabaseSync(join(codexHome, 'queue_1.sqlite'), { readOnly: true });
      const waiting = queue
        .prepare('SELECT count(*) AS n FROM queued_items WHERE thread_id = ?')
        .get(TARGET);
      if (waiting?.n !== 0) return false;
      state = new DatabaseSync(join(codexHome, 'state_5.sqlite'), { readOnly: true });
      const thread = state.prepare('SELECT rollout_path FROM threads WHERE id = ?').get(TARGET);
      if (typeof thread?.rollout_path !== 'string') return false;
      const file = await openFile(thread.rollout_path, 'r');
      try {
        const { size } = await file.stat();
        const length = Math.min(size, 262_144);
        const buffer = Buffer.alloc(length);
        await file.read(buffer, 0, length, size - length);
        return lastRecordEndsTurnAfter(buffer.toString('utf8'), since);
      } finally {
        await file.close();
      }
    } catch {
      return false;
    } finally {
      queue?.close();
      state?.close();
    }
  };
}
