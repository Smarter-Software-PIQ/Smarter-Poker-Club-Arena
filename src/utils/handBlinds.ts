/** A display denomination belongs to one table and one dealt hand. */
export interface HandBlinds {
  tableId: string;
  handNumber: number;
  smallBlind: number;
  bigBlind: number;
}

export function parseHandBlinds(
  raw: unknown,
  tableId: unknown,
  handNumber: unknown
): HandBlinds | null | undefined {
  // Absent means a legacy engine, not an invalid modern contract. Keep this
  // distinction through mapping so an optional server upgrade cannot disable BB.
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (
    typeof tableId !== 'string' ||
    !tableId ||
    b.table_id !== tableId ||
    !Number.isSafeInteger(handNumber) ||
    Number(handNumber) <= 0 ||
    b.hand_number !== handNumber ||
    typeof b.small_blind !== 'number' ||
    !Number.isFinite(b.small_blind) ||
    b.small_blind < 0 ||
    typeof b.big_blind !== 'number' ||
    !Number.isFinite(b.big_blind) ||
    b.big_blind <= 0 ||
    b.small_blind > b.big_blind
  )
    return null;
  return {
    tableId,
    handNumber: Number(handNumber),
    smallBlind: b.small_blind,
    bigBlind: b.big_blind,
  };
}

/** Prefer the dealt-hand contract; legacy engines retain their metadata display.
 * null is a rejected modern contract and must not silently downgrade to metadata.
 * undefined means the optional field is absent (including initial hydration).
 */
export function displayBigBlind(
  hand: HandBlinds | null | undefined,
  tableId: string,
  handNumber: number | undefined,
  tournament: boolean,
  metadataBigBlind: number
): number {
  if (hand?.tableId === tableId && hand.handNumber === handNumber) return hand.bigBlind;
  if (tournament && hand !== undefined) return 0;
  return Number.isFinite(metadataBigBlind) && metadataBigBlind > 0 ? metadataBigBlind : 0;
}
