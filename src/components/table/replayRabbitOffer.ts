/**
 * ═══════════════════════════════════════════════════════════════════════
 *  IS THIS REPLAYED HAND STILL HUNTABLE? (P5 2026-09-05; widened 2026-11-01)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The 2026-09-05 competitive research found one thing ClubWPT Gold does that
 * we did not: rabbit hunting from the hand replayer, so missing the window at
 * the felt is not final. The first cut of this file mirrored the engine's
 * 90-second felt window, because that was all the engine would sell.
 *
 * Dan 2026-11-01 widened the feature itself: "if you are looking at a
 * PREVIOUS HAND you can RABBIT HUNT, or run out the board's cards that would
 * have been there." The engine now persists every captured runout to the
 * RLS-sealed `rabbit_hunt_offers` table and serves a replayed hand from
 * there (ServerTableEngineSettlement.loadPersistedRabbitOffer), so ninety
 * seconds no longer bounds anything. What bounds it now is that table's own
 * retention: rows are pruned after ONE DAY (sp_prune_rabbit_hunt_offers,
 * migration 20260823141355), so a hand older than that is plainly past
 * selling and the button would be a dead control.
 *
 * THIS FILE STILL DOES NOT DECIDE WHETHER THE HAND CAN BE BOUGHT. The engine
 * does (`revealRabbitHunt`), and it checks more than a replayed record can
 * know: the runout's existence, the table's `allow_rabbit_hunt`, whether the
 * caller was dealt in, and whether they already paid. A second copy of those
 * rules on the client would be a second authority, and the two would drift
 * the first time either moved.
 *
 * What it decides is narrower and purely cosmetic: whether to OFFER the
 * button at all, so the replayer does not show a dead control on the
 * thousands of hands that are plainly past selling. It answers no when the
 * board already ran out (there is nothing unseen), when the hand ran more
 * than one board (Run It Twice and bomb pots are not sold - the engine
 * refuses them too), and when the hand is older than the server's own
 * retention.
 *
 * When it answers yes and the engine still says no, the engine's own
 * sentence is what the player sees. That is the right way round.
 */

/**
 * How long the engine keeps a persisted runout: `rabbit_hunt_offers` rows are
 * pruned after one day by sp_prune_rabbit_hunt_offers (created in migration
 * 20260823141355, scheduled alongside the 2026-11-01 widening). Copied, not
 * imported: the engine builds from its own rootDir and cannot share a module
 * with the app. `tests/unit/rabbitHuntFromTheReplayer.test.tsx` pins this
 * against the migration's own interval so the two cannot drift in silence.
 */
export const RABBIT_HUNT_REPLAY_RETENTION_MS = 86_400_000;

/**
 * The felt tile's own beat: the engine stamps `expires_at` ninety seconds
 * after the offer (RABBIT_HUNT_OFFER_TTL_MS, ServerTableEngineSettlement).
 * Inside it, the NEWEST hand is on sale to every player - that is the
 * original 2026-08-25 felt purchase, unchanged. Past it, a purchase is the
 * PREVIOUS-HAND feature, which is VIP-only (Dan 2026-11-01: "both of these
 * features are VIP only"), and the engine refuses a non-VIP before any
 * charge. The replayer uses this number only to decide which control a
 * non-VIP sees: the buy button while the felt window is open, the VIP note
 * after it.
 */
export const RABBIT_HUNT_FELT_WINDOW_MS = 90_000;

export interface ReplayRabbitCandidate {
  /** hand_number, the key the engine files its offer under. */
  readonly handNumber: number;
  /** When the hand was recorded. Close enough to settlement for a 1-day window. */
  readonly timestamp: number;
  /** Community cards on each board this hand ran. */
  readonly boards: ReadonlyArray<ReadonlyArray<unknown>>;
}

export interface ReplayRabbitOffer {
  readonly show: boolean;
  /** How many cards the engine would sell; 0 when there is nothing to sell. */
  readonly cardsUnseen: number;
  /** Milliseconds of the server's retention still left, floored at 0. */
  readonly msLeft: number;
}

export function replayRabbitOffer(
  hand: ReplayRabbitCandidate | null | undefined,
  now = Date.now()
): ReplayRabbitOffer {
  const none = { show: false, cardsUnseen: 0, msLeft: 0 } as const;
  if (!hand) return none;

  // More than one board is a re-run or a bomb pot. The engine does not sell
  // either - on a multi-run hand the shared prefix reads as a short board and
  // the "unseen" cards would be deck noise.
  const dealt = hand.boards.filter((b) => b.length > 0);
  if (hand.boards.length > 1) return none;

  const boardLength = dealt[0]?.length ?? 0;
  const cardsUnseen = Math.max(0, 5 - boardLength);
  // A board that ran out has nothing unseen behind it.
  if (cardsUnseen === 0) return none;

  const age = now - hand.timestamp;
  const msLeft = Math.max(0, RABBIT_HUNT_REPLAY_RETENTION_MS - age);
  // A clock skewed into the future is not a reason to hide the button; the
  // engine will refuse if it is genuinely too old.
  if (age > RABBIT_HUNT_REPLAY_RETENTION_MS) return { show: false, cardsUnseen, msLeft: 0 };

  return { show: true, cardsUnseen, msLeft };
}
