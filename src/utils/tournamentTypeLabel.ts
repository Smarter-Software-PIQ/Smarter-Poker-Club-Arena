import {
  isMysteryBountyTournament,
  isOrdinaryBountyTournament,
  isPkoTournament,
  isSatelliteTournament,
  sellsAddOn,
  sellsRebuys,
  sellsReentry,
  type TournamentTraitRow,
} from './tournamentFilters';

/**
 * THE FELT SAYS WHAT KIND OF EVENT IT IS (Dan 2026-11-05): "FREE BUY
 * TOURNAMENTS NEED TO SAY WHAT KIND OF FREE BUY IT IS. LIKE IF ITS A PKO NEEDS
 * TO SAY PKO EVENT, IF ITS A MYSTERY BOUNTY SAY THAT ETC. CURRENTLY JUST SAYS
 * AFTERNOON FREE BUY. NEXT LINE UNDER SHOULD SAY TOURNAMENT TYPE."
 *
 * The masthead line under the event name. The prize style is decided by the
 * same trait predicates the lobby medallions and Advanced Filters use, so the
 * felt, the lobby card and the filter chips can never disagree about a PKO.
 * Most specific first: a PKO and a mystery bounty are both bounty events, and
 * a satellite's prize is a seat whatever else it carries.
 *
 * Entry terms follow the engine's rule (`is_reentry && !is_rebuy ? 'reentry'
 * : 'rebuy'`): an event selling both is a Rebuy event.
 *
 * Returns null when the row cannot say what it is, so the felt prints nothing
 * rather than a guess.
 */
export function tournamentPrizeStyleLabel(row: TournamentTraitRow): string | null {
  if (isSatelliteTournament(row) === true) return 'Satellite Event';
  if (isPkoTournament(row) === true) return 'PKO Event';
  if (isMysteryBountyTournament(row) === true) return 'Mystery Bounty Event';
  const ordinary = isOrdinaryBountyTournament(row);
  if (ordinary === true) return 'Bounty Event';
  if (ordinary === false) return 'Regular Event';
  return null;
}

export function tournamentEntryTermsLabel(row: TournamentTraitRow): string | null {
  const rebuy = sellsRebuys(row);
  const reentry = sellsReentry(row);
  const addOn = sellsAddOn(row) === true;
  let terms: string | null;
  if (rebuy === true) terms = 'Rebuy';
  else if (reentry === true) terms = 'Re-Entry';
  else if (rebuy === false && reentry === false) terms = 'Freezeout';
  else terms = null;
  if (addOn) return terms ? `${terms} + Add-On` : 'Add-On';
  return terms;
}

/** "PKO Event · Rebuy + Add-On", or null when the row says nothing. */
export function tournamentTypeLabel(row: TournamentTraitRow | null | undefined): string | null {
  if (!row) return null;
  const parts = [tournamentPrizeStyleLabel(row), tournamentEntryTermsLabel(row)].filter(
    (p): p is string => Boolean(p)
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}
