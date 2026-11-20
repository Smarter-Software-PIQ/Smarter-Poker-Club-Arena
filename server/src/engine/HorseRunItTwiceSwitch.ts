/**
 * Main-thread state of the option horseRunItTwiceIsPriced (default OFF).
 *
 * Run-it-twice answers are made on the engine's main thread (ServerTableEngineRunout), while the
 * option switch is delivered only to the decision workers (horseDecision/styleSwitchDelivery). Until
 * the Horse SWITCH lane wires the main-thread hook (asked in the coordination inbox 2026-11-20 22:07Z),
 * nothing calls setHorseRunItTwiceIsPriced and the option reads OFF everywhere: the engine answers with
 * HorseRunItTwice.horseRunItTwiceRuns exactly as before.
 */
let pricedOn = false;

export function horseRunItTwiceIsPricedOn(): boolean {
  return pricedOn;
}

/** Only an explicit true switches it on; anything else is off. */
export function setHorseRunItTwiceIsPriced(on: unknown): void {
  pricedOn = on === true;
}
