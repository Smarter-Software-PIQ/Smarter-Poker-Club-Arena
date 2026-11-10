/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TOURNAMENT RANKING HOST — app-root owner of the bust card (2026-08-20)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Sits beside SessionSummaryHost outside <Routes> and splits the same feed:
 *
 *   payload.tournament present  ->  this host renders the RANKING card
 *   payload.tournament absent   ->  SessionSummaryHost renders Session Complete
 *
 * One publisher, two cards, and the split is on the DATA rather than a flag, so
 * a tournament can never fall through to the cash summary and report a chip
 * profit for a seat where chips have no cash value.
 *
 * It lives at the app root for the reason the whole pendingSessionSummary
 * module exists: the player is mid-navigation when the result arrives, and
 * "the lobby" they land on is HomePage, ClubHomePage or ClubLobby depending on
 * where they came from. A route-level mount is torn down under them; this is
 * not.
 *
 * ── PLAY AGAIN IS A SEAT, NOT A LIST (2026-08-29, round 12) ────────────────
 *
 * The card's Play Again used to navigate to the tournaments list and leave
 * the player to find their own next game. For a seat-first game that is a
 * worse answer than the platform can give: the recycler keeps exactly one
 * open game per spin stake x variant and two per Heads-Up stake x variant
 * (measured in production this round, all 48 combinations covered), so the
 * next same-stake game ALWAYS exists. This host now finds it - same club,
 * same buy-in, same game type, same seat-first class as the game that just
 * ended, the scoping rule PR #1702 established - resolves its live table
 * through the same occupancy election the engine uses, and lands the player
 * on the felt to pick a seat. Nothing is charged by navigation; the seat is
 * only bought at the table's own confirm sheet.
 *
 * Every read is error-bound (the ratchet), and every miss - old payload
 * without the id, unreadable origin row, no sibling, no live table - falls
 * back to the card's own list navigation. A degraded answer, never a dead
 * end.
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useUserStore } from '../../stores/useUserStore';
import { useNavigate } from 'react-router-dom';
import {
  offersResultReplay,
  dismissSessionSummary,
  peekSessionSummary,
  subscribeSessionSummary,
  type SessionSummaryPayload,
} from '../../services/pendingSessionSummary';
import { supabase } from '../../lib/supabase';
import { runWithRequestDeadline } from '../../utils/requestDeadline';
import { readLocalSession } from '../../lib/authUtils';
import { tableService } from '../../services/TableService';
import { reportError } from '../../utils/errorReporter';
/* THE CARD IS LOADED WHEN IT IS NEEDED (2026-10-05). This host mounts at the
   app root, so anything it imports statically is in the chunk every player
   downloads before first paint - and the card is only ever shown after a
   tournament ends. Its reveal and share image put the initial load over the
   320kB gate (321kB measured), so it splits into its own chunk instead; the
   payload that shows it waits the few milliseconds the chunk takes. */
const TournamentRankingCard = lazy(() => import('./TournamentRankingCard'));
import { arenaAssetUnitCents } from '../../lib/arenaUnitCents';
import { useMasterBusSubscription } from '../../hooks/useMasterBusSubscription';
import { useSessionHandStats } from '../../hooks/useSessionHandStats';
import { useOptionalToast } from '../common/Toast';
import { masterBus } from '../../core/MasterBus';
import {
  isHeadsUpFormat,
  parseRematchAnswer,
  rematchFellThrough,
  rematchIsLive,
  rematchView,
  REMATCH_POLL_MS,
  type RematchAnswer,
  type RematchCardStatus,
} from '../../services/headsUpRematch';

/**
 * A finished game can still read COMPLETING for a moment after the bust card
 * is up; the rematch door answers not_eligible until it reads COMPLETED. Keep
 * asking this long before taking not_eligible as the answer.
 */
const REMATCH_ELIGIBILITY_GRACE_MS = 30_000;

export function TournamentRankingHost() {
  const [payload, setPayload] = useState<SessionSummaryPayload | null>(() => peekSessionSummary());
  const navigate = useNavigate();
  const handStatsTarget = payload?.handStatsTarget;
  const { stats: sessionHands } = useSessionHandStats(
    handStatsTarget?.tableId,
    handStatsTarget?.userId ?? '',
    !!payload?.tournament &&
      !!handStatsTarget &&
      readLocalSession()?.userId === handStatsTarget.userId,
    handStatsTarget?.asOf
  );

  /* One tap only: a double-tap on Play Again while the sibling lookup is in
     flight must not start a second lookup or navigate twice. */
  const playAgainBusyRef = useRef(false);

  useEffect(() => subscribeSessionSummary(setPayload), []);
  // A reload can mount before an expired SSO token finishes refreshing.
  // The existing auth event restores only the newly authenticated owner's cache.
  useMasterBusSubscription('AUTH_STATE_CHANGED', () => setPayload(peekSessionSummary()));

  const close = useCallback(() => dismissSessionSummary(), []);

  // October22: route changes during an exit are not an acknowledgement.
  // Keep the report until its own dismissal or Play Again gesture.

  const tournamentId = payload?.tournament?.tournamentId;

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   *  THE CARD SAYS WHERE YOU FINISHED (Dan 2026-08-30, round 17)
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * Dan: "THE RESULTS CARD NEEDS TO SAY THE PLACE YOU FINISHED. MINE SHOULD
   * SAY 3RD PLACE." His card said "Finished".
   *
   * The place was not missing — it was EARLY. `tournament_players` for that
   * game reads `position: 3, status: eliminated`, exactly as he said; the
   * engine had recorded it correctly. But the card is published at the instant
   * the player leaves the felt, and on the bust path that is BEFORE the engine
   * has written the row. `finishPlace` is `position || full?.finishPlace ||
   * null`, all three were empty at that moment, and the card renders `place !=
   * null ? ordinal(place) : 'Finished'`. So it printed the fallback and then
   * never asked again.
   *
   * A card that is a few hundred milliseconds early is not a reason to show a
   * player less than the app knows. This asks once the card is up, and briefly
   * retries, because the write is in flight rather than absent. It only ever
   * FILLS IN a missing place — it can never overwrite one the exit already
   * carried, which is the authoritative one when it exists.
   */
  const reportUserId = payload?.tournament?.userId ?? readLocalSession()?.userId;
  const finishSequence = payload?.tournament?.finishSequence;
  /* A heads-up result has exactly two entrants. Only then is the format
     asked, so no other finish ever pays for the rematch's read. */
  const reportIsTwoHanded = payload?.tournament?.entrants === 2;
  const finishPlace = payload?.tournament?.finishPlace;
  const satelliteQualification = Boolean(payload?.tournament?.satelliteQualification);
  useEffect(() => {
    if (!tournamentId) return;
    if (finishPlace != null || satelliteQualification) return; // recorded result is already known
    if (!reportUserId || reportUserId !== readLocalSession()?.userId) return;

    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      /* SETTLEMENT CAN LAG THE FELT BY MINUTES (Burls, Sunday 200 Deep Stack,
         2026-11-01). The bust path tears the table page down before the
         engine's elimination commit - the one write that stamps position AND
         prize - and in that event the commit landed 5s to 213s after the bust
         (median 51s across the paid places). Six looks over 9s gave up more
         than three minutes before the row existed, and the card sat on screen
         reading "Finished, Total Payout 0" the whole time. So: six quick looks
         for the common in-flight commit, then a patient look every 5s for up
         to six minutes - past the worst lag yet measured, with headroom. The
         card prints Pending until this lands (see TournamentRankingCard), so
         it never claims a 0 it cannot know. */
      const BACKFILL_BUDGET_MS = 360_000;
      const backfillStartedAt = Date.now();
      let backfillErrorReported = false;
      for (
        let attempt = 0;
        !cancelled && Date.now() - backfillStartedAt < BACKFILL_BUDGET_MS;
        attempt++
      ) {
        try {
          /* `readLocalSession()` rather than the auth round trip — a house rule
             the pre-push hook enforces, and the better call here anyway: this
             runs on a card already on screen, so the identity is known locally
             and there is no reason to spend a network hop on it inside a retry
             loop. (The hook greps for the banned call as a STRING, so naming it
             here even to say "not this" is enough to trip it — which is the
             same prose-matching trap the source pins in this repo are written
             around.) */
          const uid = readLocalSession()?.userId;
          if (!uid || uid !== reportUserId) return;
          const { data, error } = await runWithRequestDeadline(
            (signal) =>
              supabase
                .from('tournament_players')
                .select('position, prize, bounty_winnings, elimination_sequence')
                .eq('tournament_id', tournamentId)
                .eq('user_id', uid)
                .abortSignal(signal)
                .maybeSingle(),
            { signal: controller.signal }
          );
          if (cancelled) return;
          if (error) throw error;
          const place = Number(data?.position) || 0;
          if (place > 0) {
            if (
              finishSequence !== undefined &&
              (data?.elimination_sequence == null ||
                String(data.elimination_sequence) !== finishSequence)
            )
              return;
            setPayload((prev) =>
              prev &&
              prev.tournament &&
              prev.tournament.finishPlace == null &&
              prev.tournament.tournamentId === tournamentId &&
              (prev.tournament.userId ?? reportUserId) === reportUserId &&
              prev.tournament.finishSequence === finishSequence
                ? {
                    ...prev,
                    tournament: {
                      ...prev.tournament,
                      finishPlace: place,
                      /* The prize follows the place: a card that has just
                         learned the player came 3rd should not still be
                         claiming the 0 it was published with if the row says
                         otherwise. Only ever raises a zero. */
                      prize: prev.tournament.prize || Number(data?.prize) || 0,
                      /* Bounties ride the same commit and the same rule. */
                      bountyWinnings:
                        prev.tournament.bountyWinnings || Number(data?.bounty_winnings) || 0,
                    },
                  }
                : prev
            );
            return;
          }
        } catch (err) {
          if (cancelled) return;
          /* A transient read error must not end the wait - the whole point of
             this loop is outlasting a slow settlement. Report the first,
             keep looking. */
          if (!backfillErrorReported) {
            backfillErrorReported = true;
            reportError(err, 'TournamentRankingHost.finish_place_backfill_failed', {
              tournamentId,
            });
          }
        }
        await new Promise((r) => setTimeout(r, attempt < 6 ? 1500 : 5000));
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [tournamentId, reportUserId, finishSequence, finishPlace, satelliteQualification]);

  /* ═══════════════════════════════════════════════════════════════════════
     HEADS UP REMATCH (Dan 2026-11-08). See src/services/headsUpRematch.ts.

     For a two-seat Sit & Go the card's Play Again asks the opponent for a
     rematch instead of hunting a stranger's game. The database answers every
     question - who may ask, whether both agreed, which empty game and which
     seat - and this host only polls while the card is up. The second Yes buys
     BOTH players back in, in one database transaction, through the ordinary
     buy-in path (or neither, if either cannot pay). When the answer is
     matched this host only opens the new table. Every other answer leaves
     the ordinary Play Again on the card.
     ═══════════════════════════════════════════════════════════════════════ */
  const toast = useOptionalToast();
  const [rematchEligible, setRematchEligible] = useState(false);
  const [rematchStatus, setRematchStatus] = useState<RematchCardStatus | null>(null);
  const [rematchSeconds, setRematchSeconds] = useState<number | null>(null);
  const [rematchJoining, setRematchJoining] = useState(false);
  const rematchStatusRef = useRef<RematchCardStatus | null>(null);
  rematchStatusRef.current = rematchStatus;
  /* One buy-back-in per report, whatever arrives twice (a poll and the tap's
     own answer can both say matched). */
  const rematchJoinStartedRef = useRef(false);
  const rematchRespondBusyRef = useRef(false);
  const rematchRefusalToldRef = useRef(false);
  const rematchReportKey = tournamentId ? `${reportUserId}:${tournamentId}:${finishSequence}` : '';

  useEffect(() => {
    setRematchEligible(false);
    setRematchStatus(null);
    setRematchSeconds(null);
    setRematchJoining(false);
    rematchJoinStartedRef.current = false;
    rematchRespondBusyRef.current = false;
    rematchRefusalToldRef.current = false;
  }, [rematchReportKey]);

  const isCurrentRematchReport = useCallback(() => {
    const current = peekSessionSummary()?.tournament;
    return (
      !!current &&
      current.tournamentId === tournamentId &&
      current.finishSequence === finishSequence &&
      (!current.userId || current.userId === readLocalSession()?.userId)
    );
  }, [tournamentId, finishSequence]);

  /**
   * The match is made: the database has ALREADY bought both seats, together,
   * in the one transaction that recorded the second Yes. Nothing is bought
   * here and nothing can be bought twice; the card only opens the new table.
   */
  const openRematch = useCallback(
    (answer: RematchAnswer) => {
      if (rematchJoinStartedRef.current || !answer.tableId) return;
      rematchJoinStartedRef.current = true;
      setRematchJoining(true);
      if (answer.asset === 'diamonds' && typeof answer.diamondsAfter === 'number') {
        masterBus.emit('DIAMOND_BALANCE_CHANGED', {
          newBalance: answer.diamondsAfter,
          delta: -Number(answer.cost ?? 0),
          source: 'tournament_seat_first_buy_in',
        });
      }
      if (!isCurrentRematchReport()) return;
      close();
      navigate(`/table/${answer.tableId}`);
    },
    [isCurrentRematchReport, close, navigate]
  );

  /** A refused buy-back-in: nobody was charged; say why if it was ours. */
  const sayRematchRefusal = useCallback(
    (answer: RematchAnswer) => {
      if (rematchRefusalToldRef.current) return;
      rematchRefusalToldRef.current = true;
      if (!answer.reason) return;
      const reason = answer.reason;
      /* The wording lives with the buy-in service, which the first paint must
         not download: it is fetched only when there is a refusal to say. */
      void import('../../services/headsUpRematchRefusal')
        .then(({ rematchRefusalReasonIsKnown, rematchRefusalText }) => {
          if (!rematchRefusalReasonIsKnown(reason)) {
            reportError(
              new Error(`heads_up_rematch buy-in refused: ${reason}`),
              'TournamentRankingHost.rematch_buy_in_refused',
              { tournamentId, reason }
            );
          }
          toast?.error(rematchRefusalText(reason));
        })
        .catch((err) =>
          reportError(err, 'TournamentRankingHost.rematch_refusal_text_failed', { tournamentId })
        );
    },
    [toast, tournamentId]
  );

  const applyRematchAnswer = useCallback(
    (answer: RematchAnswer | null) => {
      if (!answer) return;
      setRematchStatus(answer.status);
      setRematchSeconds(answer.secondsLeft ?? null);
      if (answer.status === 'matched') openRematch(answer);
      if (answer.status === 'buy_in_refused') sayRematchRefusal(answer);
    },
    [openRematch, sayRematchRefusal]
  );

  /* Is this a heads-up result, and if so, poll the rematch while the card is
     up. One format read; then one state read every REMATCH_POLL_MS until the
     answer is final. Cancelled on unmount and on a new report. */
  useEffect(() => {
    if (!tournamentId) return;
    if (!reportUserId || reportUserId !== readLocalSession()?.userId) return;
    if (!reportIsTwoHanded) return;
    let cancelled = false;
    const controller = new AbortController();
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        const { data: origin, error } = await runWithRequestDeadline(
          (signal) =>
            supabase
              .from('tournaments')
              .select('format_contract, max_players')
              .eq('id', tournamentId)
              .abortSignal(signal)
              .maybeSingle(),
          { signal: controller.signal }
        );
        if (cancelled) return;
        if (error) throw error;
        if (!origin || !isHeadsUpFormat(origin)) return;
        setRematchEligible(true);
      } catch (err) {
        if (!cancelled) {
          reportError(err, 'TournamentRankingHost.rematch_format_read_failed', { tournamentId });
        }
        return;
      }
      let errorReported = false;
      const poll = async () => {
        if (cancelled) return;
        try {
          const { data, error } = await runWithRequestDeadline(
            (signal) =>
              supabase
                .rpc('ca_heads_up_rematch_state', { p_source_tournament_id: tournamentId })
                .abortSignal(signal),
            { signal: controller.signal }
          );
          if (cancelled) return;
          if (error) throw error;
          const answer = parseRematchAnswer(data);
          if (answer?.status === 'not_eligible') {
            if (Date.now() - startedAt < REMATCH_ELIGIBILITY_GRACE_MS) {
              timer = setTimeout(poll, REMATCH_POLL_MS);
              return;
            }
            setRematchEligible(false);
            return;
          }
          applyRematchAnswer(answer);
          if (answer && !rematchIsLive(answer.status)) return;
        } catch (err) {
          if (cancelled) return;
          if (!errorReported) {
            errorReported = true;
            reportError(err, 'TournamentRankingHost.rematch_state_read_failed', { tournamentId });
          }
        }
        if (!cancelled) {
          timer = setTimeout(poll, REMATCH_POLL_MS);
        }
      };
      void poll();
    })();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [tournamentId, reportUserId, finishSequence, reportIsTwoHanded, applyRematchAnswer]);

  /** Answer the rematch. Idempotent on the server; one request at a time here. */
  const respondToRematch = useCallback(
    async (accept: boolean): Promise<RematchAnswer | null> => {
      if (!tournamentId || rematchRespondBusyRef.current) return null;
      rematchRespondBusyRef.current = true;
      try {
        const { data, error } = await runWithRequestDeadline((signal) =>
          supabase
            .rpc('ca_heads_up_rematch_respond', {
              p_source_tournament_id: tournamentId,
              p_accept: accept,
            })
            .abortSignal(signal)
        );
        if (error) throw error;
        return parseRematchAnswer(data);
      } catch (err) {
        reportError(err, 'TournamentRankingHost.rematch_respond_failed', { tournamentId, accept });
        return null;
      } finally {
        rematchRespondBusyRef.current = false;
      }
    },
    [tournamentId]
  );

  /** Leaving the card is a No (Dan: both must agree). Best effort, never blocks the close. */
  const declineRematchQuietly = useCallback(() => {
    const status = rematchStatusRef.current;
    if (!rematchEligible || rematchJoinStartedRef.current) return;
    if (status !== null && !rematchIsLive(status)) return;
    void respondToRematch(false);
  }, [rematchEligible, respondToRematch]);

  const dismissCard = useCallback(() => {
    declineRematchQuietly();
    close();
  }, [declineRematchQuietly, close]);

  const playAgain = useCallback(() => {
    const requested = payload?.tournament;
    const isCurrentReport = () => {
      const current = peekSessionSummary()?.tournament;
      return (
        !!requested &&
        !!current &&
        current.tournamentId === requested.tournamentId &&
        current.finishSequence === requested.finishSequence &&
        (!requested.userId || requested.userId === readLocalSession()?.userId)
      );
    };
    /* The card's own fallback (tournaments list) handles the no-id case. */
    const fallback = () => {
      if (!isCurrentReport()) return;
      close();
      navigate(payload?.tournament?.isSpin ? '/tournaments?type=spin' : '/tournaments');
    };
    if (!offersResultReplay(requested)) {
      if (!isCurrentReport()) return;
      close();
      const clubId = useUserStore.getState().currentClubId;
      navigate(clubId ? `/clubs/${clubId}` : '/');
      return;
    }
    if (!tournamentId) {
      fallback();
      return;
    }
    if (playAgainBusyRef.current) return;
    playAgainBusyRef.current = true;

    void (async () => {
      try {
        // This root-mounted host only needs format routing after Play Again.
        // Keep it inside the action's existing failure/fallback boundary.
        const { readTournamentFormat, isSeatFirstTournamentFormat, isTournamentEntryUnavailable } =
          await import('../../utils/tournamentPresentation');
        const { awaitTournamentResultEnrichment } =
          await import('../../utils/tournamentResultEnrichment');
        const { data: origin, error: originErr } = (await awaitTournamentResultEnrichment(
          supabase
            .from('tournaments')
            .select(
              'format_contract, club_id, buy_in_amount, game_type, variant, tournament_type, satellite_target_id, satellite_target, max_players'
            )
            .eq('id', tournamentId)
            .maybeSingle()
        )) ?? { data: null, error: new Error('Play Again Origin Read Timed Out') };
        if (originErr) throw originErr;

        /* Seat-first games only: an MTT's "again" genuinely is the list. */
        const seatFirst = origin && isSeatFirstTournamentFormat(origin);
        if (!origin || !seatFirst) {
          fallback();
          return;
        }

        /* The sibling: same club, same stake, same game, same class - the
           scoping PR #1702 made law after the unscoped hop nearly seated a
           player in a stranger's club. Oldest first, matching the engine's
           own primary-table election bias. */
        let q = supabase
          .from('tournaments')
          .select(
            'format_contract, id, current_players, max_players, variant, tournament_type, satellite_target_id'
          )
          .eq('status', 'REGISTERING')
          .eq('buy_in_amount', origin.buy_in_amount)
          .eq('game_type', origin.game_type)
          .neq('id', tournamentId)
          .order('created_at', { ascending: true })
          .limit(6);
        if (origin.club_id) q = q.eq('club_id', origin.club_id);
        q = q.eq('format_contract', readTournamentFormat(origin));
        const target = origin.satellite_target_id ?? origin.satellite_target;
        if (target) q = q.or(`satellite_target_id.eq.${target},satellite_target.eq.${target}`);
        const { data: siblings, error: siblingErr } = (await awaitTournamentResultEnrichment(
          q
        )) ?? { data: null, error: new Error('Play Again Sibling Read Timed Out') };
        if (siblingErr) throw siblingErr;

        const sibling = siblings?.find(
          (candidate) =>
            isSeatFirstTournamentFormat(candidate) &&
            !isTournamentEntryUnavailable(candidate, Number(candidate.current_players ?? 0))
        );
        if (!sibling) {
          fallback();
          return;
        }

        const liveTable = await awaitTournamentResultEnrichment(
          tableService.resolveTournamentLiveTable(String(sibling.id))
        );
        if (!liveTable) {
          fallback();
          return;
        }

        if (!isCurrentReport()) return;
        close();
        navigate(`/table/${liveTable}`);
      } catch (err) {
        reportError(err, 'TournamentRankingHost.play_again_sibling_lookup_failed', {
          tournamentId,
        });
        fallback();
      } finally {
        playAgainBusyRef.current = false;
      }
    })();
  }, [tournamentId, payload?.tournament, close, navigate]);

  /* The rematch's two plates. Play Again is a Yes while the offer is open;
     once it has fallen through it is the ordinary Play Again above. */
  const rematchPrimary = useCallback(() => {
    const status = rematchStatusRef.current;
    if (rematchJoinStartedRef.current) return;
    if (rematchFellThrough(status)) {
      playAgain();
      return;
    }
    if (status === 'waiting_for_opponent' || status === 'finding_table' || status === 'matched')
      return;
    void respondToRematch(true).then((answer) => {
      if (!isCurrentRematchReport()) return;
      if (answer?.status === 'not_eligible' || answer === null) {
        // The door could not take the answer: the ordinary Play Again stands.
        if (answer?.status === 'not_eligible') setRematchEligible(false);
        if (answer === null) playAgain();
        return;
      }
      applyRematchAnswer(answer);
    });
  }, [playAgain, respondToRematch, applyRematchAnswer, isCurrentRematchReport]);

  const rematchSecondary = useCallback(() => {
    if (rematchJoinStartedRef.current) return;
    void respondToRematch(false).then((answer) => {
      if (!isCurrentRematchReport()) return;
      applyRematchAnswer(answer ?? { status: 'you_declined' });
    });
  }, [respondToRematch, applyRematchAnswer, isCurrentRematchReport]);

  if (!payload?.tournament) return null;
  if (payload.tournament.userId && payload.tournament.userId !== readLocalSession()?.userId)
    return null;

  return (
    <Suspense fallback={null}>
      <TournamentRankingCard
        key={JSON.stringify([reportUserId, tournamentId, finishSequence])}
        result={payload.tournament}
        tableName={payload.tableName}
        /* The payload has always carried these; the card simply never asked for
         them. See the props on TournamentRankingCard. */
        durationSeconds={
          handStatsTarget
            ? sessionHands
              ? Math.max(
                  0,
                  Math.floor(
                    ((sessionHands.throughAt
                      ? Date.parse(sessionHands.throughAt)
                      : handStatsTarget.asOf) -
                      Date.parse(sessionHands.startedAt)) /
                      1000
                  )
                )
              : undefined
            : payload.resultOnly
              ? undefined
              : payload.duration
        }
        handsPlayed={
          handStatsTarget
            ? (sessionHands?.handsPlayed ?? null)
            : payload.resultOnly
              ? undefined
              : payload.handsPlayed
        }
        /* THE GRID THIS EVENT PAID ON (2026-09-20). The payload has carried the
         table's arena asset since the wallet learned the Diamond Arena, and
         `parseArenaIdentity` only ever writes 'diamonds' for a row that
         satisfies all three of the conditions `fn_ca_tournament_unit_cents`
         tests, so the asset on it IS the unit. */
        unitCents={arenaAssetUnitCents(payload.arenaAsset)}
        endedAt={payload.sessionEnd}
        onDismiss={dismissCard}
        onPlayAgain={playAgain}
        rematch={
          rematchEligible
            ? {
                ...rematchView(rematchStatus, rematchSeconds, rematchJoining),
                onPrimary: rematchPrimary,
                onSecondary: rematchSecondary,
              }
            : undefined
        }
      />
    </Suspense>
  );
}

export default TournamentRankingHost;
