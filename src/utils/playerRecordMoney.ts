import { figureDigits, figureMagnitude } from './format';
import { chipCents } from './cashierAmount';

/** Player Record monetary statistics show full cents (owner, 2026-10-28).
 * Keep this record-specific: other surfaces own their display contracts.
 *
 * Decimal text from the database (a `<key>_text` twin) prints digit for digit,
 * so a figure past a JavaScript number's 15 significant digits stays whole
 * (Dan 2026-11-13). A number keeps the record's explicit cents rule.
 */
export function playerRecordMoney(
  amount: number | string | null | undefined,
  signed = false
): string {
  if (amount == null) return 'Restricted';
  if (typeof amount === 'number' && !Number.isFinite(amount)) return '-';
  const d = figureDigits(typeof amount === 'number' ? chipCents(amount) : amount);
  if (!d) return '-';
  const text = figureMagnitude(d, 2);
  if (!/[1-9]/.test(d.whole + d.fraction)) return '0.00';
  if (d.negative) return `-${text}`;
  return signed ? `+${text}` : text;
}
