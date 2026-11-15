export declare const FILE: string;
export declare const RULE_FROM: number;
export declare function bookingViolations(
  doc: { windows?: Record<string, unknown>[]; databaseWindows?: Record<string, unknown>[] },
  bookedAt: (id: string) => number | null,
  now: number
): string[];
export declare function bookingAdmission(
  baseDoc: { windows?: Record<string, unknown>[]; databaseWindows?: Record<string, unknown>[] },
  headDoc: { windows?: Record<string, unknown>[]; databaseWindows?: Record<string, unknown>[] },
  bookedAt: (id: string) => number | null,
  now: number
): { failures: string[]; historical: string[] };
