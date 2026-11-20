import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/*
 * Incident 2ac23dbf-455f-4edd-823e-ca5cc9b06ac8 (DatabaseDeadlocksElevated):
 * Hand stacks and real-time finisher payouts never upgrade the event row lock.
 *
 * After migration 20261119181500 (lane E4) made hand commits hold
 * public.tournaments FOR KEY SHARE and shared-lane writers hold it
 * FOR NO KEY UPDATE, three missed nested/companion functions caused two live
 * lock-upgrade deadlock cycles:
 *   1. fn_ca_settle_hand_stacks_absolute upgraded tournaments from
 *      FOR KEY SHARE to FOR SHARE after tables(A) FOR UPDATE was already held.
 *   2. fn_ca_pay_tournament_finishers_now (called at COMMIT of eliminations)
 *      upgraded T(id) to EXCLUSIVE and tournaments from FOR NO KEY UPDATE to
 *      FOR UPDATE before even checking prize_pool_finalized.
 *   3. fn_decline_tournament_rebuy still took tournaments FOR UPDATE.
 */
const file = '20261119232617_hand_stacks_and_finishers_never_upgrade_event_row_lock.sql';
const migration = readFileSync(`supabase/migrations/${file}`, 'utf8');

function substitutions() {
  const block = migration.match(/DO \$subs\$([\s\S]*?)END \$subs\$;/)![1];
  const heads = [
    ...block.matchAll(
      /'((?:public|smarter_private)\.[^']+)',\s*'([0-9a-f]{32})',\s*'([0-9a-f]{32})',\s*ARRAY\[/g
    ),
  ];
  return heads.map((m, i) => {
    const seg = block.slice(
      m.index! + m[0].length,
      i + 1 < heads.length ? heads[i + 1].index : undefined
    );
    const quoted = (tag: string) =>
      [...seg.matchAll(new RegExp(`\\$(${tag}\\d+)\\$([\\s\\S]*?)\\$\\1\\$`, 'g'))].map(
        (q) => q[2]
      );
    return { signature: m[1], pre: m[2], post: m[3], olds: quoted('o'), news: quoted('n') };
  });
}

describe('Hand stacks and finishers never upgrade event row lock (incident 2ac23dbf)', () => {
  it('is one bounded function-only transaction after lane E4 with stale pin and live proof', () => {
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(migration).toMatch(
      /\nBEGIN;\nSET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';\n/
    );
    expect(migration).not.toMatch(
      /@install-window|LOCK TABLE|ALTER TABLE|CREATE INDEX|CREATE TABLE/
    );
    expect(migration).toContain('-- @live-proof:');
    expect(
      [...migration.matchAll(/^--\s*@stale-pin-ok:\s*([0-9a-f]{32})\s+\S/gm)].map((m) => m[1])
    ).toEqual(['ff16a5b791b4e2d01b7ab4ee62a85c0e']);
    expect(migration).toContain('e4ccdf257e371123a198e8a132889fab');
    expect(substitutions()).toHaveLength(4);
  });

  it('downgrades fn_ca_settle_hand_stacks_absolute from FOR SHARE to FOR KEY SHARE', () => {
    const sub = substitutions().find(
      (x) =>
        x.signature ===
        'public.fn_ca_settle_hand_stacks_absolute(uuid,bigint,jsonb,numeric,numeric,text,numeric)'
    )!;
    expect(sub).toBeDefined();
    expect(sub.olds.join('\n')).toContain('FOR SHARE;');
    expect(sub.news.join('\n')).toContain('FOR KEY SHARE;');
    expect(sub.news.join('\n')).not.toMatch(/\bFOR SHARE;/);
  });

  it('fast-exits fn_ca_pay_tournament_finishers_now before locking and uses FOR NO KEY UPDATE', () => {
    const sub = substitutions().find(
      (x) => x.signature === 'public.fn_ca_pay_tournament_finishers_now(uuid)'
    )!;
    expect(sub).toBeDefined();
    const body = sub.news.join('\n');
    expect(body).toContain('pool_not_finalized');
    expect(body.indexOf('pool_not_finalized')).toBeLessThan(
      body.indexOf('fn_ca_lock_settlement_lane_for_tournament')
    );
    expect(body).toContain('FOR NO KEY UPDATE;');
    expect(body).not.toMatch(/\bFOR UPDATE;/);
  });

  it('downgrades fn_decline_tournament_rebuy to FOR NO KEY UPDATE and pins all three in doctrine rule 9', () => {
    const decline = substitutions().find(
      (x) => x.signature === 'public.fn_decline_tournament_rebuy(uuid,uuid)'
    )!;
    expect(decline).toBeDefined();
    expect(decline.olds.join('\n')).toContain('FOR UPDATE;');
    expect(decline.news.join('\n')).toContain('FOR NO KEY UPDATE;');

    const doctrine = substitutions().find(
      (x) => x.signature === 'public.fn_ca_settlement_lane_doctrine()'
    )!;
    expect(doctrine).toBeDefined();
    const docNew = doctrine.news.join('\n');
    expect(docNew).toContain(
      'public.fn_ca_settle_hand_stacks_absolute(uuid,bigint,jsonb,numeric,numeric,text,numeric)'
    );
    expect(docNew).toContain('public.fn_ca_pay_tournament_finishers_now(uuid)');
    expect(docNew).toContain('public.fn_decline_tournament_rebuy(uuid,uuid)');
  });
});
