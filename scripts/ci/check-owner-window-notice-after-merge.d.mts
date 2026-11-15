export declare const FILE: string;
export declare const RULE_FROM: number;
export declare const WITNESS_FILE: string;
export declare const MIN_LEAD_MS: number;
export declare function bookingViolations(
  doc: { windows?: Record<string, unknown>[]; databaseWindows?: Record<string, unknown>[] },
  bookedAt: (id: string) => number | null,
  now: number,
  witnessDoc?: unknown
): string[];
