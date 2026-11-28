import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LAW: a refused or unavailable WebSocket constructor never throws synchronously
 * out of Club Arena's Supabase Realtime client or transport admission layer.
 *
 * Mirrors Smarter-Poker-World-Hub's a-refused-websocket-never-crashes-the-app law
 * (2026-11-27, DailyDigest.client_crash alert 449588).
 */
describe('a refused WebSocket never crashes Club Arena', () => {
  const admissionSrc = readFileSync(resolve(__dirname, '../src/lib/realtimeAdmission.ts'), 'utf8');
  const supabaseSrc = readFileSync(resolve(__dirname, '../src/lib/supabase.ts'), 'utf8');

  it('realtimeAdmission catches synchronous WebSocket constructor refusal, short-circuits retries, and exposes onRefusal', () => {
    expect(admissionSrc).toContain('createRefusedSocket');
    expect(admissionSrc).toContain('onRefusal(');
    expect(admissionSrc).toContain('this.refusedError');
    expect(admissionSrc).toMatch(/try\s*\{[\s\S]*?new Socket\(url/);
    expect(admissionSrc).toMatch(/catch\s*\(/);
  });

  it('supabase.ts trims env vars, stops reconnect timers on refusal, wraps channels idempotently, and guards teardown', () => {
    expect(supabaseSrc).toMatch(/VITE_SUPABASE_URL[^\n]*\?\.trim\(\)/);
    expect(supabaseSrc).toMatch(/VITE_SUPABASE_ANON_KEY[^\n]*\?\.trim\(\)/);
    expect(supabaseSrc).toContain('transport: realtimeAdmission.transport');
    expect(supabaseSrc).toContain('realtimeAdmission.onRefusal(markDegraded)');
    expect(supabaseSrc).toContain('stopReconnectTimers');
    expect(supabaseSrc).toContain('HARDENED_CHANNEL');
    expect(supabaseSrc).toMatch(/rt\.connect\s*=/);
    expect(supabaseSrc).toMatch(/ch\.subscribe\s*=/);
    expect(supabaseSrc).toMatch(/ch\.unsubscribe\s*=/);
    expect(supabaseSrc).toContain('removeChannel');
    expect(supabaseSrc).toContain('removeAllChannels');
  });
});
