import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 2026-11-08: every Backup Engine certificate since #10008 (02:06 UTC) failed
// its rollback rehearsal with "Backup fixture identity initialization failed
// 500". The isolated clone's GoTrue logged "Scan error on column index 33,
// name updated_at: unsupported Scan, storing driver.Value type <nil> into type
// *time.Time". #10027 filled the string token columns; the seed still left
// created_at / updated_at NULL (1,095 of 1,097 users, 35 with no created_at),
// and GoTrue scans both into non-pointer time.Time. On the clone, the same
// admin PUT returned 500 before and 200 after those two columns were set.

const seed = readFileSync('server/standby/standby-engine.sh', 'utf8');
const workflow = readFileSync('.github/workflows/backup-engine.yml', 'utf8');

const insert = seed.slice(
  seed.indexOf('INSERT INTO auth.users ('),
  seed.indexOf('SQL', seed.indexOf('INSERT INTO auth.users ('))
);

describe('a Backup fixture identity is readable by GoTrue', () => {
  it('seeds every column GoTrue scans into a non-nullable type', () => {
    expect(insert).toMatch(/id, aud, role, created_at, updated_at, instance_id/);
    expect(insert).toContain('COALESCE(created_at, now()), COALESCE(created_at, now())');
    for (const column of [
      'confirmation_token',
      'recovery_token',
      'email_change_token_new',
      'email_change',
      'email_change_token_current',
      'phone_change',
      'phone_change_token',
      'reauthentication_token',
    ])
      expect(insert).toContain(`${column} = ''`);
  });

  it('repairs a pre-existing row instead of keeping its NULL timestamps', () => {
    expect(insert).toContain('created_at = COALESCE(auth.users.created_at, EXCLUDED.created_at)');
    expect(insert).toContain('updated_at = COALESCE(auth.users.updated_at, EXCLUDED.updated_at)');
  });

  it('a copy seeded by the old fixture is refused and rebuilt, not certified', () => {
    expect(seed).toContain('printf \'{"authFixtureVersion":2,');
    expect(seed).toContain("assert seed.get('authFixtureVersion') == 2");
    expect(workflow).toContain('s.get(\\"authFixtureVersion\\") == 2');
    expect(workflow).not.toContain('s.get(\\"authFixtureVersion\\") == 1');
  });
});
