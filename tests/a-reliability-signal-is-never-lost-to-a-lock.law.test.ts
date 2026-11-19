/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LAW - A RELIABILITY SIGNAL IS NEVER LOST TO A LOCK
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Incident 73c08234 (LightningHandHost.post_commit_obligations_pending) stayed
 * escalated and kept paging for 10+ hours after its alert stopped. Two of its
 * 2,004 members were resolved in public.financial_alerts at 01:04 UTC, but the
 * resolve deliveries were rejected by the intake trigger with 40P01 (deadlock)
 * and written to smarter_private.reliability_intake_rejections, which nothing
 * ever read back. 97 deliveries were lost that way, every one to a transient
 * lock error. The deadlock was reliability_apply_signal locking the member row
 * before the shared incident row.
 *
 * Migration 20261118153245_a_reliability_signal_is_never_lost_to_a_lock.sql:
 *   1. ONE INCIDENT, ONE LOCK ORDER: apply_signal takes a transaction lock on
 *      the incident fingerprint before any member or incident row.
 *   2. A transient rejection is replayed from its inbox row by
 *      reliability_replay_rejected_intake, run FIRST by reliability_tick.
 *   3. A delivery overtaken by an observed newer delivery of the same record is
 *      superseded, never replayed (an old firing must not page).
 *   4. ReliabilityIntakeRejections pages for what replay could not apply, not
 *      for a deadlock it healed.
 *
 * Any later migration that redefines these functions must carry all of it.
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus, migrationNames, migrationText } from './helpers/migrationCorpus';

const NAME = migrationNames()
  .filter((n) => n.endsWith('_a_reliability_signal_is_never_lost_to_a_lock.sql'))
  .at(-1);
if (!NAME) throw new Error('the reliability intake replay migration is missing');
const MIG = migrationText(NAME);
const VERSION = NAME.slice(0, 14);

const APPLY_SIG =
  'smarter_private.reliability_apply_signal(text,boolean,text,text,text,text,text,text,jsonb,jsonb,text,text,boolean,timestamp with time zone,bigint,text,timestamp with time zone,timestamp with time zone)';
const TICK_SIG = 'smarter_private.reliability_tick(timestamp with time zone)';

const between = (s: string, a: string, b: string): string => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`window ${a} .. ${b} not found`);
  return s.slice(i, j);
};

describe('a reliability signal is never lost to a lock', () => {
  it('pins both functions by preimage and postimage', () => {
    expect(MIG).toContain(
      `'${APPLY_SIG}',\n  'e92bd93c85ecbfed0cf6fbeabd9452f4', '22fd63bb07ecb155a11bb1d1e099ff79'`
    );
    expect(MIG).toContain(
      `'${TICK_SIG}',\n  'f28d9aa098f39376e62127f7b9d3f9f5', '7e7653706e188585571981e5a44c671b'`
    );
    expect(MIG).toMatch(/^BEGIN;$/m);
    expect(MIG).toMatch(/^COMMIT;$/m);
  });

  it('takes the incident lock before the member row and the incident row', () => {
    const n1 = between(MIG, '$n1$BEGIN', 'v_hold := smarter_private.reliability_classify($n1$');
    expect(n1).toContain('ONE INCIDENT, ONE LOCK ORDER');
    expect(n1).toMatch(
      /pg_advisory_xact_lock\(hashtextextended\('reliability-incident-fingerprint:'/
    );
    // keyed on the member's stored fingerprint when it exists, the computed one otherwise
    expect(n1).toContain(
      'SELECT x.fingerprint FROM smarter_private.reliability_alert_members x WHERE x.member_key = p_member_key'
    );
    // anchored at the top of the body, so it precedes the member insert and both FOR UPDATEs
    expect(MIG).toContain('$o1$BEGIN\n  v_hold := smarter_private.reliability_classify($o1$');
  });

  it('replays transient rejections first in every tick', () => {
    const n2 = between(MIG, '$n2$', '$n2$,');
    expect(n2).toContain('smarter_private.reliability_replay_rejected_intake(25)');
    expect(n2).toContain("'step', 'replay_intake'");
    // inserted right after the settings read, i.e. before step 1 (escalate)
    expect(MIG).toContain(
      '$o2$  SELECT * INTO STRICT s FROM smarter_private.reliability_settings WHERE id;\n$o2$'
    );
  });

  it('replays through the unchanged intake, oldest first, with a bounded backoff', () => {
    const fn = between(
      MIG,
      'CREATE OR REPLACE FUNCTION smarter_private.reliability_replay_rejected_intake(',
      '\n$f$;'
    );
    expect(fn).toContain('PERFORM smarter_private.reliability_ingest_alert(');
    expect(fn).toContain('ORDER BY j.id');
    expect(fn).toContain('FOR UPDATE SKIP LOCKED');
    expect(fn).toContain('c_max_attempts constant integer := 12');
    expect(fn).toContain("interval '60 minutes'");
    expect(fn).toContain('smarter_private.reliability_intake_error_is_transient(j.sqlstate)');
    expect(fn).not.toMatch(/SECURITY DEFINER/);
  });

  it('never replays a delivery an observed newer delivery of the same record has overtaken', () => {
    const fn = between(
      MIG,
      'CREATE OR REPLACE FUNCTION smarter_private.reliability_replay_rejected_intake(',
      '\n$f$;'
    );
    expect(fn).toContain("replay_outcome = 'superseded'");
    expect(fn).toContain(
      'JOIN smarter_private.reliability_observations o ON o.inbox_event_id = n.id'
    );
    expect(fn).toContain('AND n.id > e.id');
  });

  it('treats lock, serialization, cancel and connection errors as transient, and nothing else', () => {
    const fn = between(MIG, 'reliability_intake_error_is_transient(p_sqlstate text)', '$f$;');
    for (const s of ["'40'", "'53'", "'08'", "'55P03'", "'55006'", "'57014'"])
      expect(fn).toContain(s);
    expect(fn).not.toContain("'22");
    expect(fn).not.toContain("'23");
  });

  it('pages for a delivery replay could not apply, not for a deadlock it healed', () => {
    const n3 = between(MIG, '$n3$', '$n3$]');
    expect(n3).toContain('j.replayed_at IS NULL');
    expect(n3).toContain('NOT smarter_private.reliability_intake_error_is_transient(j.sqlstate)');
    expect(n3).toContain('j.replay_attempts >= 3');
    expect(n3).not.toContain("j.at > v_now - interval '1 hour'");
  });

  it('closes the new functions to browser roles', () => {
    expect(MIG).toContain(
      'REVOKE ALL ON FUNCTION smarter_private.reliability_replay_rejected_intake(integer, boolean) FROM PUBLIC, anon, authenticated;'
    );
    expect(MIG).toContain(
      'REVOKE ALL ON FUNCTION smarter_private.reliability_intake_error_is_transient(text) FROM PUBLIC, anon, authenticated;'
    );
  });

  it('no later migration redefines these functions without the lock order, the replay or the rejection record', () => {
    const later = migrationCorpus().filter((m) => m.name.slice(0, 14) > VERSION);
    for (const m of later) {
      if (
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+smarter_private\.reliability_apply_signal\s*\(/i.test(
          m.sql
        )
      ) {
        expect(m.sql, m.name).toContain('ONE INCIDENT, ONE LOCK ORDER');
      }
      if (
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+smarter_private\.reliability_tick\s*\(/i.test(m.sql)
      ) {
        expect(m.sql, m.name).toContain('reliability_replay_rejected_intake(');
      }
      if (
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+smarter_private\.reliability_trg_operational_alert_intake\s*\(/i.test(
          m.sql
        )
      ) {
        expect(m.sql, m.name).toContain(
          'INSERT INTO smarter_private.reliability_intake_rejections'
        );
      }
      expect(m.sql, m.name).not.toMatch(/DROP\s+FUNCTION[^;]*reliability_replay_rejected_intake/i);
    }
  });
});
