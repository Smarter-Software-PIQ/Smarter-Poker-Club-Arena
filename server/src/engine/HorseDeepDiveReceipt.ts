import type { HorseDecision } from '../types.js';
import type {
  FastHorseDecisionRequest,
  DeepHorseDecisionRequest,
} from './horseDecision/protocol.js';
import { horseJournalJson, journalHash } from '../services/horseDecisionJournal/record.js';

type Request = FastHorseDecisionRequest | DeepHorseDecisionRequest;
export const DEEP_DIVE_RULES = {
  presumed_opener: 'p1a',
  hand_class: 'p1b',
  limp_bar: 'p1b',
  cold_call_bar: 'p1b',
  price_relief: 'p1b',
  call_floor: 'p1b',
  blind_floor: 'p1b',
  plo6_big_bet: 'p3',
  flop_cap: 'p3',
  raised_commitment: 'p3',
  priced_in_floor: 'p4',
  nlh_turn_shade: 'p4',
} as const;
export type DeepDiveRule = keyof typeof DEEP_DIVE_RULES;
export interface HorseDeepDiveReceipt {
  version: 'horse-deep-dive-v1';
  status: 'observed' | 'not_reached' | 'refused';
  inputSha256: string;
  readFrameSha256: string | null;
  effectiveEnabled: boolean | null;
  pillar2: 'excluded_by_qualification';
  /** Local rule evaluation only. A changed input need not change the final action. */
  rules: Array<{ rule: DeepDiveRule; evaluated: number; eligible: number; changed: number }>;
  result: { action: HorseDecision['action']; amount: number | null };
}
const resultOf = (d: HorseDecision) => ({ action: d.action, amount: d.amount ?? null });

/** Synchronous dynamic scope, restored even on nesting or an exception. It never
 * crosses an await, writes telemetry, samples RNG or enters the IPC response. */
let current: HorseDeepDiveCapture | undefined;
export function withHorseDeepDiveCapture<T>(
  capture: HorseDeepDiveCapture | undefined,
  enabled: boolean,
  run: () => T
): T {
  const previous = current;
  current = capture;
  capture?.enter(enabled);
  try {
    return run();
  } catch (error) {
    capture?.refuse();
    throw error;
  } finally {
    current = previous;
  }
}
export function noteHorseDeepDiveRule(
  rule: DeepDiveRule,
  eligible: boolean,
  changed: boolean
): void {
  current?.note(rule, eligible, changed);
}

/** Owned by one original FAST or DEEP journal capture. No request field can
 * create observations: only calls at the actual policy consumers record them. */
export class HorseDeepDiveCapture {
  private enabled: boolean | null = null;
  private refused = false;
  private readonly rules: HorseDeepDiveReceipt['rules'] = [];
  constructor(private readonly request: Request) {}
  enter(enabled: boolean): void {
    if (this.enabled !== null) this.refused = true;
    this.enabled = enabled;
  }
  refuse(): void {
    this.refused = true;
  }
  note(rule: DeepDiveRule, eligible: boolean, changed: boolean): void {
    if (this.enabled !== true || !Object.hasOwn(DEEP_DIVE_RULES, rule) || (changed && !eligible)) {
      this.refused = true;
      return;
    }
    let row = this.rules.find((r) => r.rule === rule);
    if (!row) {
      row = { rule, evaluated: 0, eligible: 0, changed: 0 };
      this.rules.push(row);
    }
    if (row.evaluated >= 32) {
      this.refused = true;
      return;
    }
    row.evaluated++;
    if (eligible) row.eligible++;
    if (changed) row.changed++;
  }
  finish(decision: HorseDecision, readFrameSha256: string | null): HorseDeepDiveReceipt {
    return {
      version: 'horse-deep-dive-v1',
      status:
        this.refused || decision.policyFallback
          ? 'refused'
          : this.enabled === null
            ? 'not_reached'
            : 'observed',
      inputSha256: journalHash(horseJournalJson(this.request)),
      readFrameSha256,
      effectiveEnabled: this.enabled,
      pillar2: 'excluded_by_qualification',
      rules: this.rules.map((r) => ({ ...r })),
      result: resultOf(decision),
    };
  }
}

/** A structural/binding check, never authentication or a strategy-quality verdict.
 * The original journal must independently reconcile to execution and commit. */
export function horseDeepDiveReceiptIsValid(
  value: unknown,
  request: Request,
  decision: HorseDecision,
  readFrameSha256: string | null
): value is HorseDeepDiveReceipt {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const r = value as HorseDeepDiveReceipt;
    if (
      Object.keys(r).sort().join(',') !==
        'effectiveEnabled,inputSha256,pillar2,readFrameSha256,result,rules,status,version' ||
      r.version !== 'horse-deep-dive-v1' ||
      !['observed', 'not_reached', 'refused'].includes(r.status) ||
      r.inputSha256 !== journalHash(horseJournalJson(request)) ||
      r.readFrameSha256 !== readFrameSha256 ||
      (readFrameSha256 !== null && !/^[a-f0-9]{64}$/.test(readFrameSha256)) ||
      ![true, false, null].includes(r.effectiveEnabled) ||
      r.pillar2 !== 'excluded_by_qualification' ||
      horseJournalJson(r.result) !== horseJournalJson(resultOf(decision)) ||
      !Array.isArray(r.rules) ||
      r.rules.length > Object.keys(DEEP_DIVE_RULES).length ||
      new Set(r.rules.map((x) => x.rule)).size !== r.rules.length ||
      (r.status === 'observed' && (r.effectiveEnabled === null || decision.policyFallback)) ||
      (r.status === 'not_reached' && (r.effectiveEnabled !== null || r.rules.length !== 0)) ||
      (r.effectiveEnabled !== true && r.rules.length !== 0)
    )
      return false;
    return r.rules.every(
      (x) =>
        x &&
        Object.keys(x).sort().join(',') === 'changed,eligible,evaluated,rule' &&
        Object.hasOwn(DEEP_DIVE_RULES, x.rule) &&
        [x.evaluated, x.eligible, x.changed].every(Number.isSafeInteger) &&
        x.evaluated >= 1 &&
        x.evaluated <= 32 &&
        x.eligible >= 0 &&
        x.eligible <= x.evaluated &&
        x.changed >= 0 &&
        x.changed <= x.eligible
    );
  } catch {
    return false;
  }
}
