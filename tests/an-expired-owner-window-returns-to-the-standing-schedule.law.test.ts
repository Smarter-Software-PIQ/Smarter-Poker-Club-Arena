import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Dan, 2026-11-05: "HARD CODE FIX THIS AT ITS ROOT CAUSE SO IT STOPS HAPPENING".
// Every time a later owner reset window expired, the activation floor refused
// every fresh engine release ("explicit later owner window expired; no
// alternate reset authorized") until someone wrote a new window. An expired
// window now simply stops applying and releases return to the standing
// schedule the owner already ordered.
const floor = readFileSync('server/scripts/engine-release-activation-floor.py', 'utf8');
const suite = readFileSync('tests/operations/engine-activation-floor.test.py', 'utf8');

describe('an expired owner window returns releases to the standing schedule', () => {
  it('no longer refuses fresh admission when a later owner window expires', () => {
    expect(floor).not.toContain('no alternate reset authorized');
    expect(floor).toContain('AN EXPIRED OWNER WINDOW RETURNS RELEASES TO THE STANDING SCHEDULE');
  });

  it('keeps the later window in front only while it is open', () => {
    expect(floor).toContain('now = int(time.time())');
    expect(floor).toContain(
      "as_of = daily_assessment_epoch(now, args.deadline) if args.mode == 'daily-compatibility' else now"
    );
    expect(floor).toContain("and as_of < record['expiresEpoch'])");
  });

  it('is proved by the native floor suite', () => {
    expect(suite).toContain(
      "self.assertEqual(admit(record['expiresEpoch'], record['expiresEpoch'] + 3600)['schema'],"
    );
    expect(suite).toContain('floor.PHASE1_CAPABILITY)');
  });
});
