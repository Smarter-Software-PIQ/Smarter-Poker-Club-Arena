import { expect, it } from 'vitest';
import { cashoutNote, CASHOUT_NOTE_LIMIT } from '../../src/utils/cashoutNote';
it('preserves multiline and literal markup with only surrounding whitespace normalized', () => {
  expect(cashoutNote('  Call after 5\n<Pay me> & thanks  ')).toBe(
    'Call after 5\n<Pay me> & thanks'
  );
  expect(cashoutNote('x'.repeat(CASHOUT_NOTE_LIMIT))).toHaveLength(2000);
});
it('rejects oversized or nontext notes instead of changing accepted intent', () => {
  expect(() => cashoutNote('x'.repeat(2001))).toThrow('2,000');
  expect(() => cashoutNote({ text: 'x' })).toThrow('Text');
  expect(cashoutNote(null)).toBe('');
});
