/**
 * Main-thread state of the option horseRunItTwiceIsPriced (default OFF).
 *
 * Run-it-twice answers are made on the engine's main thread (ServerTableEngineRunout.horseRitRuns),
 * while the option switch reaches the decision workers through horseDecision/styleSwitchDelivery.
 * Per the Horse SWITCH lane's ruling (coordination inbox 2026-11-20 22:49Z, item 3) the main thread
 * keeps its own OptionSwitchHolder, fed by the SAME delivery tick (lane.ts hands every
 * STYLE_SWITCH_STATE message to receiveHorseRunItTwiceSwitchMessage as well as to the workers), with
 * the same inbox, staleness and parse rules as a worker. It is read only by horseRitRuns.
 *
 * Fails safe to OFF: nothing delivered, unreadable, invalid or stale configuration, or a name the
 * registry does not list (until the option is registered through list-once, a row for it is skipped
 * by the parser, so it reads OFF). Receipts for switch changes are already noted by every worker; the
 * main-thread holder notes none, so nothing is counted twice.
 */
import { OptionSwitchHolder, optionSwitchDecisionOpts } from './HorseOptionSwitch.js';
import { createStyleSwitchWorkerInbox } from './horseDecision/styleSwitchDelivery.js';

export const HORSE_RUN_IT_TWICE_PRICED_OPTION = 'horseRunItTwiceIsPriced';

function makeHolder(clock: () => number, wallClock: () => number = () => Date.now()) {
  const inbox = createStyleSwitchWorkerInbox(clock, wallClock);
  // pollMs = 0: horseRitRuns runs only on all-in RIT offers on the main thread, so reading the
  // latest delivered inbox message on every call avoids up to STYLE_SWITCH_POLL_MS (60s) of lag on
  // activation or emergency rollback while keeping STYLE_SWITCH_STALE_MS (120s) staleness intact.
  const holder = new OptionSwitchHolder(inbox.optionSource, () => undefined, 0);
  return { inbox, holder };
}

let mainThread = makeHolder(() => performance.now());

/** The delivery tick's message (lane.ts). Never throws. */
export function receiveHorseRunItTwiceSwitchMessage(message: unknown): void {
  try {
    mainThread.inbox.receive(message);
  } catch {
    /* an unreadable message leaves the last state; the holder's staleness rule turns it off */
  }
}

/** True only when the delivered, fresh, valid configuration switches the option on. */
export function horseRunItTwiceIsPricedOn(nowMs: number = performance.now()): boolean {
  try {
    return (
      optionSwitchDecisionOpts(mainThread.holder.refresh(nowMs))[
        HORSE_RUN_IT_TWICE_PRICED_OPTION
      ] === true
    );
  } catch {
    return false;
  }
}

/** Tests only: a fresh holder on the given monotonic and wall clocks. */
export function resetHorseRunItTwiceSwitchForTest(
  clock: () => number = () => performance.now(),
  wallClock: () => number = () => Date.now()
): void {
  mainThread = makeHolder(clock, wallClock);
}
