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

  it('realtimeAdmission catches synchronous WebSocket constructor refusal and returns a closed facade', () => {
    expect(admissionSrc).toContain('createRefusedSocket');
    expect(admissionSrc).toMatch(/try\s*\{[\s\S]*?new Socket\(url/);
    expect(admissionSrc).toMatch(/catch\s*\(/);
  });

  it('supabase.ts wires realtimeAdmission.transport and guards realtime.connect and channel().subscribe()', () => {
    expect(supabaseSrc).toContain('transport: realtimeAdmission.transport');
    expect(supabaseSrc).toMatch(/rt\.connect\s*=/);
    expect(supabaseSrc).toMatch(/ch\.subscribe\s*=/);
  });
});
