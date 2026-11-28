import {
  useSatelliteAwards,
  satelliteAwardLabel,
  satelliteAwardNotice,
  satelliteAwardTotalLabel,
} from '../../components/tournament/details/useSatelliteAwards';
import { usePlayerPreference } from '../../hooks/usePlayerPreference';
/**
 * ♠ CLUB ARENA — Tournament Results History Page
 * Shows completed tournaments with final standings, prizes, and stats.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { readTournamentStandings } from '../../services/readTournamentStandings';
import { runWithRequestDeadline } from '../../utils/requestDeadline';
import { useVisibleRead } from '../../hooks/useVisibleRead';
import { useAuthUser } from '../../hooks/useAuthUser';
import { useToast } from '../../components/common/Toast';
import ArenaWorkspaceHeader from '../../components/lobby/ArenaWorkspaceHeader';
import '../../components/ops/ArenaOps.css';
import './TournamentResultsPage.css';

import { useIsMounted } from '../../hooks/useIsMounted';
import { reportError } from '../../utils/errorReporter';
import {
  biggestEarner,
  bountyBeatTheChampion,
  sortResults,
  totalPayout,
  type ResultSort,
} from '../../utils/tournamentPayout';
import { TOURNAMENT_ARENA_EMBED } from '../../services/TournamentService';
import {
  tournamentRowUnitCents,
  type TournamentArenaEmbed,
} from '../../components/tournament/details/types';
import { formatPrizeAtUnit, moneySuffixAtUnit } from '../../utils/format';
import { CHIP_UNIT_CENTS, normalizeUnitCents } from '../../../server/src/tournament/tournamentUnit';
import {
  MysteryBountyService,
  formatCents,
  playerTotalsFromAwards,
  type MysteryBountyLeaderboardRow,
  type MysteryBountyPlayerTotals,
} from '../../services/MysteryBountyService';
import TournamentPaymentStatus from '../../components/tournament/TournamentPaymentStatus';
import { isRecordedSatelliteQualifier } from '../../utils/satelliteQualification';
import { displayTotalPool } from '../../utils/tournamentPrizeFunding';

interface CompletedTournament {
  id: string;
  name: string;
  variant: string;
  tournament_type: string;
  game_type: string;
  buy_in_amount: number;
  buy_in_fee: number;
  /** Places pool, net of bounty and rake. The page prints places + bounties. */
  prize_pool: number;
  /** Bounty money the event paid out; part of the total prize pool. */
  bounty_pool?: number | null;
  current_players: number;
  max_players: number | null;
  min_players?: number | null;
  table_size?: number | null;
  satellite_seats?: number | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  is_xmtt: boolean;
  is_bounty: boolean;
  is_pko: boolean;
  is_mystery_bounty: boolean;
  spin_multiplier: number | null;
  format_contract?: string | null;
  satellite_target_id?: string | null;
  satellite_target?: string | null;
  /**
   * THE CLUB THIS EVENT BELONGED TO (2026-09-20), exactly the three columns
   * `fn_ca_tournament_unit_cents` joins and tests. Every prize, bounty and
   * mystery figure on this page is read at the unit that follows from it, so a
   * Diamond event's record is denominated the way it was paid.
   */
  arena?: TournamentArenaEmbed['arena'];
}

/**
 * One finisher's row.
 *
 * Dan section 37: the categories stay SEPARATE in the record. `prize` is the
 * placement prize and nothing else; `bounty_winnings` is every bounty this
 * player collected (the flat bounty paid before the mystery phase opens AND the
 * chests paid after it); `total` is the sum, computed at render and never
 * stored back over either half.
 *
 * Sections 42 and 44 are the reason the total is a first-class column rather
 * than something a reader adds up: in a mystery bounty event a player who
 * finished 14th can out-earn the champion, and a table that only shows the
 * placement prize reports the champion as the biggest winner of the night when
 * they were not.
 */
interface TournamentResult {
  user_id: string;
  username: string;
  position: number | null;
  /** Placement prize ONLY. */
  prize: number;
  /** Every bounty collected, in the same whole-chip units as `prize`. */
  bounty_winnings: number;
  /** Knockouts that paid. */
  bounties_collected: number;
  status: string;
  chips: number | null;
}

interface ArchiveRead<T> {
  tournamentId: string | null;
  data: T;
  loading: boolean;
  error: string | null;
}

interface HandHistoryRecord {
  id: string;
  hand_number: number;
  small_blind: number;
  big_blind: number;
  pot_size: number;
  game_variant: string;
  community_cards: string[];
  winners: { userId: string; amount: number }[];
  players: { userId: string; username: string; seat: number; stack: number; cards: string[] }[];
  created_at: string;
}

export default function TournamentResultsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuthUser();
  const toast = useToast();
  const [tournaments, setTournaments] = useState<CompletedTournament[]>([]);
  const [selectedTournament, setSelectedTournament] = useState<CompletedTournament | null>(null);
  const [visibleResults, setVisibleResults] = useState<Set<string>>(new Set());
  const [resultsRead, setResultsRead] = useState<ArchiveRead<TournamentResult[]>>({
    tournamentId: null,
    data: [],
    loading: false,
    error: null,
  });
  const results = resultsRead.tournamentId === selectedTournament?.id ? resultsRead.data : [];
  const deepLinkedRef = useRef(false);
  const selectionRequestRef = useRef(0);
  const selectTournament = (tournament: CompletedTournament | null) => {
    selectionRequestRef.current += 1;
    deepLinkedRef.current = true;
    setSelectedTournament(tournament);
  };
  const [handsRead, setHandsRead] = useState<ArchiveRead<HandHistoryRecord[]>>({
    tournamentId: null,
    data: [],
    loading: false,
    error: null,
  });
  const handsRequestRef = useRef(0);
  const handHistory = handsRead.tournamentId === selectedTournament?.id ? handsRead.data : [];
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  /* DEEP-LINKABLE FILTERS (2026-08-29, round 10). Other surfaces can now
     send a player straight to a filtered view - the hamburger's "My Spin
     Results" links `?filter=mine&type=spin`. Values are validated against
     the same lists the buttons below render, so a bad param is just the
     default view rather than an empty board. */
  const VALID_TYPE_FILTERS = [
    'all',
    'freezeout',
    'bounty',
    'progressive_bounty',
    'mystery_bounty',
    'sng',
    'spin',
    'xmtt',
  ];
  const filterParam = searchParams.get('filter');
  const typeParam = searchParams.get('type');
  const [filter, setFilter] = usePlayerPreference<'all' | 'mine'>(
    'tournament/TournamentResultsPage:filter',
    filterParam === 'mine' ? 'mine' : 'all'
  );
  const [typeFilter, setTypeFilter] = usePlayerPreference<string>(
    'tournament/TournamentResultsPage:typeFilter',
    typeParam && VALID_TYPE_FILTERS.includes(typeParam) ? typeParam : 'all'
  );
  const [activeTab, setActiveTab] = useState<'standings' | 'hands'>('standings');
  /**
   * Sections 42 and 44. Default is FINISH, because a tournament result is a
   * place. "Total Payout" is the second view precisely so the fact that a lower
   * finisher can top the money list is visible rather than implied.
   */
  const [resultSort, setResultSort] = usePlayerPreference<ResultSort>(
    'tournament/TournamentResultsPage:resultSort',
    'finish'
  );
  /** Mystery bounty split for the selected event. Empty for every other format. */
  const [mysteryRead, setMysteryRead] = useState<
    ArchiveRead<{
      board: MysteryBountyLeaderboardRow[];
      totals: Map<string, MysteryBountyPlayerTotals>;
    }>
  >({ tournamentId: null, data: { board: [], totals: new Map() }, loading: false, error: null });
  const mysteryRequestRef = useRef(0);
  const mysteryBoard =
    mysteryRead.tournamentId === selectedTournament?.id ? mysteryRead.data.board : [];
  const mysteryTotals =
    mysteryRead.tournamentId === selectedTournament?.id
      ? mysteryRead.data.totals
      : new Map<string, MysteryBountyPlayerTotals>();
  /* BIGGEST HITS (2026-08-29, round 11). The wheel's big draws are the
     format's whole story and nothing surfaced them: who hit 25x, 50x, 100x,
     at what stake, for how much. Loaded only when the Spin type filter is
     active. HORSES ARE PLAYERS (CLAUDE.md 10.5): winners are shown whoever
     they are, no is_horse filter. */
  const [biggestHits, setBiggestHits] = useState<
    Array<{
      tournamentId: string;
      multiplier: number;
      buyIn: number;
      prize: number | null;
      winnerName: string;
      endedAt: string;
    }>
  >([]);
  /* SPIN LEADERBOARDS (2026-08-29, round 15). Three boards a spin player
     actually wants, aggregated server-side by fn_spin_leaderboards - at
     ~1,800 spins a day the browser has no business paging that to rank ten
     names. HORSES ARE PLAYERS (10.5): the RPC applies no is_horse filter and
     neither does this. */
  const [spinBoards, setSpinBoards] = useState<{
    mostSpins: Array<{ username: string; spins: number }>;
    bestNet: Array<{ username: string; net: number; spins: number }>;
  } | null>(null);
  const [spinBoardTab, setSpinBoardTab] = useState<'volume' | 'net'>('net');

  const isMounted = useIsMounted();

  // These archive tables are deliberately absent from the WAL publication.
  // Cost follows visible archive readers, rather than every live hand.
  const loadTournaments = useVisibleRead<CompletedTournament[]>({
    scopeKey: JSON.stringify([user?.id, filter, typeFilter]),
    enabled: true,
    intervalMs: 30_000,
    onReset: () => {
      setTournaments([]);
      setIsLoading(true);
      setListError(null);
    },
    read: async (signal) => {
      if (filter === 'mine' && !user?.id) {
        throw new Error('Sign In To View Your Tournament Results.');
      }
      /* MINE IS A JOIN, NOT A CLIENT SCAN (2026-08-29, round 12).
         The old shape fetched EVERY tournament_players row the player ever
         had - fetchAllRows, paged, thousands of rows for a regular - to
         intersect against a 100-row list in the browser. Worse than slow, it
         was WRONG for exactly the player it cost the most: the list is the
         newest 100 completed events overall, so a spin regular whose games
         age out of the top 100 saw their own history shrink toward empty.
         The inner join pushes both problems into one query: the newest 100
         completed events THE PLAYER WAS IN. */
      const cols = `id, name, variant, tournament_type, game_type, buy_in_amount, buy_in_fee, prize_pool, bounty_pool, current_players, max_players, min_players, table_size, satellite_seats, status, started_at, ended_at, is_xmtt, is_bounty, is_pko, is_mystery_bounty, spin_multiplier, format_contract, satellite_target_id, satellite_target, ${TOURNAMENT_ARENA_EMBED}`;
      const mine = filter === 'mine' && user?.id;
      let query = supabase
        .from('tournaments')
        .select(mine ? `${cols}, tournament_players!inner(user_id)` : cols)
        .eq('status', 'COMPLETED')
        .order('ended_at', { ascending: false })
        .limit(100);
      if (mine) query = query.eq('tournament_players.user_id', user.id);

      if (typeFilter !== 'all') {
        if (typeFilter === 'xmtt') {
          query = query.eq('is_xmtt', true);
        } else {
          query = query.eq('variant', typeFilter);
        }
      }

      const { data, error: listErr } = await query.abortSignal(signal);
      if (listErr) throw listErr;
      return (
        (data ?? []) as unknown as Array<CompletedTournament & { tournament_players?: unknown }>
      ).map(({ tournament_players: _tp, ...t }) => t as CompletedTournament);
    },
    onData: (data) => {
      setTournaments((previous) =>
        JSON.stringify(previous) === JSON.stringify(data) ? previous : data
      );
      setIsLoading(false);
      setListError(null);
    },
    onError: (error) => {
      reportError(error, 'TournamentResultsPage.Failed_to_load_tournament_results');
      setListError(
        filter === 'mine' && !user?.id
          ? 'Sign In To View Your Tournament Results.'
          : 'Could Not Load Tournament Results. Please Retry.'
      );
      setIsLoading(false);
      toast?.error('Failed to load tournament results');
    },
  });

  /* ── BIGGEST HITS (round 11) ─────────────────────────────────────────────
     The ten largest wheel draws that actually completed, 10x and up, most
     recent first within a multiplier. Two reads, both error-bound (the
     ratchet holds this file at zero discarded reads): the spins, then their
     winners. The winner's prize comes from tournament_players.prize - the
     column rounds 9-10 made trustworthy. */
  useEffect(() => {
    if (typeFilter !== 'spin') {
      setBiggestHits([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: hits, error: hitsErr } = await supabase
          .from('tournaments')
          .select('id, buy_in_amount, spin_multiplier, ended_at')
          .eq('variant', 'spin')
          .eq('status', 'COMPLETED')
          .gte('spin_multiplier', 10)
          .order('spin_multiplier', { ascending: false })
          .order('ended_at', { ascending: false })
          .limit(10);
        if (hitsErr) throw hitsErr;
        if (cancelled || !isMounted.current || !hits || hits.length === 0) return;

        const ids = hits.map((h) => h.id);
        const { data: winners, error: winnersErr } = await supabase
          .from('tournament_players_public')
          .select('tournament_id, username, prize')
          .in('tournament_id', ids)
          .eq('position', 1);
        if (winnersErr) throw winnersErr;
        if (cancelled || !isMounted.current) return;

        const winnerByTid = new Map(
          (winners || []).map((w) => [String(w.tournament_id), w] as const)
        );
        setBiggestHits(
          hits.map((h) => {
            const w = winnerByTid.get(String(h.id));
            return {
              tournamentId: String(h.id),
              multiplier: Number(h.spin_multiplier) || 0,
              buyIn: Number(h.buy_in_amount) || 0,
              // A missing award is unknown. Pool arithmetic cannot reconstruct
              // a winner's payout, and a recorded zero must remain zero.
              prize:
                w?.prize !== null && w?.prize !== undefined && Number.isFinite(Number(w.prize))
                  ? Number(w.prize)
                  : null,
              winnerName: String(w?.username ?? 'Player'),
              endedAt: String(h.ended_at ?? ''),
            };
          })
        );
      } catch (err) {
        reportError(err, 'TournamentResultsPage.biggest_hits_load_failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [typeFilter]);

  /* ── SPIN LEADERBOARDS (round 15) ────────────────────────────────────────
     One RPC, one read, Spin view only. Error-bound per the ratchet; a
     failure leaves the boards hidden rather than showing an empty podium
     that would read as "nobody has played". */
  useEffect(() => {
    if (typeFilter !== 'spin') {
      setSpinBoards(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error: boardsErr } = await supabase.rpc('fn_spin_leaderboards', {
          p_days: 7,
        });
        if (boardsErr) throw boardsErr;
        if (cancelled || !isMounted.current) return;
        const r = data as {
          most_spins?: Array<{ username?: string; spins?: number }>;
          best_net?: Array<{ username?: string; net?: number; spins?: number }>;
        } | null;
        setSpinBoards({
          mostSpins: (r?.most_spins ?? []).map((x) => ({
            username: String(x?.username ?? 'Player'),
            spins: Number(x?.spins) || 0,
          })),
          bestNet: (r?.best_net ?? []).map((x) => ({
            username: String(x?.username ?? 'Player'),
            net: Number(x?.net) || 0,
            spins: Number(x?.spins) || 0,
          })),
        });
      } catch (err) {
        reportError(err, 'TournamentResultsPage.spin_leaderboards_load_failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [typeFilter]);

  // ── DEEP LINK: Auto-select tournament from ?id= query parameter ──
  useEffect(() => {
    if (deepLinkedRef.current) return; // Only process once
    const tournamentId = searchParams.get('id');
    if (!tournamentId) return;

    // If we already have tournaments loaded, select from them
    const found = tournaments.find((t) => t.id === tournamentId);
    if (found) {
      setSelectedTournament(found);
      deepLinkedRef.current = true;
      return;
    }

    // If not in list yet (might still be COMPLETING), load it directly
    if (!isLoading && !found) {
      let cancelled = false;
      const selectionRequest = selectionRequestRef.current;
      // Tournament list loaded but ID not found — try direct load
      (async () => {
        const { data, error: deepLinkErr } = await supabase
          .from('tournaments')
          .select(
            `id, name, variant, tournament_type, game_type, buy_in_amount, buy_in_fee, prize_pool, bounty_pool, current_players, max_players, min_players, table_size, satellite_seats, status, started_at, ended_at, is_xmtt, is_bounty, is_pko, is_mystery_bounty, spin_multiplier, format_contract, satellite_target_id, satellite_target, ${TOURNAMENT_ARENA_EMBED}`
          )
          .eq('id', tournamentId)
          .maybeSingle();
        // ROUND 10 (2026-08-29): a failed deep-link read silently ignored the
        // ?id= the player arrived with; deepLinkedRef stays false so a later
        // list load can still resolve it, but the failure now reports.
        if (deepLinkErr) {
          reportError(deepLinkErr, 'TournamentResultsPage.deep_link_read_failed', {
            tournamentId,
          });
        }
        if (
          cancelled ||
          !isMounted.current ||
          selectionRequest !== selectionRequestRef.current ||
          deepLinkErr ||
          !data
        )
          return;
        const linkedTournament = data as CompletedTournament;
        setTournaments((current) =>
          current.some((t) => t.id === tournamentId) ? current : [linkedTournament, ...current]
        );
        setSelectedTournament(linkedTournament);
        deepLinkedRef.current = true;
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [tournaments, searchParams, isLoading]);

  // Completed-event standings may receive a final payout correction later.
  // Read only the selected event while this view is visible, with one request.
  const loadResults = useVisibleRead<TournamentResult[]>({
    scopeKey: JSON.stringify([user?.id, selectedTournament?.id]),
    enabled: Boolean(selectedTournament?.id),
    intervalMs: 60_000,
    onReset: () =>
      setResultsRead({
        tournamentId: selectedTournament?.id ?? null,
        data: [],
        loading: Boolean(selectedTournament?.id),
        error: null,
      }),
    read: async (signal) => {
      const tournamentId = selectedTournament!.id;
      // Read the complete recorded field before ranking any prizes or bounties.
      const { data, error: standingsErr } = await readTournamentStandings(
        tournamentId,
        'id, user_id, username, position, prize, bounty_winnings, bounties_collected, status, chips',
        false,
        signal
      );
      if (standingsErr) throw standingsErr;
      return (data || []).map((r) => ({
        user_id: String((r as { user_id: string }).user_id),
        username: String((r as { username: string | null }).username ?? 'Player'),
        position: (r as { position: number | null }).position ?? null,
        prize: Number((r as { prize: number | null }).prize) || 0,
        bounty_winnings: Number((r as { bounty_winnings: number | null }).bounty_winnings) || 0,
        bounties_collected:
          Number((r as { bounties_collected: number | null }).bounties_collected) || 0,
        status: String((r as { status: string | null }).status ?? ''),
        chips: (r as { chips: number | null }).chips ?? null,
      }));
    },
    onData: (data) =>
      setResultsRead((previous) => {
        if (
          previous.tournamentId === selectedTournament?.id &&
          !previous.error &&
          !previous.loading &&
          JSON.stringify(previous.data) === JSON.stringify(data)
        )
          return previous;
        return { tournamentId: selectedTournament!.id, data, loading: false, error: null };
      }),
    onError: (error) => {
      reportError(error, 'TournamentResultsPage.loadResults_error');
      setResultsRead({
        tournamentId: selectedTournament?.id ?? null,
        data: [],
        loading: false,
        error: 'Could Not Load These Standings. Please Retry.',
      });
    },
  });

  /**
   * The MYSTERY half, broken out (section 37).
   *
   * `tournament_players.bounty_winnings` is the total of every bounty a player
   * collected, and in a mystery event that includes the flat bounties paid
   * during late registration, before the chests opened. This second read says
   * how much of it came out of a chest, and it comes from the RPCs rather than
   * the tables, which have RLS on with no select policy.
   */
  const loadMysteryBounty = async () => {
    const request = ++mysteryRequestRef.current;
    const t = selectedTournament;
    const tournamentId = t?.id ?? null;
    setMysteryRead({
      tournamentId,
      data: { board: [], totals: new Map() },
      loading: Boolean(t?.is_mystery_bounty),
      error: null,
    });
    if (!t?.is_mystery_bounty) return;
    try {
      const [board, awards] = await Promise.all([
        MysteryBountyService.getLeaderboard(t.id, { strict: true }),
        MysteryBountyService.getAllAwards(t.id, { strict: true }),
      ]);
      if (!isMounted.current || request !== mysteryRequestRef.current) return;
      setMysteryRead({
        tournamentId,
        data: { board, totals: playerTotalsFromAwards(awards.rows) },
        loading: false,
        error: null,
      });
    } catch (err) {
      if (!isMounted.current || request !== mysteryRequestRef.current) return;
      reportError(err, 'TournamentResultsPage.loadMysteryBounty_error');
      setMysteryRead({
        tournamentId,
        data: { board: [], totals: new Map() },
        loading: false,
        error: 'Could Not Load These Mystery Awards. Please Retry.',
      });
    }
  };

  // Load hand history for selected tournament
  const loadHandHistory = async () => {
    const request = ++handsRequestRef.current;
    const tournamentId = selectedTournament?.id ?? null;
    setHandsRead({ tournamentId, data: [], loading: Boolean(tournamentId), error: null });
    if (!tournamentId) return;

    try {
      // ROUND 10 (2026-08-29): same shape - a resolved error read as "no
      // hands recorded". Throwing routes it to the report below.
      const { data, error: handsErr } = await runWithRequestDeadline((signal) =>
        supabase
          .from('hand_history')
          .select(
            'id, hand_number, small_blind, big_blind, pot_size, game_variant, community_cards, winners, players, created_at'
          )
          .eq('tournament_id', tournamentId)
          .order('hand_number', { ascending: false })
          .limit(100)
          .abortSignal(signal)
      );
      if (handsErr) throw handsErr;

      if (isMounted.current && request === handsRequestRef.current) {
        setHandsRead({
          tournamentId,
          data: (data || []) as HandHistoryRecord[],
          loading: false,
          error: null,
        });
      }
    } catch (err) {
      if (!isMounted.current || request !== handsRequestRef.current) return;
      reportError(err, 'TournamentResultsPage.loadHandHistory_error');
      setHandsRead({
        tournamentId,
        data: [],
        loading: false,
        error: 'Could Not Load These Hands. Please Retry.',
      });
    }
  };

  useEffect(() => {
    void loadMysteryBounty();
  }, [selectedTournament?.id, selectedTournament?.is_mystery_bounty]);

  useEffect(() => {
    loadHandHistory();
  }, [selectedTournament?.id]);

  // Stagger animation for results
  useEffect(() => {
    if (results.length === 0) return;
    setVisibleResults(new Set());
    const timers = results.map((result, index) =>
      setTimeout(() => {
        setVisibleResults((prev) => new Set(prev).add(result.user_id));
      }, index * 60)
    );
    return () => timers.forEach(clearTimeout);
  }, [results]);

  const formatDuration = (startedAt: string | null, endedAt: string | null) => {
    if (!startedAt || !endedAt) return '-';
    const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hrs}h ${remainMins}m`;
  };

  const getOrdinalPosition = (pos: number | null): string => {
    if (!pos) return '-';
    if (pos === 1) return '1st';
    if (pos === 2) return '2nd';
    if (pos === 3) return '3rd';
    return `${pos}th`;
  };

  /**
   * THE GRID THE SELECTED EVENT PAID ON (2026-09-20), read off the row's own
   * arena embed. `unitAmount` is `formatAmount` at a chip event - the same
   * function, so every chip figure in this record is byte-identical by
   * construction - and whole Diamonds at a Diamond event, where `formatAmount`
   * would print a fraction the payment cannot contain. `unitWord` is the noun
   * that goes beside it.
   */
  const satelliteAwards = useSatelliteAwards(selectedTournament, results, undefined, user?.id);
  const selectedIsSatellite =
    Boolean(selectedTournament?.satellite_target_id || selectedTournament?.satellite_target) ||
    String(selectedTournament?.variant).toLowerCase() === 'satellite' ||
    String(selectedTournament?.tournament_type).toUpperCase() === 'SATELLITE';
  const selectedUnitCents = tournamentRowUnitCents(selectedTournament);
  const selectedUnitSuffix = moneySuffixAtUnit(selectedUnitCents);

  const formatAmount = (n: number) => {
    const truncated = Math.trunc(n * 100) / 100;
    // Show decimals only if there are sub-unit fractions
    if (truncated === Math.trunc(truncated)) {
      return Math.trunc(truncated).toLocaleString('en-US');
    }
    return truncated.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const unitAmount = (n: number) =>
    normalizeUnitCents(selectedUnitCents) === CHIP_UNIT_CENTS
      ? formatAmount(n)
      : formatPrizeAtUnit(n, selectedUnitCents);

  const getVariantLabel = (t: CompletedTournament) => {
    if (t.is_xmtt) return 'XMTT';
    if (t.is_mystery_bounty) return 'Mystery Bounty';
    if (t.is_pko) return 'PKO';
    if (t.is_bounty) return 'Bounty';
    if (t.variant === 'spin') return 'Spin';
    if (t.variant === 'sng') return 'SNG';
    return t.variant === 'freezeout' ? 'Freezeout' : t.variant || 'MTT';
  };

  const getMyResult = (t: CompletedTournament) => {
    if (!user?.id) return null;
    return results.find((r) => r.user_id === user.id && selectedTournament?.id === t.id);
  };

  /** Leaderboard rows by user, so a row lookup is not a linear scan per render. */
  const mysteryBoardByUser = useMemo(() => {
    const m = new Map<string, MysteryBountyLeaderboardRow>();
    for (const row of mysteryBoard) m.set(row.userId, row);
    return m;
  }, [mysteryBoard]);

  /**
   * The finishers, ordered, and who actually took the most money.
   *
   * The rules live in src/utils/tournamentPayout.ts and are pinned by
   * tests/unit/tournamentPayout.test.ts, because section 44 is the one a layout
   * change loses silently: sort or highlight on the placement prize alone and
   * the table names the wrong person as the winner of the night.
   */
  const isQualifier = (r: TournamentResult) => isRecordedSatelliteQualifier(selectedTournament, r);
  const finishers = results.filter((r) => r.position != null || isQualifier(r));
  const sortedResults =
    resultSort === 'finish'
      ? [
          ...finishers.filter(isQualifier),
          ...sortResults(
            finishers.filter((r) => !isQualifier(r)),
            resultSort
          ),
        ]
      : sortResults(finishers, resultSort);
  const topEarner = biggestEarner(finishers);
  const championWasOutEarned = bountyBeatTheChampion(finishers);

  return (
    <div className="tournament-results-page arena-workspace">
      {/* Back sits above the chrome mast (Dan's rule). */}
      <div className="tr-nav arena-switch">
        <button type="button" aria-label="Back" onClick={() => navigate(-1)}>
          ←
        </button>
      </div>

      <ArenaWorkspaceHeader
        area="handreview"
        title="Tournament Archive"
        summary="Inspect Completed Fields, Standings, Total Payouts, Bounty Awards, Spin Outcomes, And Recorded Hands Without Flattening Format-Specific Results."
      />

      {/* Filters */}
      <section className="arena-case arena-ops-case tr-filters-case">
        <div className="arena-switch tr-scope-switch">
          <button
            className={filter === 'all' ? 'active' : undefined}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            className={filter === 'mine' ? 'active' : undefined}
            onClick={() => setFilter('mine')}
          >
            My Results
          </button>
        </div>

        {/* One list, shared with the deep-link validation above - the two
            cannot drift. */}
        <div className="arena-switch tr-type-switch">
          {VALID_TYPE_FILTERS.map((t) => (
            <button
              key={t}
              className={typeFilter === t ? 'active' : undefined}
              onClick={() => setTypeFilter(t)}
            >
              {t === 'all'
                ? 'All Types'
                : t === 'progressive_bounty'
                  ? 'PKO'
                  : t === 'mystery_bounty'
                    ? 'Mystery'
                    : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </section>

      {/* ── BIGGEST HITS (round 11): the wheel's largest completed draws,
          shown only on the Spin view. Horizontal scroll on 375px. ── */}
      {typeFilter === 'spin' && biggestHits.length > 0 && (
        <section className="arena-case arena-ops-case tr-hits-case">
          <h2 className="arena-section-title">Biggest Hits</h2>
          <div className="tr-hits-rail">
            {biggestHits.map((h) => (
              <div
                key={h.tournamentId}
                className="arena-meter tr-hit-card"
                onClick={() => {
                  const t = tournaments.find((x) => x.id === h.tournamentId);
                  if (t) {
                    selectTournament(t);
                    return;
                  }
                  /* A hit older than the list's top 100 is not in
                     `tournaments` - load its row directly, the same shape
                     as the ?id= deep link. Error-bound per the ratchet. */
                  const selectionRequest = ++selectionRequestRef.current;
                  deepLinkedRef.current = true;
                  void (async () => {
                    const { data, error: hitRowErr } = await supabase
                      .from('tournaments')
                      .select(
                        `id, name, variant, tournament_type, game_type, buy_in_amount, buy_in_fee, prize_pool, bounty_pool, current_players, max_players, min_players, table_size, satellite_seats, status, started_at, ended_at, is_xmtt, is_bounty, is_pko, is_mystery_bounty, spin_multiplier, format_contract, satellite_target_id, satellite_target, ${TOURNAMENT_ARENA_EMBED}`
                      )
                      .eq('id', h.tournamentId)
                      .maybeSingle();
                    if (hitRowErr) {
                      reportError(hitRowErr, 'TournamentResultsPage.biggest_hit_open_failed', {
                        tournamentId: h.tournamentId,
                      });
                      return;
                    }
                    if (
                      data &&
                      isMounted.current &&
                      selectionRequest === selectionRequestRef.current
                    ) {
                      setSelectedTournament(data as CompletedTournament);
                    }
                  })();
                }}
              >
                <div className="tr-hit-card__mult">{h.multiplier}x</div>
                <div className="tr-hit-card__winner">{h.winnerName}</div>
                <div className="tr-hit-card__prize">
                  {h.prize === null ? 'Prize Not Confirmed' : `Won ${h.prize.toLocaleString()}`} On
                  A {h.buyIn.toLocaleString()} Spin
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── SPIN LEADERBOARDS (round 15): 7-day volume and net, Spin view
          only. Horses rank alongside humans (CLAUDE.md 10.5). ── */}
      {typeFilter === 'spin' &&
        spinBoards &&
        (spinBoards.mostSpins.length > 0 || spinBoards.bestNet.length > 0) && (
          <section className="arena-case arena-ops-case tr-leaders-case">
            <h2 className="arena-section-title">
              Spin Leaders
              <small>Last 7 Days</small>
            </h2>
            <div className="arena-switch tr-spin-tabs">
              {(['net', 'volume'] as const).map((tab) => (
                <button
                  key={tab}
                  className={spinBoardTab === tab ? 'active' : undefined}
                  onClick={() => setSpinBoardTab(tab)}
                >
                  {tab === 'net' ? 'Best Net' : 'Most Spins'}
                </button>
              ))}
            </div>
            <div className="tr-leaders-list">
              {spinBoardTab === 'net'
                ? spinBoards.bestNet.map((row, i) => (
                    <div
                      key={`net-${row.username}-${i}`}
                      className="arena-ledger-row tr-leader-row"
                    >
                      <span
                        className={
                          i < 3
                            ? 'tr-leader-row__rank tr-leader-row__rank--top'
                            : 'tr-leader-row__rank'
                        }
                      >
                        {i + 1}
                      </span>
                      <span className="tr-leader-row__name">{row.username}</span>
                      <span className="tr-leader-row__spins">
                        {row.spins.toLocaleString()} Spins
                      </span>
                      <span className="tr-leader-row__net">
                        +{Math.round(row.net).toLocaleString()}
                      </span>
                    </div>
                  ))
                : spinBoards.mostSpins.map((row, i) => (
                    <div
                      key={`vol-${row.username}-${i}`}
                      className="arena-ledger-row tr-leader-row"
                    >
                      <span
                        className={
                          i < 3
                            ? 'tr-leader-row__rank tr-leader-row__rank--top'
                            : 'tr-leader-row__rank'
                        }
                      >
                        {i + 1}
                      </span>
                      <span className="tr-leader-row__name">{row.username}</span>
                      <span className="tr-leader-row__vol">{row.spins.toLocaleString()}</span>
                    </div>
                  ))}
            </div>
          </section>
        )}

      {isLoading ? (
        <section className="arena-case arena-ops-case tr-state-case">
          <div className="tr-state-copy">Loading Results...</div>
        </section>
      ) : listError ? (
        <section className="arena-case arena-ops-case tr-state-case">
          <div className="tr-alert" role="alert">
            <span>{listError}</span>
            <div className="arena-switch arena-ops-keys arena-ops-primary">
              <button onClick={() => void loadTournaments()}>Retry Results</button>
            </div>
          </div>
        </section>
      ) : tournaments.length === 0 ? (
        <section className="arena-case arena-ops-case tr-state-case">
          <div className="tr-state-copy">No Completed Tournaments Found</div>
        </section>
      ) : (
        <section className="arena-case arena-ops-case tr-list-case">
          <div className="tr-events-list">
            {tournaments.map((t) => (
              <div
                key={t.id}
                onClick={() => selectTournament(selectedTournament?.id === t.id ? null : t)}
                className={
                  selectedTournament?.id === t.id
                    ? 'arena-ledger-row tr-event tr-event--open'
                    : 'arena-ledger-row tr-event'
                }
              >
                {/* Tournament Header */}
                <div className="tr-event__head">
                  <div className="tr-event__identity">
                    <span className="tr-event__name">{t.name}</span>
                    <div className="tr-event__tags">
                      <span className="tr-tag tr-tag--variant">{getVariantLabel(t)}</span>
                      <span className="tr-tag tr-tag--game">{t.game_type}</span>
                      {t.spin_multiplier && (
                        <span className="tr-tag tr-tag--mult">{t.spin_multiplier}x</span>
                      )}
                    </div>
                  </div>
                  <div className="tr-event__pool-col">
                    <div className="tr-event__pool">
                      {/* The TOTAL prize pool: places plus bounties. `prize_pool`
                          alone is the places pool net of bounty and rake, so a
                          bounty event used to show only part of what it paid. */}
                      {formatAmount(displayTotalPool(t.prize_pool, null, t.bounty_pool))} Prize Pool
                    </div>
                    <div className="tr-event__sub">
                      {t.current_players} Entries · {formatDuration(t.started_at, t.ended_at)}
                    </div>
                  </div>
                </div>

                <div className="tr-event__meta">
                  Buy-In: {formatAmount(t.buy_in_amount)} + {formatAmount(t.buy_in_fee)} · Entries:{' '}
                  {t.current_players} · Duration: {formatDuration(t.started_at, t.ended_at)} ·
                  Ended: {t.ended_at ? new Date(t.ended_at).toLocaleDateString() : '-'}
                </div>

                {selectedTournament?.id === t.id && activeTab === 'standings' && (
                  <div onClick={(event) => event.stopPropagation()}>
                    <TournamentPaymentStatus tournamentId={t.id} />
                  </div>
                )}

                {/* Expanded Results — Tabs */}
                {selectedTournament?.id === t.id && (
                  <div className="tr-event__detail" onClick={(event) => event.stopPropagation()}>
                    {/* Tab Buttons */}
                    <div className="arena-switch tr-detail-tabs">
                      <button
                        className={activeTab === 'standings' ? 'active' : undefined}
                        onClick={() => setActiveTab('standings')}
                      >
                        Standings
                      </button>
                      <button
                        className={activeTab === 'hands' ? 'active' : undefined}
                        onClick={() => setActiveTab('hands')}
                      >
                        Hand History ({handHistory.length})
                      </button>
                    </div>

                    {activeTab === 'standings' &&
                      (resultsRead.tournamentId !== t.id || resultsRead.loading) && (
                        <p className="tr-status-line" role="status">
                          Loading Standings...
                        </p>
                      )}
                    {activeTab === 'standings' &&
                      resultsRead.tournamentId === t.id &&
                      resultsRead.error && (
                        <div className="tr-alert" role="alert">
                          <span>{resultsRead.error}</span>
                          <div className="arena-switch arena-ops-keys arena-ops-primary">
                            <button onClick={() => void loadResults()}>Retry Standings</button>
                          </div>
                        </div>
                      )}
                    {activeTab === 'standings' &&
                      resultsRead.tournamentId === t.id &&
                      !resultsRead.loading &&
                      !resultsRead.error &&
                      results.length === 0 && (
                        <p className="tr-status-line">No Standings Recorded Yet.</p>
                      )}
                    {activeTab === 'standings' &&
                      mysteryRead.tournamentId === t.id &&
                      mysteryRead.error && (
                        <div className="tr-alert" role="alert">
                          <span>{mysteryRead.error}</span>
                          <div className="arena-switch arena-ops-keys arena-ops-primary">
                            <button onClick={() => void loadMysteryBounty()}>
                              Retry Mystery Awards
                            </button>
                          </div>
                        </div>
                      )}
                    {activeTab === 'hands' &&
                      (handsRead.tournamentId !== t.id || handsRead.loading) && (
                        <p className="tr-status-line" role="status">
                          Loading Hands...
                        </p>
                      )}
                    {activeTab === 'hands' &&
                      handsRead.tournamentId === t.id &&
                      handsRead.error && (
                        <div className="tr-alert" role="alert">
                          <span>{handsRead.error}</span>
                          <div className="arena-switch arena-ops-keys arena-ops-primary">
                            <button onClick={() => void loadHandHistory()}>Retry Hands</button>
                          </div>
                        </div>
                      )}

                    {/* Standings Tab */}
                    {activeTab === 'standings' && results.length > 0 && (
                      <div className="tr-standings-head">
                        <div className="tr-standings-head__label">Final Standings</div>
                        {/* Sections 42 and 44: the money order is a real view,
                              not a footnote, because in a bounty event it is
                              frequently not the same order as the finish. */}
                        <div className="arena-switch tr-sort-tabs">
                          {(['finish', 'total'] as ResultSort[]).map((s) => (
                            <button
                              key={s}
                              className={resultSort === s ? 'active' : undefined}
                              onClick={() => setResultSort(s)}
                            >
                              {s === 'finish' ? 'By Finish' : 'By Total Payout'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Section 44: say it out loud when the champion was not the
                          biggest earner, rather than leaving a reader to notice. */}
                    {activeTab === 'standings' && championWasOutEarned && topEarner && (
                      <div className="tr-callout">
                        Biggest Total Payout: {topEarner.username} (
                        {getOrdinalPosition(topEarner.position)}) With{' '}
                        {selectedIsSatellite
                          ? satelliteAwardTotalLabel(
                              satelliteAwards.kindFor(topEarner.user_id, topEarner.prize),
                              topEarner.prize,
                              topEarner.bounty_winnings,
                              unitAmount
                            )
                          : `${unitAmount(totalPayout(topEarner))}${selectedUnitSuffix}`}
                        , More Than The Champion
                      </div>
                    )}
                    {selectedIsSatellite && satelliteAwardNotice(satelliteAwards, results) && (
                      <p className="tr-status-line" role="status">
                        {satelliteAwardNotice(satelliteAwards, results)}
                      </p>
                    )}
                    {/* Column key. Kept above the rows because every row is a
                          four-number line and a phone has no room for headers on
                          each one. */}
                    {activeTab === 'standings' && results.length > 0 && (
                      <div className="tr-standings-cols">
                        <span>Finish And Player</span>
                        <span className="tr-col-num">
                          {selectedIsSatellite ? 'Award' : 'Prize'}
                        </span>
                        <span className="tr-col-num">KOs</span>
                        <span className="tr-col-num">Bounty</span>
                        <span className="tr-col-num">Total</span>
                      </div>
                    )}
                    {activeTab === 'standings' && (
                      <div className="tr-standings-rows">
                        {sortedResults.map((r) => {
                          const isMe = r.user_id === user?.id;
                          const posClass =
                            r.position === 1
                              ? 'tr-standing__pos tr-standing__pos--first'
                              : r.position === 2
                                ? 'tr-standing__pos tr-standing__pos--second'
                                : r.position === 3
                                  ? 'tr-standing__pos tr-standing__pos--third'
                                  : 'tr-standing__pos';
                          const total = totalPayout(r);
                          /* The server's own aggregate first (section 69);
                                 the award-derived totals supply the one thing it
                                 cannot know, the LARGEST single chest. */
                          const awardTotals = mysteryTotals.get(r.user_id);
                          const boardRow = mysteryBoardByUser.get(r.user_id);
                          const mysteryCount =
                            boardRow?.bountiesWon ?? awardTotals?.bountiesWon ?? 0;
                          const mysteryCents =
                            boardRow?.earningsCents ?? awardTotals?.earningsCents ?? 0;
                          const mysteryLargest = awardTotals?.largestCents ?? 0;
                          const isTopEarner =
                            !!topEarner && topEarner.user_id === r.user_id && total > 0;
                          const rowClass = [
                            'tr-standing-row',
                            isMe ? 'tr-standing-row--me' : '',
                            !isMe && isTopEarner ? 'tr-standing-row--top' : '',
                            visibleResults.has(r.user_id)
                              ? 'tr-standing-row--visible'
                              : 'tr-standing-row--pending',
                          ]
                            .filter(Boolean)
                            .join(' ');
                          return (
                            <div key={r.user_id} className={rowClass}>
                              <div className="tr-standing__player">
                                <div className="tr-standing__player-line">
                                  <span className={posClass}>
                                    {isQualifier(r) ? 'Qualified' : getOrdinalPosition(r.position)}
                                  </span>
                                  <span
                                    className={
                                      isMe
                                        ? 'tr-standing__name tr-standing__name--me'
                                        : 'tr-standing__name'
                                    }
                                  >
                                    {r.username}
                                    {isMe && <span className="tr-standing__you">(You)</span>}
                                  </span>
                                </div>
                                {/* Section 37: the MYSTERY share of the bounty
                                        column, broken out where there is one. The
                                        rest of the bounty column is the flat
                                        bounty paid before the chests opened. */}
                                {mysteryCents > 0 && (
                                  <div className="tr-standing__mystery">
                                    {mysteryCount.toLocaleString('en-US')} Mystery (
                                    {formatCents(mysteryCents, selectedUnitCents)}), Largest{' '}
                                    {formatCents(mysteryLargest, selectedUnitCents)}
                                  </div>
                                )}
                              </div>
                              <span
                                className={
                                  r.prize > 0
                                    ? 'tr-col-num tr-standing__prize--paid'
                                    : 'tr-col-num tr-standing__zero'
                                }
                              >
                                {r.prize > 0
                                  ? selectedIsSatellite
                                    ? satelliteAwardLabel(
                                        satelliteAwards.kindFor(r.user_id, r.prize),
                                        unitAmount(r.prize)
                                      )
                                    : unitAmount(r.prize)
                                  : '-'}
                              </span>
                              <span
                                className={
                                  r.bounties_collected > 0
                                    ? 'tr-col-num tr-standing__kos'
                                    : 'tr-col-num tr-standing__zero'
                                }
                              >
                                {r.bounties_collected > 0
                                  ? r.bounties_collected.toLocaleString('en-US')
                                  : '-'}
                              </span>
                              <span
                                className={
                                  r.bounty_winnings > 0
                                    ? 'tr-col-num tr-standing__bounty--paid'
                                    : 'tr-col-num tr-standing__zero'
                                }
                              >
                                {r.bounty_winnings > 0 ? unitAmount(r.bounty_winnings) : '-'}
                              </span>
                              <span
                                className={
                                  total > 0
                                    ? 'tr-col-num tr-standing__total--paid'
                                    : 'tr-col-num tr-standing__zero'
                                }
                              >
                                {total > 0
                                  ? selectedIsSatellite
                                    ? satelliteAwardTotalLabel(
                                        satelliteAwards.kindFor(r.user_id, r.prize),
                                        r.prize,
                                        r.bounty_winnings,
                                        unitAmount
                                      )
                                    : unitAmount(total)
                                  : '-'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Hand History Tab */}
                    {activeTab === 'hands' &&
                      handsRead.tournamentId === t.id &&
                      !handsRead.loading &&
                      !handsRead.error && (
                        <div className="tr-hands-list">
                          {handHistory.length === 0 ? (
                            <div className="tr-state-copy">No Hands Recorded</div>
                          ) : (
                            handHistory.map((hand) => (
                              <div key={hand.id} className="arena-ledger-row tr-hand-row">
                                <div className="tr-hand-row__head">
                                  <span className="tr-hand-row__num">Hand #{hand.hand_number}</span>
                                  <span className="tr-hand-row__time">
                                    {new Date(hand.created_at).toLocaleTimeString()}
                                  </span>
                                </div>
                                <div className="tr-hand-row__meta">
                                  {hand.game_variant} · {hand.small_blind}/{hand.big_blind} · Pot:{' '}
                                  {formatAmount(hand.pot_size)}
                                </div>
                                {hand.winners.length > 0 && (
                                  <div className="tr-hand-row__winners">
                                    Winners: {hand.winners.map((w) => w.amount).join(', ')}
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
