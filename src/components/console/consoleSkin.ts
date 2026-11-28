import { createContext, useContext } from 'react';

/**
 * WHICH DRESS A CONSOLE WEARS (#SmarterDesign, Dan 2026-11-27).
 *
 * Dan, on the Player Management footer: "NO DO NOT USE THOSE BULKY FRAMES,
 * THATS THE OLD STYLE... USE THE #SMARTERDESIGN STYLE". Then, on the table:
 * "https://smarter.poker/hub/club-arena/table/... NEEDS THE SAME #SMARTERDESIGN
 * UPGRADE TO EVERY SINGLE PAGE, SUBPAGE, BUTTON AND EVERYTHING ELSE".
 *
 * `painted` is the spade/shark/riveted master art (SpadeConsole's own
 * measured zones). `smarterdesign` is the arena workspace language the
 * Cashier, Player Management and Club Operations wear (ArenaWorkspace.css):
 * one thin chrome case, live lettering in normal flow, chrome buttons with
 * the primary lit blue, and the close X as a 44px chrome key.
 *
 * Every popup on the table is a SpadeConsole, so the table provides
 * `smarterdesign` once (PersistentTableLayer) and all of them change together
 * with no caller touched. Surfaces off the table keep `painted` until they
 * are upgraded the same way.
 */
export type ConsoleSkin = 'painted' | 'smarterdesign';

export const ConsoleSkinContext = createContext<ConsoleSkin>('painted');

export const ConsoleSkinProvider = ConsoleSkinContext.Provider;

export function useConsoleSkin(): ConsoleSkin {
  return useContext(ConsoleSkinContext);
}
