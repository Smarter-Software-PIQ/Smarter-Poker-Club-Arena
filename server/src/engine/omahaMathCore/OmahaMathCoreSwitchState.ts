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
  omahaMathCoreGate,
  type DeliveredSwitchConfigs,
} from '../horseDecision/responseValidation.js';

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

/** Tests only. */
export function resetOmahaMathCoreSwitchStateForTests(): void {
  delivered = DELIVERED_SWITCH_CONFIGS_NONE;
}
