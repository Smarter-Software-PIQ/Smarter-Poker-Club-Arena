// Object identity keeps private diagnostics outside the controller's public action
// and the database hand history. Settlement copies the receipt into the Horse journal.
export type HorseTurnPath =
  | 'quick_check_fold'
  | 'pre_action'
  | 'strategy'
  | 'timeout'
  | 'forced'
  | 'fallback';
export interface HorseTurnClockReceipt {
  startedAtMs: number;
  deadlineMs: number;
  acceptedAtMs: number;
  path: HorseTurnPath;
  reason?: string;
}
const receipts = new WeakMap<object, HorseTurnClockReceipt>();

export function retainHorseTurnClock(
  record: { timestamp: number },
  startedAtMs: number,
  deadlineMs: number,
  path: HorseTurnPath,
  reason?: string
): void {
  if (
    ![startedAtMs, deadlineMs, record.timestamp].every(Number.isSafeInteger) ||
    startedAtMs <= 0 ||
    deadlineMs < startedAtMs ||
    record.timestamp < startedAtMs
  )
    return;
  receipts.set(record, {
    startedAtMs,
    deadlineMs,
    acceptedAtMs: record.timestamp,
    path,
    ...(reason ? { reason } : {}),
  });
}

export function carryHorseTurnClock(record: object | undefined, historyRow: object): void {
  const receipt = record && receipts.get(record);
  if (receipt) receipts.set(historyRow, receipt);
}

export function privateHorseTurnClocks(actions: readonly object[]) {
  return actions.flatMap((action, actionIndex) => {
    const receipt = receipts.get(action);
    return receipt ? [{ actionIndex, ...receipt }] : [];
  });
}

export function reviewHorseTurnClocks(
  clocks: unknown,
  actions: readonly { timestamp?: number; origin?: string; seat?: number; action: string }[]
) {
  if (clocks === undefined) return [];
  if (!Array.isArray(clocks) || clocks.length > actions.length)
    throw Error('Invalid Horse clock receipts');
  const origins = {
    quick_check_fold: 'pre_action',
    pre_action: 'pre_action',
    strategy: 'horse_policy',
    timeout: 'forced',
    forced: 'forced',
    fallback: 'horse_fallback',
  } as const;
  const seen = new Set<number>();
  return clocks.map((c: HorseTurnClockReceipt & { actionIndex: number }) => {
    const a = actions[c?.actionIndex];
    if (
      !a ||
      !Number.isInteger(c.actionIndex) ||
      seen.has(c.actionIndex) ||
      !Object.hasOwn(origins, c.path) ||
      origins[c.path] !== a.origin ||
      !Number.isSafeInteger(c.startedAtMs) ||
      c.startedAtMs <= 0 ||
      !Number.isSafeInteger(c.deadlineMs) ||
      c.deadlineMs < c.startedAtMs ||
      !Number.isSafeInteger(c.acceptedAtMs) ||
      c.acceptedAtMs !== a.timestamp ||
      c.acceptedAtMs < c.startedAtMs ||
      (c.reason !== undefined && (typeof c.reason !== 'string' || c.reason.length > 256))
    )
      throw Error('Invalid Horse clock receipt');
    seen.add(c.actionIndex);
    return {
      ...c,
      seat: a.seat,
      action: a.action,
      elapsedMs: c.acceptedAtMs - c.startedAtMs,
      remainingMs: c.deadlineMs - c.acceptedAtMs,
    };
  });
}
