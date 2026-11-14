/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  THE TABLE'S VIEW OF A MYSTERY BOUNTY EVENT (2026-10-05)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Three small rules TablePage applies, kept pure here so they can be tested
 * without mounting a 28,000-line page.
 *
 *   1. WHEN THE CHESTS GO LIVE, THE TABLE IS TOLD. The engine broadcasts
 *      `mystery_bounty_activated` once per event; only the lobby listened, so a
 *      player at the felt learned the phase had changed from the first chest.
 *      The table now raises one popup per event per mounted table.
 *
 *   2. A SEAT DOES NOT ADVERTISE A HEAD THAT IS NO LONGER THE PRIZE. Once the
 *      chests are live a knockout draws a chest, not the flat head still
 *      stored on `tournament_players.current_bounty`. The badge reads as a
 *      mystery prize instead of the stale figure.
 *
 *   3. THE BADGES ARE RE-READ WHEN THE SEATS CHANGE. `tournament_players` is
 *      not in the realtime publication, so the old UPDATE listener never fired
 *      and a player balanced in from another table showed no head (or a stale
 *      one) for up to the 30-second refresh. The seat list the engine already
 *      pushes is the trigger: when the set of players changes, re-read.
 */

/** The popup raised at the table when the chests open. Title Case, no dash. */
export const MYSTERY_BOUNTIES_LIVE_TEXT = 'Mystery Bounties Are Now Live';

/**
 * The popup raised at the table when entry closes and the prizes are sealed
 * (Dan 2026-11-13: "ONCE THE PRIZE POOL IS 'FINALIZED' ... ALL MYSTERY BOUNTY
 * PRIZES SHOULD BE SHOWN"). Tapping it opens the lobby on the Bounties tab.
 */
export const MYSTERY_BOUNTY_PRIZES_SET_TEXT = 'Mystery Bounty Prizes Are Set. Tap To See Them';

/**
 * Should this table announce that the chests are live? True exactly once per
 * event for the given `seen` set (one set per mounted table page).
 */
export function claimMysteryLiveAnnouncement(
  seen: Set<string>,
  tournamentId: string | null | undefined
): boolean {
  const key = String(tournamentId ?? '').trim();
  if (!key || seen.has(key)) return false;
  seen.add(key);
  return true;
}

/** Is the chest phase open, as the tournament row reports it? */
export function mysteryChestsLiveFromRow(
  row: { is_mystery_bounty?: unknown; mystery_bounty_stage?: unknown } | null | undefined
): boolean {
  return Boolean(row?.is_mystery_bounty) && String(row?.mystery_bounty_stage ?? '') === 'active';
}

export interface SeatBountyBadge {
  /** The flat head to print, or undefined for none. */
  value: number | undefined;
  /** True while the chests are live: the prize is a mystery, not the head. */
  mystery: boolean;
}

/** What a seat's bounty badge shows. */
export function seatBountyBadge(input: {
  isBountyTournament: boolean;
  mysteryChestsLive: boolean;
  playerId: string | null | undefined;
  playerStatus?: string | null;
  bountyMap: Record<string, number> | null | undefined;
  /**
   * The engine's own head for this seat (2026-11-05), carried on the table
   * state with the chips. It is preferred unless the bountyMap took a newer
   * value for this player since (see engineSeenAt / mapSeenAt), and the
   * bountyMap is the fallback for an engine build that does not send it.
   */
  engineBounty?: number | null;
  /**
   * When this client first saw the engine's current head for this player, and
   * when it first saw the bountyMap's current value (observeHead). Both are
   * this client's own clock, so no server clock skew enters the comparison.
   * The map wins only when it changed strictly later: a knockout broadcast or
   * a ledger read landed after the engine's last head for the seat (an engine
   * whose own heads read failed keeps publishing the older head).
   */
  engineSeenAt?: number;
  mapSeenAt?: number;
  /**
   * A chests-only mystery event (Dan 2026-10-22): no bounty is paid before the
   * money, so before the chests open a seat advertises no head at all.
   */
  chestsOnly?: boolean;
}): SeatBountyBadge {
  if (!input.isBountyTournament || !input.playerId) return { value: undefined, mystery: false };
  if (input.mysteryChestsLive) {
    // An eliminated player cannot be knocked out again; no prize hangs on them.
    const out = String(input.playerStatus ?? '').toLowerCase() === 'eliminated';
    return { value: undefined, mystery: !out };
  }
  if (input.chestsOnly) return { value: undefined, mystery: false };
  const engineHead = input.engineBounty;
  const mapHead = input.bountyMap?.[input.playerId];
  const mapIsFresher =
    typeof mapHead === 'number' &&
    Number.isFinite(mapHead) &&
    typeof input.mapSeenAt === 'number' &&
    typeof input.engineSeenAt === 'number' &&
    input.mapSeenAt > input.engineSeenAt;
  if (
    !mapIsFresher &&
    typeof engineHead === 'number' &&
    Number.isFinite(engineHead) &&
    engineHead >= 0
  ) {
    return { value: engineHead, mystery: false };
  }
  return { value: mapHead, mystery: false };
}

/** When this client first saw a source's current head for one player. */
export interface HeadObservation {
  value: number | undefined;
  at: number;
}

/**
 * Note a head as this client sees it and return when its current value was
 * first seen. Idempotent for an unchanged value (safe to call on every render,
 * and twice under StrictMode); a changed value restamps at `now`.
 */
export function observeHead(
  seen: Map<string, HeadObservation>,
  userId: string | null | undefined,
  value: unknown,
  now: number
): number | undefined {
  if (!userId) return undefined;
  const v = typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const prior = seen.get(userId);
  if (prior && prior.value === v) return prior.at;
  seen.set(userId, { value: v, at: now });
  return now;
}

/**
 * Does the table still need the client's own ledger poll? Only while a seated,
 * live player has no engine head on the table state (an engine build that
 * does not publish heads, or a seat the engine has not read yet). When every
 * seat carries the engine's head, the engine's own reads keep it true and the
 * poll would only repeat them.
 */
export function seatsNeedLedgerHeadPoll(
  players:
    | ReadonlyArray<{ id?: unknown; status?: unknown; bounty?: unknown } | null | undefined>
    | null
    | undefined
): boolean {
  return (players ?? []).some((p) => {
    if (!p || p.id == null || String(p.id) === '') return false;
    if (String(p.status ?? '').toLowerCase() === 'eliminated') return false;
    const head = p.bounty;
    return !(typeof head === 'number' && Number.isFinite(head) && head >= 0);
  });
}

/** Is this tournament row a chests-only mystery event? Unknown reads as no. */
export function mysteryChestsOnlyFromRow(
  row:
    | { is_mystery_bounty?: unknown; mystery_bounty_regular_pool_percent?: unknown }
    | null
    | undefined
): boolean {
  const regular = row?.mystery_bounty_regular_pool_percent;
  return (
    Boolean(row?.is_mystery_bounty) &&
    regular !== null &&
    regular !== undefined &&
    regular !== '' &&
    Number(regular) === 0
  );
}

/**
 * A stable signature of who is seated, so a change in the seat list (a player
 * balanced in, a seat vacated) can trigger one bounty re-read.
 */
export function seatedPlayersSignature(
  players: ReadonlyArray<{ id?: unknown } | null | undefined> | null | undefined
): string {
  return (players ?? [])
    .map((p) => (p && p.id != null ? String(p.id) : ''))
    .filter((id) => id.length > 0)
    .sort()
    .join(',');
}
