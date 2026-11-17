import test from 'node:test';
import assert from 'node:assert/strict';
import { promoDigestLines } from '../../.github/scripts/promo-digest.mjs';
const report = {
  day: '2026-11-15',
  clubs: [{ club_id: 'club', given: 50, locked_now: 20, unlocked: 10, expired: 7, flagged: 2 }],
  funding_owners: [
    {
      club_id: 'club',
      funded_from_type: 'promo_wallet',
      funded_from_id: 'original-agent',
      given: 50,
      locked_now: 20,
      unlocked: 10,
      expired: 7,
      flagged: 1,
    },
  ],
  club_flags: [{ club_id: 'club', flagged: 2 }],
};
test('prints original source owner, current lock, actual returns and club flags', () => {
  const lines = promoDigestLines(report).join('\n');
  assert.match(lines, /promo_wallet:original-agent/);
  assert.match(lines, /50 given; 20 locked; 10 unlocked; 7 expired; 1 source-linked flags/);
  assert.match(lines, /2 distinct flagged cases/);
});
test('does not invent zero when report or amounts are unreadable', () => {
  assert.throws(() => promoDigestLines(null));
  assert.throws(() =>
    promoDigestLines({ ...report, funding_owners: [{ ...report.funding_owners[0], given: null }] })
  );
  assert.throws(() =>
    promoDigestLines({
      ...report,
      funding_owners: [{ ...report.funding_owners[0], locked_now: 'NaN' }],
    })
  );
});
test('names an absent original owner without guessing a hierarchy', () => {
  assert.match(
    promoDigestLines({
      ...report,
      funding_owners: [{ ...report.funding_owners[0], funded_from_id: null }],
    }).join('\n'),
    /original funding owner unavailable/
  );
});
