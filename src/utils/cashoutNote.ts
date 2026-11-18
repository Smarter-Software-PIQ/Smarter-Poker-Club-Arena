/** Shared player-note boundary; never truncate a note after its intent was accepted. */
export const CASHOUT_NOTE_LIMIT = 2000;
export function cashoutNote(value: unknown): string {
  if (value !== undefined && value !== null && typeof value !== 'string')
    throw new Error('Note For Agent Must Be Text');
  const note = typeof value === 'string' ? value.trim() : '';
  if (note.length > CASHOUT_NOTE_LIMIT)
    throw new Error('Note For Agent Must Be 2,000 Characters Or Fewer');
  return note;
}
