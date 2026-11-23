/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SERVER TABLE ENGINE — Server-Side Dealer for a Single Table
 * ═══════════════════════════════════════════════════════════════════════════════
 * Runs the complete dealing pipeline for one table on the SERVER.
 * NO browser. NO React. NO window. Pure Node.js.
 *
 * - Loads table config, seated players, and horses from Supabase
 * - Manages HandController lifecycle
 * - Executes horse AI decisions with millisecond-level think times
 * - Auto-rebuys busted horses from Player Wallet
 * - Broadcasts hand state via Supabase Realtime
 * - Multiple instances run simultaneously (one per table)
 */

/**
 * ServerTableEngine, layer 8/8 — state broadcast and public state snapshots.
 *
 * Split out of the 5,623-line `src/engine/ServerTableEngine.ts` monolith on
 * 2026-08-08 (every deploy tool in this pipeline caps a single file at ~50 KB).
 * Behavior is preserved line-for-line: the only edits are module boundaries,
 * `private` widened to `protected` across the split, and `abstract`
 * declarations for the hooks each layer calls on the layer below.
 */

import * as EngineMetrics from '../observability/engineInstruments.js';
import { reportError } from '../services/errorReporter.js';
import { ServerTableEngineHandEvents } from './ServerTableEngineHandEvents.js';
import {
  bettingStructureFor,
  fixedLimitBetSize,
  fixedLimitStreetBounds,
  potLimitBettingPot,
  isFixedLimitCapped,
} from './BettingStructure.js';
import type { GameState, SeatedPlayer } from '../types.js';
import { loadSeatedPlayers, loadSeatHoldIdentity } from '../services/supabase.js';
import type { SeatArrival } from './SeatArrivalDisplay.js';
import { noteCashSeatCommitted } from '../cluster/cashSeatCommittedSignal.js';
import {
  projectLiveHandState,
  projectResyncHandState,
  type PostedBlindSeats,
} from './presentation/projectHandState.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER TABLE ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

export class ServerTableEngine extends ServerTableEngineHandEvents {
  /*
   * THE HEAD ON EVERY SEAT (Dan 2026-11-05: "the number on the screen above
   * their head didn't update"). In a bounty event each seat's bounty used to
   * reach the felt only through a separate realtime channel, which dropped
   * six times for one player in one evening. The heads now ride the same
   * table state as the chips. One writer: the tournament manager, which reads
   * them from tournament_players.current_bounty after every knockout and every
   * hand. A user with no ledger head publishes no field, never a guess.
   */
  private seatBounties: ReadonlyMap<string, number> | null = null;

  /** The tournament manager's ledger heads for this event, or null off a bounty event. */
  public setSeatBounties(heads: ReadonlyMap<string, number> | null): void {
    const previous = this.seatBounties;
    this.seatBounties = heads;
    if (!this.tableInfo) return;
    const changed = (this.seatedPlayers ?? []).some(
      (seated) => previous?.get(seated.user_id) !== heads?.get(seated.user_id)
    );
    if (!changed) return;
    this.broadcastCurrentState().catch((err) =>
      reportError(err, 'ServerTableEngine.' + this.tableId + '.seat_bounty_broadcast_failed')
    );
  }

  /**
   * ROLLING HANDOFF (2026-11-19, docs/ENGINE-ROLLING-HANDOFF.md): what must be
   * identical after this table moves to another engine instance. Read by the
   * yielding instance at a parked hand boundary and by the adopting instance
   * before it lets the table deal. A pure read: it changes nothing, and no
   * existing path calls it, so with ENGINE_ROLLING_HANDOFF off it never runs.
   */
  public describeHandoffBoundary(): {
    seats: Array<{ seat: number; userId: string; stack: number }>;
    lightning: boolean;
  } {
    return {
      seats: (this.seatedPlayers ?? [])
        .map((p) => ({
          seat: Number(p.seat_number),
          userId: String(p.user_id),
          stack: Number(p.stack),
        }))
        .sort((a, b) => a.seat - b.seat),
      lightning: this.clusterLightningEnabled === true,
    };
  }

  /** `{ bounty }` from the ledger heads, or nothing when this seat has none. */
  protected seatBountyFields(userId: string): { bounty?: number } {
    const head = this.seatBounties?.get(userId);
    return typeof head === 'number' && Number.isFinite(head) && head >= 0 ? { bounty: head } : {};
  }

  /**
   * Occupancy is not hand participation. Cash entrants waiting for the blind
   * and players sitting out still own their seats. Live/resync hand projections
   * omit them, whereas idle state includes them; publishing those alternately
   * made their avatars flash in and out on every hand (utg777, 2026-11-06).
   * Append only the current physical roster's nonparticipants. Never modify
   * the hand, its chips, cards, positions, actor or pot eligibility.
   */
  private includeOccupiedSeats(payload: Record<string, any>): Record<string, any> {
    const players = [...payload.players];
    const userIds = new Set(players.map((p) => p.user_id));
    const seats = new Set(players.map((p) => p.seat));
    for (const p of this.seatedPlayers ?? []) {
      // The hand owns its players until settlement, including a pending exit.
      if (userIds.has(p.user_id) || seats.has(p.seat_number)) continue;
      // A committed tournament arrival owns the chair of a rostered
      // nonparticipant the database has already replaced.
      if (this.committedArrivalReplaces(p)) continue;
      players.push({
        seat: p.seat_number,
        user_id: p.user_id,
        ...this.seatIdentity(p),
        ...this.seatBountyFields(p.user_id),
        stack: this.shownSeatStack(p),
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        // Not dealt in. Waiting/posting lists refine the existing seat badge.
        is_sitting_out: true,
        is_disconnected: !this.disconnectEngine.isConnected(this.tableId, p.user_id),
        time_bank_remaining: this.timeBankEngine.getRemainingSeconds(this.tableId, p.user_id),
        time_bank_uses_remaining: this.timeBankEngine.getUsesRemaining(this.tableId, p.user_id),
        position: '',
        is_waiting_for_button: this.waitingForButton.get(p.seat_number) === p.user_id,
        is_waiting_for_bb: this.waitingForBB.has(p.user_id),
        hand_name: '',
        ...this.chipContinuity.seatFields(p.user_id, p.stack),
      });
      userIds.add(p.user_id);
      seats.add(p.seat_number);
    }
    return {
      ...payload,
      players: this.withSeatArrivals(players),
      waiting_for_bb_user_ids: Array.from(this.waitingForBB),
      post_bb_deferred_user_ids: Array.from(this.postBBWhenClear),
      posting_bb_user_ids: Array.from(this.postingBBToEnter),
    };
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // Bible V8 §6.15: OBSERVER PERMISSIONS
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * GET /state/:tableId for observers — Bible V8 §6.15: Scrubbed state with no hole cards.
   * Observers see community cards, pot, actions, but NEVER other players' hole cards.
   */
  public getObserverState(): Record<string, any> | null {
    if (!this.handController || !this.tableInfo) return null;
    const state = this.publishedHandState();
    if (!state) return null;
    const showCards = this.tableInfo.observer_show_cards ?? false;
    return this.includeOccupiedSeats({
      table_id: this.tableId,
      hand_number: this.handCount,
      ...this.handBlindSnapshotFields(),
      pot: state.pot ?? 0,
      community_cards: state.communityCards ?? [],
      community_cards2: state.communityCards2 ?? [],
      current_bet: state.currentBet ?? 0,
      stage: state.stage ?? 'preflop',
      dealer_seat: state.dealerSeat ?? this.currentHandDealerSeat,
      players: state.players.map((p) => ({
        seat: p.seat,
        user_id: p.user_id,
        ...this.seatIdentity(p),
        ...this.seatBountyFields(p.user_id),
        stack: p.stack,
        bet: p.bet,
        is_folded: p.is_folded,
        is_all_in: p.is_all_in,
        position: p.position,
        // Bible V8 §6.15: Only show cards if table allows AND it's showdown
        // SHOWDOWN SYSTEM 2026-08-25: mucked hands stay private from
        // observers too — same gate as the player-facing surfaces.
        cards:
          showCards &&
          // Tabled hands during an all-in runout are public too (2026-09-04).
          (state.stage === 'showdown' || this.runoutRevealActive) &&
          !p.is_folded &&
          !this.isMuckedAtShowdown(p.user_id)
            ? p.cards
            : [],
      })),
      is_observer: true,
      admin_paused: this.adminPauseLock,
      maintenance_lock: this.maintenanceLock,
    });
  }

  /**
   * The betting-structure fields every broadcast carries (2026-08-23).
   *
   * The client used to decide this for itself with
   * `gameType.startsWith('plo')`, which treats everything that is not PLO as
   * no-limit — so a fixed-limit table would have rendered a no-limit bet slider
   * and had every drag rejected by the server. And `wagers_capped` is not
   * derivable client-side at all: the cap counts FULL raises, and
   * `action_history` is broadcast with its `isFullRaise` flag stripped.
   *
   * No-limit and pot-limit tables carry `fixed_bet_size`/`wagers_capped` as
   * undefined, which JSON drops.
   */

  /**
   * ── ANONYMOUS TABLE (Dan 2026-08-25) ────────────────────────────────────
   *
   * `is_anonymous` has been a toggle on the creation screen since February,
   * read by nothing. Seat names shipped as real usernames with no branch that
   * could hide them.
   *
   * The identity a seat carries is exactly two fields: `username` and
   * `avatar_url`. `user_id` MUST survive — the client keys the hero seat,
   * `current_player`, `winner_ids`, `disconnect_states` and
   * `waiting_for_bb_user_ids` off it, and scrubbing it would break the table
   * rather than anonymise it. A user id is not a name on screen.
   *
   * UNIFORM, not per-viewer, and that is deliberate: broadcastCurrentState
   * publishes ONE payload through TableStateHub to every subscriber
   * ("public-scrubbed shape - so there is nothing per-subscriber to
   * serialize"). Making the hero an exception would mean a payload per seat.
   * At an anonymous table nobody's name is shown, including your own, and you
   * find yourself by seat exactly as you would at a live table.
   *
   * Called by all FOUR serializers. They are byte-identical seat maps and the
   * file already carries a comment about a reveal gate that was missed in one
   * of them; one helper is what stops that happening again.
   */
  protected seatIdentity(p: {
    seat?: number;
    seat_number?: number;
    username?: string;
    avatar_url?: string;
    equipped_frame?: string;
    equipped_aura?: string;
  }): {
    username: string;
    avatar_url: string;
    equipped_frame: string;
    equipped_aura: string;
  } {
    /* COSMETICS ARE IDENTITY (2026-08-25). The equipped frame and aura are
       returned here rather than beside the call sites precisely because of the
       anonymous-table rule above: they are worn ON the avatar, they are rare,
       and they are stable across sessions. A table where every name reads
       "Player 4" but exactly one seat burns with `frame-hellfire` every night
       is not anonymous - it has one anonymous player and one signature. They
       are scrubbed with the name and the picture, on the same branch, so a
       future field cannot be added to one and forgotten in the other. */
    if (!this.tableInfo?.is_anonymous) {
      return {
        username: p.username ?? '',
        avatar_url: p.avatar_url ?? '',
        equipped_frame: p.equipped_frame ?? '',
        equipped_aura: p.equipped_aura ?? '',
      };
    }
    const seat = p.seat ?? p.seat_number ?? 0;
    return {
      username: seat > 0 ? `Player ${seat}` : 'Player',
      avatar_url: '',
      equipped_frame: '',
      equipped_aura: '',
    };
  }

  /** Frozen dealt stakes, never the tournament's asynchronously updated next level. */
  private handBlindSnapshotFields(): Record<string, unknown> {
    // Between hands, table metadata is sufficient. An active modern hand that cannot
    // prove its denomination must send null: omission means legacy support to
    // the client and would substitute the tournament's next level mid-hand.
    if (!this.handController) return {};
    const blinds = this.handController.getBlindSnapshot?.();
    const handNumber = this.handController?.getHandNumber?.();
    if (
      !blinds ||
      !Number.isSafeInteger(handNumber) ||
      !(handNumber && handNumber > 0) ||
      handNumber !== this.handCount ||
      !Number.isFinite(blinds.smallBlind) ||
      blinds.smallBlind < 0 ||
      !Number.isFinite(blinds.bigBlind) ||
      blinds.bigBlind <= 0 ||
      blinds.smallBlind > blinds.bigBlind
    )
      return { hand_blinds: null };
    return {
      hand_blinds: {
        table_id: this.tableId,
        hand_number: handNumber,
        small_blind: blinds.smallBlind,
        big_blind: blinds.bigBlind,
      },
    };
  }

  /**
   * The table's regular ante, for the felt. `ante` is the per-posting amount
   * in chips (0 = none); `ante_mode` says who posts it - every seat, or the
   * big blind once for the table.
   */
  private anteSnapshotFields(): { ante: number; ante_mode: 'per_player' | 'big_blind' | null } {
    const info = this.tableInfo;
    if (!info) return { ante: 0, ante_mode: null };
    const on = info.tournament_id ? true : (info.ante_enabled ?? true);
    const ante = on ? Number(info.ante ?? 0) : 0;
    if (!(ante > 0)) return { ante: 0, ante_mode: null };
    return { ante, ante_mode: info.big_blind_ante_enabled === true ? 'big_blind' : 'per_player' };
  }

  private bettingStructureFields(state: GameState): {
    betting_structure: 'no_limit' | 'pot_limit' | 'fixed_limit';
    pot_limit_pot?: number;
    fixed_bet_size?: number;
    fixed_raise_size?: number;
    wagers_capped?: boolean;
  } {
    // VARIANT OVERRIDE 2026-08-28: the LIVE hand's variant, not the table's —
    // a PLO bomb hand at an NLH table must publish pot_limit or the client
    // draws a no-limit slider and has every drag rejected.
    const variant = this.activeHandVariant();
    const structure = bettingStructureFor(variant);
    if (structure === 'pot_limit') {
      return { betting_structure: structure, pot_limit_pot: potLimitBettingPot(state) };
    }
    if (structure !== 'fixed_limit') return { betting_structure: structure };
    const stage = state.stage ?? 'preflop';
    // KILL POT (kill-v1): the HAND's effective small bet, never the table
    // row's big blind - on a kill hand those differ, and the client must draw
    // the same bet the controller will accept.
    const streetBet = fixedLimitBetSize(
      this.handController?.getFixedLimitSmallBet?.() ?? this.tableInfo?.big_blind ?? 2,
      stage
    );
    return {
      betting_structure: structure,
      fixed_bet_size: streetBet,
      fixed_raise_size: fixedLimitStreetBounds(
        state.actionHistory ?? [],
        stage,
        streetBet,
        state.currentBet
      ).raiseSize,
      wagers_capped: isFixedLimitCapped(state.actionHistory ?? [], stage, streetBet),
    };
  }

  /**
   * GET /state/:tableId — Bible V8 §2.4: Get current hand state (scrubbed for requesting player)
   */
  /**
   * The discard clock, as the engine knows it (2026-08-31).
   *
   * `discard_deadlines` is keyed by user_id so a client picks out its OWN
   * deadline; `discard_deadline_ms` is the unextended round deadline, which is
   * what a spectator or a seat that has already discarded should see. Both are
   * absolute epoch ms and both are null outside the round, so a client can
   * never keep counting down a clock that has stopped.
   *
   * Deadlines are not secret - they are on everybody's screen already - so
   * publishing the map on the shared broadcast leaks nothing.
   */
  protected pineappleDiscardSnapshotFields(): Record<string, unknown> {
    if (
      this.pineappleDiscardBaseDeadlineMs === null ||
      this.handController?.getState().stage !== 'pineapple_discard'
    ) {
      return { discard_deadline_ms: null, discard_deadlines: {}, discard_duration_ms: 0 };
    }
    /* Never announce a deadline for a seat that has already settled its round.
       A horse discards through performDiscard and an all-in seat through
       resolvePendingPineappleDiscards, so the map is reconciled here too. */
    this.pruneSettledPineappleDeadlines();
    const byUser: Record<string, number> = {};
    if (this.pineappleDiscardDeadlines.size > 0) {
      const userIdBySeat = new Map<number, string>();
      for (const sp of this.seatedPlayers) {
        if (!userIdBySeat.has(sp.seat_number)) {
          userIdBySeat.set(sp.seat_number, sp.user_id);
        }
      }
      for (const [seat, at] of this.pineappleDiscardDeadlines) {
        const userId = userIdBySeat.get(seat);
        if (userId !== undefined) byUser[userId] = at;
      }
    }
    return {
      discard_deadline_ms: this.pineappleDiscardBaseDeadlineMs,
      discard_deadlines: byUser,
      discard_duration_ms: this.pineappleDiscardDurationMs,
    };
  }

  /**
   * CHIP CONTINUITY: the stack the stay clock is judged on. Between hands the
   * roster and the hand agree; mid-hand the hand's copy is net of the current
   * bets, which would flip `leave_locked` off every time the hero opened for
   * more than their profit. The roster stack is what the seat holds.
   */
  private continuityStackLookup: Map<string, number> | null = null;

  private continuityStack(userId: string, fallback: number): number {
    if (this.continuityStackLookup !== null) {
      return this.continuityStackLookup.get(userId) ?? fallback;
    }
    const seated = this.seatedPlayers.find((sp) => sp.user_id === userId);
    return seated ? seated.stack : fallback;
  }

  /**
   * Pre-index roster stacks by user_id once per broadcast/resync projection so
   * per-seat chip-continuity checks are O(1) instead of scanning seatedPlayers
   * on every seat. Preserves first-match semantics of Array.prototype.find.
   */
  private rosterStackByUserMap(): Map<string, number> {
    const map = new Map<string, number>();
    for (const sp of this.seatedPlayers) {
      if (!map.has(sp.user_id)) {
        map.set(sp.user_id, sp.stack);
      }
    }
    return map;
  }

  /**
   * The seats the current hand posted its blinds from, for the position badges
   * (positionLabelsFor labels a dead-button hand from them). Null when there is
   * no hand, or the controller cannot say: the labels then walk from the button.
   */
  private postedBlindSeatsForLabels(): PostedBlindSeats | null {
    const hc = this.handController as
      | { getBlindSeatsSnapshot?: () => PostedBlindSeats | null }
      | null
      | undefined;
    return typeof hc?.getBlindSeatsSnapshot === 'function' ? hc.getBlindSeatsSnapshot() : null;
  }

  public getTableState(requestingUserId: string): Record<string, any> | null {
    if (!this.handController || !this.tableInfo) return null;

    const state = this.publishedHandState();
    if (!state) return null;
    /* THE PROJECTION IS SHARED (Lightning Phase 6, 2026-09-27). The payload is
       built by projectResyncHandState, the same pure function a Lightning hand
       host publishes through, so the two dealers cannot drift apart. Every
       fact below is this engine's and is read exactly where it always was; the
       reveal gates (the requester's own cards, the showdown / all-in runout
       rule with the muck, the per-card show once the hand is over) live in
       src/engine/presentation/projectHandState.ts. */
    const ctx: Parameters<typeof projectResyncHandState>[1] = {
      table_id: this.tableId,
      hand_number: this.handCount,
      dealerSeatFallback: this.currentHandDealerSeat,
      blindSeats: this.postedBlindSeatsForLabels(),
      // VARIANT OVERRIDE 2026-08-28 (spec §10.1): what game THIS hand is.
      hand_variant: this.activeHandVariant(),
      // Bomb pot countdown, kill pots, and THE REGULAR ANTE (Dan 2026-09-04).
      boardExtras: {
        ...this.bombPotSnapshotFields(),
        ...this.killPotSnapshotFields(),
        ...this.anteSnapshotFields(),
        ...this.handBlindSnapshotFields(),
      },
      bettingStructure: this.bettingStructureFields(state),
      action_context: this.publishedActionContext(),
      turn_start_time_ms: this.playerTurnStartTime,
      turnDurationSeconds: this.playerTurnDuration,
      // Dan 2026-08-18: the server's own "now", so the client can subtract its skew.
      server_time_ms: Date.now(),
      pineappleFields: this.pineappleDiscardSnapshotFields(),
      /* THE THIRD PAYLOAD, AND THE ONE THAT MATTERS MOST (2026-08-31 audit):
         the resync must say how wide the table is, from the table row. */
      max_seats: Number(this.tableInfo?.max_players) || 0,
      is_anonymous: this.tableInfo?.is_anonymous === true,
      seats: {
        seatIdentity: (p) => ({ ...this.seatIdentity(p) }),
        seatBounty: (p) => this.seatBountyFields(p.user_id),
        /* THE ENGINE, NOT THE ROSTER (2026-08-28): the hand roster's copy of
           is_sitting_out is deliberately always false. */
        seatPresence: (p) => ({
          is_sitting_out: this.disconnectEngine.isSittingOut(this.tableId, p.user_id),
          is_disconnected: !this.disconnectEngine.isConnected(this.tableId, p.user_id),
          time_bank_remaining: this.timeBankEngine.getRemainingSeconds(this.tableId, p.user_id),
          time_bank_uses_remaining: this.timeBankEngine.getUsesRemaining(this.tableId, p.user_id),
        }),
        // CHIP CONTINUITY: the stay clock, judged on the ROSTER stack.
        seatContinuity: (p) => ({
          ...this.chipContinuity.seatFields(p.user_id, this.continuityStack(p.user_id, p.stack)),
        }),
      },
      reveal: {
        runoutRevealActive: this.runoutRevealActive,
        isMuckedAtShowdown: (userId) => this.isMuckedAtShowdown(userId),
        showHandCards: this.showHandCards,
        handHasWinners: this.currentHandWinnerIds.length > 0,
      },
    };
    this.continuityStackLookup = this.rosterStackByUserMap();
    try {
      return this.includeOccupiedSeats(projectResyncHandState(state, ctx, requestingUserId));
    } finally {
      this.continuityStackLookup = null;
    }
  }

  /**
   * Broadcast current hand state to all table viewers.
   * FIX-217: Now returns Promise so critical paths can await delivery.
   * Bible V8 §1.2.3: "Broadcast must confirm before next turn begins"
   */
  protected broadcastCurrentState(): Promise<void> {
    if (!this.tableInfo) return Promise.resolve();
    // IDLE BROADCAST (2026-08-22): this used to hard-return when
    // handController was null — which made the "clean state" publish at the
    // end of every hand a silent no-op, and meant an idle table (waiting for
    // players, between hands after a restart) never published ANY snapshot:
    // a client joining such a table connected successfully and then stared at
    // a spinner because no SNAPSHOT ever arrived. Publish a real idle payload
    // instead: seats from seatedPlayers, no board, no clock, stage 'waiting'
    // (a first-class stage in the client contract - mapEngineSnapshot).
    if (!this.handController) {
      // Phase 1 (2026-09-04), measured on production: the first 33 human
      // samples included four over 5 s. They were not slow broadcasts - they
      // were the LAST action of a hand: the hand ended, this branch published
      // idle without observing, the clock stayed armed, and the next hand's
      // first broadcast observed the whole gap between hands. That is not
      // act-to-broadcast latency. Disarm the clock here; the sample is void.
      this.lastActionAcceptedAtMs = 0;
      this.publishIdleState();
      return Promise.resolve();
    }

    // ── ADDITIVE observability (#5): observe action→broadcast latency (cheap, always) ──
    if (this.lastActionAcceptedAtMs > 0) {
      try {
        const actMs = Date.now() - this.lastActionAcceptedAtMs;
        EngineMetrics.actToBroadcastLatency.observe(actMs, {
          table_id: this.tableId,
        });
        // Phase 1 (2026-09-04): the always-on, low-cardinality twin. The
        // per-table series above is gated off in production; this one is
        // what the ActionLatency alerts read.
        EngineMetrics.actToBroadcastFleet.observe(actMs, {
          audience: this.humansSeated() > 0 ? 'human' : 'horse',
          format: this.tableFormat(),
        });
      } catch {
        /* metrics must never affect gameplay */
      }
      this.lastActionAcceptedAtMs = 0;
    }

    const state = this.publishedHandState();
    if (!state) return Promise.resolve();
    this.continuityStackLookup = this.rosterStackByUserMap();

    // Phase 1.1 PR-2: Build the payload once and publish it to the
    // authoritative WebSocket hub. Lightning Phase 6 (2026-09-27): built by
    // projectLiveHandState, the one projection both dealers share
    // (src/engine/presentation/projectHandState.ts). ONE payload for every
    // subscriber, so it carries no hole card before showdown.
    let payload: Record<string, unknown>;
    try {
      payload = projectLiveHandState(state, {
        table_id: this.tableId,
        hand_number: this.handCount,
        dealerSeatFallback: this.currentHandDealerSeat,
        blindSeats: this.postedBlindSeatsForLabels(),
        hand_variant: this.activeHandVariant(),
        boardExtras: {
          ...this.bombPotSnapshotFields(),
          ...this.killPotSnapshotFields(),
          ...this.anteSnapshotFields(),
          ...this.handBlindSnapshotFields(),
        },
        winnerIds: this.currentHandWinnerIds,
        winners: this.currentHandWinners,
        bettingStructure: this.bettingStructureFields(state),
        action_context: this.publishedActionContext(true),
        turn_start_time_ms: this.playerTurnStartTime,
        turnDurationSeconds: this.playerTurnDuration,
        server_time_ms: Date.now(),
        pineappleFields: this.pineappleDiscardSnapshotFields(),
        time_bank_active: this.timeBankActivatedThisTurn,
        disconnect_states: this.disconnectEngine.getFsmStatesForTable(this.tableId),
        /* HOW MANY SEATS THIS TABLE HAS — FROM THE ONLY PARTY THAT KNOWS
           (Dan 2026-08-31, phase 1 of the seat-truth contract): the table row,
           never the roster. */
        max_seats: Number(this.tableInfo?.max_players) || 0,
        is_anonymous: this.tableInfo?.is_anonymous === true,
        waitingForBB: this.waitingForBB,
        postBBWhenClear: this.postBBWhenClear,
        postingBBToEnter: this.postingBBToEnter,
        showdownResults: this.currentHandShowdownResults,
        seats: {
          seatIdentity: (p) => ({ ...this.seatIdentity(p) }),
          seatBounty: (p) => this.seatBountyFields(p.user_id),
          /* THE ENGINE, NOT THE ROSTER (2026-08-28): the hand roster's copy of
             is_sitting_out is deliberately always false. */
          seatPresence: (p) => ({
            is_sitting_out: this.disconnectEngine.isSittingOut(this.tableId, p.user_id),
            is_disconnected: !this.disconnectEngine.isConnected(this.tableId, p.user_id),
            time_bank_remaining: this.timeBankEngine.getRemainingSeconds(this.tableId, p.user_id),
            time_bank_uses_remaining: this.timeBankEngine.getUsesRemaining(this.tableId, p.user_id),
          }),
          // CHIP CONTINUITY: the stay clock, judged on the ROSTER stack.
          seatContinuity: (p) => ({
            ...this.chipContinuity.seatFields(p.user_id, this.continuityStack(p.user_id, p.stack)),
          }),
        },
        reveal: {
          runoutRevealActive: this.runoutRevealActive,
          isMuckedAtShowdown: (userId) => this.isMuckedAtShowdown(userId),
          showHandCards: this.showHandCards,
          handHasWinners: this.currentHandWinnerIds.length > 0,
        },
      });
    } finally {
      this.continuityStackLookup = null;
    }

    // Phase 1.1 PR-5: Publish ONLY to the authoritative WebSocket hub.
    // The legacy Supabase Realtime broadcast path has been deleted.
    // All game-state delivery now flows through the native WS hub.
    if (this.hub) {
      this.hub.publish(this.tableId, this.includeOccupiedSeats(payload));
    } else {
      console.warn(
        `[ServerTableEngine:${this.tableId}] No hub attached - state not delivered to clients`
      );
    }
    return Promise.resolve();
  }

  /**
   * IDLE BROADCAST (2026-08-22): the between-hands / no-hand snapshot.
   * Field-for-field the same contract as the live payload with idle values,
   * so mapEngineSnapshot needs no special casing beyond its existing
   * 'waiting' stage handling.
   */
  protected publishIdleState(): void {
    if (!this.hub || !this.tableInfo) return;
    const payload = {
      table_id: this.tableId,
      hand_number: this.handCount,
      pot: 0,
      community_cards: [],
      community_cards2: [],
      community_cards3: [],
      hand_variant: this.activeHandVariant(),
      ...this.bombPotSnapshotFields(),
      // KILL POTS (kill-v1): this hand's kill and the next hand's pending kill.
      ...this.killPotSnapshotFields(),
      ...this.anteSnapshotFields(),
      ...this.handBlindSnapshotFields(),
      current_bet: 0,
      current_player: null,
      dealer_seat: this.currentHandDealerSeat,
      stage: 'waiting',
      winner_ids: [],
      winners: [],
      min_raise: 0,
      last_raise: 0,
      turn_start_time_ms: 0,
      turn_duration_ms: 0,
      server_time_ms: Date.now(),
      turn_deadline_ms: 0,
      /* Explicit, not omitted: an idle snapshot must actively CLEAR the discard
         clock. Leaving the key out would let the client hold the last live
         deadline and keep a dead countdown on the felt between hands. */
      discard_deadline_ms: null,
      discard_deadlines: {},
      discard_duration_ms: 0,
      time_bank_active: false,
      disconnect_states: this.disconnectEngine.getFsmStatesForTable(this.tableId),
      /* HOW MANY SEATS THIS TABLE HAS — FROM THE ONLY PARTY THAT KNOWS
         (Dan 2026-08-31, phase 1 of the seat-truth contract).

         The client used to GUESS. `tableState.maxPlayers` is seeded to 6 and
         corrected only when its own `tables` row query lands, so for the first
         seconds of every mount — and indefinitely if that query failed or was
         RLS denied — a 9-max table was drawn as a 6-max one. On 2026-08-31
         that erased a player seated in seat 7 from his own screen for ten
         minutes while the engine dealt him in, took his big blind, timed out
         his turns and finally evicted him (table 08746c1a). The mapper now
         infers a floor from the highest OCCUPIED seat, which rescues a seated
         hero but still under-draws a table whose high seats happen to be empty.

         The engine holds `tableInfo.max_players` and always has. One field
         ends the guessing: published on the live payload and on the idle one,
         so every snapshot a client can receive carries the true capacity.
         Clients older than this field fall back to the inference and are no
         worse off than they are today. */
      max_seats: Number(this.tableInfo?.max_players) || 0,
      // 2026-09-07: published beside max_seats on every payload so the client
      // knows when seatIdentity() has scrubbed the roster and must not paint
      // a real face over it from its own profile sync (an-avatar-change-
      // stays-changed changelog). Absent on an older engine = not anonymous.
      is_anonymous: this.tableInfo?.is_anonymous === true,
      waiting_for_bb_user_ids: Array.from(this.waitingForBB),
      post_bb_deferred_user_ids: Array.from(this.postBBWhenClear),
      posting_bb_user_ids: Array.from(this.postingBBToEnter),
      pause_owners: this.describePauseOwners(),
      paused_ms: this.msPaused(),
      pots: [],
      action_history: [],
      players: this.rosterNotReplacedByArrivals().map((p) => ({
        seat: p.seat_number,
        user_id: p.user_id,
        ...this.seatIdentity(p),
        ...this.seatBountyFields(p.user_id),
        stack: this.shownSeatStack(p),
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out:
          this.waitingForButton.get(p.seat_number) === p.user_id ||
          this.waitingForBB.has(p.user_id) ||
          this.disconnectEngine.isSittingOut(this.tableId, p.user_id),
        is_disconnected: !this.disconnectEngine.isConnected(this.tableId, p.user_id),
        time_bank_remaining: this.timeBankEngine.getRemainingSeconds(this.tableId, p.user_id),
        time_bank_uses_remaining: this.timeBankEngine.getUsesRemaining(this.tableId, p.user_id),
        position: '',
        is_waiting_for_button: this.waitingForButton.get(p.seat_number) === p.user_id,
        is_waiting_for_bb: this.waitingForBB.has(p.user_id),
        hand_name: '',
        // CHIP CONTINUITY: the stay clock keeps counting between hands, so the
        // idle payload carries it too - the third of the three that must agree.
        ...this.chipContinuity.seatFields(p.user_id, p.stack),
      })),
    };
    (payload as Record<string, any>).players = this.withSeatArrivals(payload.players);
    this.hub.publish(this.tableId, payload);
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // A CHAIR IS SHOWN THE MOMENT IT IS TAKEN (Dan 2026-11-17, SeatArrivalDisplay)
  // ═════════════════════════════════════════════════════════════════════════════

  private seatArrivalExpiryTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Append every tap and committed buy-in the hand boundary has not adopted
   * yet. A chair or player already on the payload keeps its entry: the roster
   * and the hand own their seats, these only fill chairs they leave empty.
   */
  private withSeatArrivals(players: Array<Record<string, any>>): Array<Record<string, any>> {
    const arrivals = this.seatArrivals.live(Date.now());
    if (arrivals.length === 0) return players;
    const out = [...players];
    const userIds = new Set(out.map((p) => p.user_id));
    const seats = new Set(out.map((p) => p.seat));
    for (const a of arrivals) {
      if (userIds.has(a.user_id) || seats.has(a.seat_number)) continue;
      out.push(this.seatArrivalWire(a));
      userIds.add(a.user_id);
      seats.add(a.seat_number);
    }
    return out;
  }

  private seatArrivalWire(a: SeatArrival): Record<string, any> {
    return {
      seat: a.seat_number,
      user_id: a.user_id,
      ...this.seatIdentity(a),
      stack: a.stack ?? 0,
      bet: 0,
      totalInvested: 0,
      cards: [],
      is_folded: false,
      is_all_in: false,
      // Not dealt in. The arrival label says why.
      is_sitting_out: true,
      is_disconnected: false,
      position: '',
      is_waiting_for_button: false,
      is_waiting_for_bb: false,
      hand_name: '',
      seat_arrival: a.kind,
    };
  }

  /** Publish the change, and close the earliest open buy-in window on time. */
  private publishSeatArrivals(): void {
    this.broadcastCurrentState().catch((err) =>
      reportError(err, 'ServerTableEngine.' + this.tableId + '.seat_arrival_broadcast_failed')
    );
    if (this.seatArrivalExpiryTimer) clearTimeout(this.seatArrivalExpiryTimer);
    this.seatArrivalExpiryTimer = null;
    const now = Date.now();
    const next = this.seatArrivals.nextExpiry(now);
    if (next === null) return;
    const timer = setTimeout(
      () => {
        this.seatArrivalExpiryTimer = null;
        if (this.running) this.publishSeatArrivals();
      },
      Math.max(0, next - now) + 25
    );
    (timer as { unref?: () => void }).unref?.();
    this.seatArrivalExpiryTimer = timer;
  }

  /**
   * POST /seat_arrival. `hold`: the + tap. `release`: the buy-in sheet closed
   * unpaid. `seated`: the buy-in committed; every committed seat row this
   * engine has not adopted yet is read from the database and shown, so the
   * chair is never left drawn as open while its occupant waits for a hand.
   */
  public async noteSeatArrival(
    userId: string,
    request: { state: 'hold' | 'release' | 'seated'; seatNumber?: number }
  ): Promise<{ ok: true; expires_at_ms?: number } | { ok: false; reason: string }> {
    if (!this.tableInfo || !this.running) return { ok: false, reason: 'table_not_running' };
    if (this.isTournamentTable()) return { ok: false, reason: 'tournament_table' };
    if (request.state === 'release') {
      if (this.seatArrivals.release(userId)) this.publishSeatArrivals();
      return { ok: true };
    }
    // Both remaining events judge against the committed rows, not the roster
    // this engine last adopted, which can be a whole hand old.
    const committed = await loadSeatedPlayers(this.tableId);
    const adopted = new Set(this.seatedPlayers.map((p) => `${p.user_id}:${p.occupancy_id}`));
    let changed = false;
    for (const row of committed) {
      if (adopted.has(`${row.user_id}:${row.occupancy_id}`)) continue;
      this.seatArrivals.confirm({
        user_id: row.user_id,
        seat_number: row.seat_number,
        stack: row.stack,
        username: row.username,
        avatar_url: row.avatar_url,
        equipped_frame: row.equipped_frame,
        equipped_aura: row.equipped_aura,
      });
      changed = true;
    }
    if (request.state === 'seated') {
      if (changed) this.publishSeatArrivals();
      const seatedNow = committed.some((p) => p.user_id === userId);
      /* A GAME THAT FILLS ASKS FOR ITS LINE WHEN IT FILLS (Dan 2026-11-22): a
         buy-in that took this table's last chair tells the fleet now, not at
         its next cycle (services/HorseLineOnArrival). */
      if (seatedNow && committed.length >= (Number(this.tableInfo.max_players) || Infinity))
        noteCashSeatCommitted(this.tableId);
      return seatedNow ? { ok: true } : { ok: false, reason: 'not_seated' };
    }
    const identity = await loadSeatHoldIdentity(userId);
    if (!identity) {
      if (changed) this.publishSeatArrivals();
      return { ok: false, reason: 'profile_not_found' };
    }
    const verdict = this.seatArrivals.hold(
      userId,
      Number(request.seatNumber),
      identity,
      {
        seats: new Set([
          ...this.seatedPlayers.map((p) => p.seat_number),
          ...committed.map((p) => p.seat_number),
        ]),
        users: new Set([
          ...this.seatedPlayers.map((p) => p.user_id),
          ...committed.map((p) => p.user_id),
        ]),
      },
      Number(this.tableInfo.max_players) || 0,
      Date.now()
    );
    if (verdict.ok || changed) this.publishSeatArrivals();
    return verdict.ok ? { ok: true, expires_at_ms: verdict.expires_at_ms } : verdict;
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // A TOURNAMENT CHAIR IS SHOWN THE MOMENT IT IS TAKEN (Dan 2026-11-18)
  // ═════════════════════════════════════════════════════════════════════════════
  //
  // "WHEN A PLAYER JOINS A TABLE IN BETWEEN THE BLINDS OR ANY OTHER REASON,
  //  THEIR STACK SHOULD SHOW, IT SHOULD NEVER SAY ZERO."
  //
  // A tournament seat is committed by the manager (a balancing move, a table
  // break) or by the database (late registration, re-entry, a rebuy). This
  // engine read its roster only at the hand boundary, so for the rest of the
  // hand in the air, and for the whole of a break, the chair was drawn empty,
  // or as the busted player who used to sit there, or as its own occupant
  // with the zero the roster read before the rebuy. The tournament manager
  // calls showCommittedTournamentSeats() when it knows a row changed; the
  // browser never does (noteSeatArrival above still refuses a tournament
  // table). DISPLAY ONLY, exactly as SeatArrivalDisplay: no hand, pot, button,
  // blind, elimination, bounty or money path reads anything written here, and
  // seatedPlayers is still replaced only by adoptSeatRoster at the boundary.

  private tournamentSeatShow: Promise<void> | null = null;
  private tournamentSeatShowAgain = false;

  private handUserIdsNow(): string[] {
    return (this.handController?.getState().players ?? []).map((p) => p.user_id);
  }

  private committedArrivalReplaces(p: { user_id: string; seat_number: number }): boolean {
    return (
      this.isTournamentTable() && this.seatArrivals.seatedArrivalClaims(p.user_id, p.seat_number)
    );
  }

  private rosterNotReplacedByArrivals(): SeatedPlayer[] {
    const roster = this.seatedPlayers ?? [];
    if (!this.isTournamentTable()) return roster;
    return roster.filter((p) => !this.seatArrivals.seatedArrivalClaims(p.user_id, p.seat_number));
  }

  /** The roster's stack, or the committed chips of a seat the roster still reads as zero. */
  private shownSeatStack(p: { user_id: string; stack: number }): number {
    if (p.stack > 0) return p.stack;
    return this.seatArrivals.committedStack(p.user_id) ?? p.stack;
  }

  /**
   * No reads. Would reading this table's committed rows change what it shows?
   * The manager asks every table with one light read of the whole field, so a
   * late registration or a rebuy costs one roster read at the table it
   * touched and none at the others.
   */
  public tournamentSeatsNeedShowing(
    rows: ReadonlyArray<{
      user_id: string;
      occupancy_id?: string | null;
      seat_number: number;
      stack: number;
    }>
  ): boolean {
    if (!this.tableInfo || !this.running || !this.isTournamentTable()) return false;
    const roster = new Map((this.seatedPlayers ?? []).map((p) => [p.user_id, p]));
    for (const row of rows) {
      const seated = roster.get(row.user_id);
      if (!seated || seated.occupancy_id !== row.occupancy_id) {
        if (!this.seatArrivals.holdsCommitted(row)) return true;
        continue;
      }
      if (
        !(seated.stack > 0) &&
        row.stack > 0 &&
        this.seatArrivals.committedStack(row.user_id) !== row.stack
      ) {
        return true;
      }
    }
    const held = new Set(rows.map((r) => `${r.user_id}:${r.seat_number}`));
    return this.seatArrivals
      .live(Date.now())
      .some((a) => a.kind === 'seated' && !held.has(`${a.user_id}:${a.seat_number}`));
  }

  /**
   * Read this table's committed seat rows and show every one the adopted
   * roster does not: a new occupant in their chair with their real stack, and
   * the chips of a seated player the roster still reads as broke. One read in
   * flight; a request that arrives during it is answered by one more.
   */
  public showCommittedTournamentSeats(): Promise<void> {
    if (!this.tableInfo || !this.running || !this.isTournamentTable()) return Promise.resolve();
    if (this.tournamentSeatShow) {
      this.tournamentSeatShowAgain = true;
      return this.tournamentSeatShow;
    }
    const run = (async () => {
      do {
        this.tournamentSeatShowAgain = false;
        await this.showCommittedTournamentSeatsOnce();
      } while (this.tournamentSeatShowAgain && this.running);
    })()
      .catch((err) =>
        reportError(err, 'ServerTableEngine.' + this.tableId + '.tournament_seat_show_failed')
      )
      .finally(() => {
        if (this.tournamentSeatShow === run) this.tournamentSeatShow = null;
        this.tournamentSeatShowAgain = false;
      });
    this.tournamentSeatShow = run;
    return run;
  }

  private async showCommittedTournamentSeatsOnce(): Promise<void> {
    const rosterAtRead = this.seatedPlayers;
    const inHandAtRead = this.handUserIdsNow();
    const settlingAtRead = this.hasSettlementInFlight();
    const committed = await loadSeatedPlayers(this.tableId);
    if (!this.tableInfo || !this.running || !this.isTournamentTable()) return;
    // A stack is only ever shown over a roster zero that this read can speak
    // for: the same roster, no settlement writing chips, the player in no hand.
    const rosterIsTheOneRead =
      this.seatedPlayers === rosterAtRead && !settlingAtRead && !this.hasSettlementInFlight();
    const inHand = new Set([...inHandAtRead, ...this.handUserIdsNow()]);
    const roster = new Map((this.seatedPlayers ?? []).map((p) => [p.user_id, p]));
    let changed = this.seatArrivals.retainCommitted(committed);
    for (const row of committed) {
      const seated = roster.get(row.user_id);
      if (!seated || seated.occupancy_id !== row.occupancy_id) {
        if (!this.seatArrivals.holdsCommitted(row)) changed = true;
        this.seatArrivals.confirm({
          user_id: row.user_id,
          seat_number: row.seat_number,
          stack: row.stack,
          username: row.username,
          avatar_url: row.avatar_url,
          equipped_frame: row.equipped_frame,
          equipped_aura: row.equipped_aura,
        });
        continue;
      }
      if (
        rosterIsTheOneRead &&
        !inHand.has(row.user_id) &&
        seated.seat_number === row.seat_number &&
        !(seated.stack > 0) &&
        this.seatArrivals.showCommittedStack(row.user_id, row.stack)
      ) {
        changed = true;
      }
    }
    if (changed) this.publishSeatArrivals();
  }
}
