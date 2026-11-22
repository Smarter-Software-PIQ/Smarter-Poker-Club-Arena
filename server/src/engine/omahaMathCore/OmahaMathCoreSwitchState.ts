/**
 * omahaMathCore switch as the engine's main thread last handed it to the
 * decision workers (lane COREGUARD 2026-11-19). The worker-failure doors
 * (ServerTableEngineTurns, LightningHorse) read it to know whether a failed
 * PLO4/PLO5 cash decision was the core's to make; the same gate the receipt
 * validator uses (omahaMathCoreGate: the request's option, the delivered
 * switch row, or the one before it while it still counts).
 */
import {
  DELIVERED_SWITCH_CONFIGS_NONE,
  deliveredSwitchConfigsNote,
  deliveredSwitchConfigsPrevious,
  omahaMathCoreAdmissionGate,
  omahaMathCoreGate,
  type DeliveredSwitchConfigs,
} from '../horseDecision/responseValidation.js';
import {
  OMAHA_MATH_CORE_STREET_FLAG_NAMES,
  type OmahaMathCoreStreetFlag,
} from './OmahaMathCoreRule.js';

let delivered: DeliveredSwitchConfigs = DELIVERED_SWITCH_CONFIGS_NONE;

/** Called where the client hands a worker the switch configuration (null: unreadable). */
export function noteOmahaMathCoreSwitchDelivered(
  config: unknown,
  nowMs: number = Date.now()
): void {
  try {
    delivered = deliveredSwitchConfigsNote(delivered, config, nowMs);
  } catch {
    /* never affects gameplay */
  }
}

/** Whether a decision with these request options may have been the core's (switch on). */
export function omahaMathCoreSwitchOn(
  requestOpts: Readonly<Record<string, unknown>> | null | undefined,
  nowMs: number = Date.now()
): boolean {
  try {
    return omahaMathCoreGate(
      requestOpts,
      delivered.current,
      deliveredSwitchConfigsPrevious(delivered, nowMs)
    );
  } catch {
    return false;
  }
}

/**
 * The admission flags (omahaMathCorePreflop and the six street flags) a decision with these request options may
 * have run with: the request's option, the delivered switch row, or the one before it while it still counts.
 * Unreadable: every flag off (the core owns no street, so its recovery does not act).
 */
export function omahaMathCoreAdmissionOpts(
  requestOpts: Readonly<Record<string, unknown>> | null | undefined,
  nowMs: number = Date.now()
): ReturnType<typeof omahaMathCoreAdmissionGate> | Record<string, never> {
  try {
    return omahaMathCoreAdmissionGate(
      requestOpts,
      delivered.current,
      deliveredSwitchConfigsPrevious(delivered, nowMs)
    );
  } catch {
    return {};
  }
}

/** omahaMathCoreRecover's admission inputs (preflopOwned, streetOpts) for a worker-failure door. */
export function omahaMathCoreRecoverAdmission(
  requestOpts: Readonly<Record<string, unknown>> | null | undefined,
  nowMs: number = Date.now()
): {
  preflopOwned: boolean;
  streetOpts: Partial<Record<OmahaMathCoreStreetFlag, boolean>>;
} {
  const a = omahaMathCoreAdmissionOpts(requestOpts, nowMs) as Partial<Record<string, boolean>>;
  const streetOpts: Partial<Record<OmahaMathCoreStreetFlag, boolean>> = {};
  for (const flag of OMAHA_MATH_CORE_STREET_FLAG_NAMES) streetOpts[flag] = a[flag] === true;
  return { preflopOwned: a.omahaMathCorePreflop === true, streetOpts };
}

/** Tests only. */
export function resetOmahaMathCoreSwitchStateForTests(): void {
  delivered = DELIVERED_SWITCH_CONFIGS_NONE;
}
