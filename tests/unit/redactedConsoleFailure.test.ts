import { expect, it } from 'vitest';
import { redactedConsoleFailure } from '../e2e/support/redactedConsoleFailure';

it('retains the runtime failure and discards multiline request bodies', () => {
  expect(redactedConsoleFailure('TypeError: Missing Value\nAuthorization: private')).toBe(
    'TypeError: Missing Value'
  );
});
it.each(['Authorization', 'Bearer', 'apikey', 'password', 'cookie'])(
  'redacts %s and its following value',
  (label) => {
    expect(redactedConsoleFailure(`ClubRosterService: ${label}: private-value`)).toBe(
      'ClubRosterService: [redacted]'
    );
  }
);
it('redacts token, service-key and URL forms even without a header label', () => {
  expect(
    redactedConsoleFailure(
      'Error eyJheader.payload.signature sb_secret_example https://example.invalid/?secret=private'
    )
  ).toBe('Error [token] [key] [url]');
});
it('bounds a signature', () => {
  expect(redactedConsoleFailure('x'.repeat(900))).toHaveLength(800);
});
