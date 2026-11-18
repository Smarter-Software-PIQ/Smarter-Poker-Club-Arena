/** A request ID binds the original amount, even if a wallet refresh changes the shortfall. */
export interface AutoTopUpRequest {
  hand: number;
  key: string;
  amount: number;
}

/** A background top-up has no player action to interrupt. Keep explicit
 * purchases and uncertain transport outcomes visible. */
export function quietAutoTopUpRefusal(source: string | undefined, error: unknown): boolean {
  return (
    source === 'auto' &&
    (String(error) === 'Lightning Session Is Unavailable' ||
      /maximum buy-in|top up is already pending/i.test(String(error || '')))
  );
}

export function autoTopUpRequest(
  previous: AutoTopUpRequest | null,
  hand: number,
  amount: number,
  createId: () => string = () => crypto.randomUUID()
): AutoTopUpRequest | null {
  if (!Number.isSafeInteger(hand) || hand < 0) return null;
  if (previous?.hand === hand) return previous;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { hand, amount, key: createId() };
}
