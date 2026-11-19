/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LAW - A STALLED TABLE'S LATE RESOLUTION IS PROVED BY RE-MEASURING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Eleven TableStoppedDealing incidents (ca-stall-watch, 2026-11-14..16) sat
 * stale_unverified and escalated though every tournament was COMPLETED, every
 * table closed and every member resolved: ca-stall-watch resolved them in place
 * after the controller had aged them stale, and a resolve reaches a stale
 * incident only through smarter_private.reliability_proved_source_resolution,
 * an allowlist of three sources that did not include ca-stall-watch.
 *
 * Migration 20261118164804 adds ca-stall-watch on the same same-episode terms
 * plus a re-measurement of the table the watch named (no longer open, or a hand
 * dealt since it last fired), and admits the resolutions already received
 * through reliability_transition, which re-checks the proof.
 *
 * Any later migration that redefines the proof must keep the stall branch.
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus, migrationNames, migrationText } from './helpers/migrationCorpus';

const NAME = migrationNames()
  .filter((n) => n.endsWith('_a_stalled_tables_late_resolution_is_proved_by_re_measuring.sql'))
  .at(-1);
if (!NAME) throw new Error('the stalled-table resolution proof migration is missing');
const MIG = migrationText(NAME);
const VERSION = NAME.slice(0, 14);

const between = (s: string, a: string, b: string): string => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`window ${a} .. ${b} not found`);
  return s.slice(i + a.length, j);
};

describe("a stalled table's late resolution is proved by re-measuring", () => {
  it('pins the proof by preimage and postimage', () => {
    expect(MIG).toContain(
      "'smarter_private.reliability_proved_source_resolution(uuid)',\n  'be21d58b5126b212b4499f3e216cec2a', 'bb4e07bc55faff6411be487d464ba1be'"
    );
    expect(MIG).toMatch(/^BEGIN;$/m);
    expect(MIG).toMatch(/^COMMIT;$/m);
    expect(MIG).toContain('IF md5(v_def) = p_after THEN');
  });

  it('admits ca-stall-watch to the proof, and only on top of the existing same-episode terms', () => {
    const n1 = between(MIG, '$n1$', '$n1$');
    expect(n1).toContain("'sp-daily-digest','ca-stall-watch')");
    const o2 = between(MIG, '$o2$', '$o2$');
    // anchored at the tail of the existing branches, so the shared same-episode
    // conditions above it still apply to the new branch
    expect(o2).toBe('                 ELSE false END))));\n');
  });

  it('proves a stall over only by re-measuring the table the watch named', () => {
    const n2 = between(MIG, '$n2$', '$n2$');
    expect(n2).toContain("e.source='ca-stall-watch' AND e.alertname='TableStoppedDealing'");
    expect(n2).toContain("pg_input_is_valid(e.payload->>'table_id','uuid')");
    // no longer open ...
    expect(n2).toMatch(
      /NOT EXISTS \(SELECT 1 FROM public\.tables tb[\s\S]*coalesce\(tb\.lifecycle,''\)<>'closed'[\s\S]*tb\.status IN \('waiting','running','active'\)/
    );
    // ... or dealing again since the member last fired
    expect(n2).toMatch(
      /EXISTS \(SELECT 1 FROM public\.hand_history h[\s\S]*h\.created_at>m\.last_firing_at/
    );
  });

  it('admits resolutions already received only through the proof and the guarded transition', () => {
    const block = between(
      MIG,
      'DO $received_stall_resolutions$',
      'END $received_stall_resolutions$;'
    );
    expect(block).toContain("i.status = 'stale_unverified' AND i.source = 'ca-stall-watch'");
    expect(block).toContain('smarter_private.reliability_proved_source_resolution(i.id)');
    expect(block).toContain("smarter_private.reliability_transition(r.id, 'verifying',");
    expect(block).not.toMatch(/UPDATE\s+smarter_private\.reliability_incidents/i);
  });

  it('no later migration redefines the proof without the stall branch', () => {
    for (const m of migrationCorpus()) {
      if (m.name.slice(0, 14) <= VERSION) continue;
      const touches =
        /FUNCTION\s+smarter_private\.reliability_proved_source_resolution\s*\(/i.test(m.sql) ||
        /'smarter_private\.reliability_proved_source_resolution\(uuid\)'\s*,\s*\n?\s*'[0-9a-f]{32}'/.test(
          m.sql
        );
      if (!touches) continue;
      expect(m.sql, m.name).toContain("'ca-stall-watch'");
      expect(m.sql, m.name).toContain("e.alertname='TableStoppedDealing'");
    }
  });
});
