/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE OPERATOR'S MONEY AND ROOM (Phase 3, 2026-09-11)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Three readings an operator had no way to get, in chrome arena cases, shared
 * by both Diamond Games consoles so the wheel page and the games page cannot
 * drift apart:
 *
 *   THE MONEY   what the host is up or down across all three games, over four
 *               windows. Balances are a photograph and the realised-return
 *               windows are about fairness, not money: they do not count the
 *               diamond prizes at all, so the one figure an owner cares about
 *               appeared nowhere.
 *
 *   THE ROOM    how much game is left in the cover. The cover reading goes red
 *               at zero, by which time the games have been refusing bets for a
 *               while, because each caps the multiplier it offers by what the
 *               cover can pay. This sits between "fine" and "stopped", and it
 *               says WHICH ceiling is binding: the intake headroom, which is
 *               the never-pay-more-than-taken-in law working and nothing to act
 *               on, or the cover, which is the operator's to fix.
 *
 *   THE PLAYERS per-player daily caps have existed since the games opened and
 *               no surface ever showed an operator who was near one.
 *
 * Nothing here runs on a schedule. CLAUDE.md 10.12 forbids a monitor or an
 * alert presented as the resolution; these are computed when the operator opens
 * the page they already open, out of rows the games already wrote.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  OpsCase,
  OpsCell,
  OpsRow,
  OpsRows,
  OpsTable,
  OpsTableRow,
  type OpsInk,
} from './DiamondOpsKit';
import DiamondGamesService, {
  type GamePnl,
  type GamePlayers,
  type GameRoom,
  type GameRoomState,
} from '../../services/DiamondGamesService';
import { compactChips, formatWalletDiamonds } from '../../utils/format';
import { reportError } from '../../utils/errorReporter';
import { useIsMounted } from '../../hooks/useIsMounted';
import { DIAMOND_GAME_TITLES } from '../../utils/diamondGameTitles';

/**
 * MONEY IN THIS TABLE IS WHOLE, AND NEVER A FALSE ZERO (2026-09-11).
 *
 * Dan 2026-09-08: never a decimal point on a forward-facing page, and always
 * rounded DOWN so a printed figure never overstates. compactChips does exactly
 * that, which is right everywhere it is already used and wrong for a P and L:
 * it floors the absolute value, so a real net of half a chip printed as "0" and
 * a real LOSS of half a chip printed as "-0". The audit after phase 3 found
 * both on the live console, on a host genuinely down 50 diamonds.
 *
 * Under one chip the figure is stated in DIAMONDS instead. A diamond is the
 * atomic unit and always whole (1 diamond is 1 cent), so the rule is kept, the
 * figure is exact, and nothing reads as zero that is not zero.
 */
function money(v: number | null | undefined, rate: number): string {
  const n = Number(v ?? 0);
  if (n === 0) return '0';
  if (Math.abs(n) >= 1) return compactChips(n);
  const perChip = rate > 0 ? rate : 100;
  return `${Math.round(n * perChip)} \u25C6`;
}
/** One name per game, from the single source; the wheel is not a bonus game. */
const GAME_WORD: Record<string, string> = {
  wheel: 'Diamond Wheel',
  ...DIAMOND_GAME_TITLES,
};
const gameWord = (g: string) => GAME_WORD[g] ?? g;

const STATE_INK: Record<GameRoomState, OpsInk> = {
  open: 'green',
  thin: 'gold',
  stopped: 'red',
  closed: 'muted',
};
const STATE_WORD: Record<GameRoomState, string> = {
  open: 'Open',
  thin: 'Thin',
  stopped: 'Stopped',
  closed: 'Closed',
};

/** The worst state any game is in, which is what the header should say. */
function worstState(room: GameRoom | null): GameRoomState {
  if (!room || room.games.length === 0) return 'closed';
  const live = room.games.filter((g) => g.enabled);
  if (live.length === 0) return 'closed';
  if (live.some((g) => g.state === 'stopped')) return 'stopped';
  if (live.some((g) => g.state === 'thin')) return 'thin';
  return 'open';
}

export default function DiamondGamesMoney({ clubId }: { clubId: string | null }) {
  const isMountedRef = useIsMounted();
  const [pnl, setPnl] = useState<GamePnl | null>(null);
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [players, setPlayers] = useState<GamePlayers | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    try {
      const [p, r, w] = await Promise.all([
        DiamondGamesService.pnl(clubId).catch((err) => {
          reportError(err, 'DiamondGamesMoney.pnl', { clubId });
          return null;
        }),
        DiamondGamesService.room(clubId).catch((err) => {
          reportError(err, 'DiamondGamesMoney.room', { clubId });
          return null;
        }),
        DiamondGamesService.players(clubId, 25).catch((err) => {
          reportError(err, 'DiamondGamesMoney.players', { clubId });
          return null;
        }),
      ]);
      if (!isMountedRef.current) return;
      setPnl(p);
      setRoom(r);
      setPlayers(w);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [clubId, isMountedRef]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!clubId) return null;

  const state = worstState(room);
  const rate = pnl?.diamonds_per_chip ?? 100;
  /* A read the server refused says so, rather than rendering as an empty table
     that looks like a host with no history. */
  const refusal = [pnl, room, players].find((r) => r && !r.ok)?.error ?? null;
  const day = pnl?.windows.find((w) => w.window === '24 Hours') ?? null;
  const roster = players?.players ?? [];

  return (
    <>
      <OpsCase
        eyebrow="Diamonds In, Chips Out"
        title="The Money"
        pill={day ? (day.net_chips >= 0 ? 'Up Today' : 'Down Today') : 'No Rounds Yet'}
        pillInk={day && day.net_chips < 0 ? 'red' : 'green'}
      >
        <p className="arena-ops-copy">
          Game Earnings Include Entry Diamonds And Prize Costs. New Entries Stay In Daily Custody;
          Diamond And Inventory Prizes Are Deducted Before One Net Owner Wallet Settlement, Which
          Burns 20% Of A Profitable Day And Credits The Remaining 80%. Chip Prizes Use The Promo
          Wallet First, Then The Bank. Welcome Spins Are Shown Separately. Daily Diamond Statements
          Show The Net, The Burn And The Exact Wallet Credit.
        </p>
        {refusal ? (
          <p className="arena-ops-copy dops-copy--danger" role="alert">
            {refusal}
          </p>
        ) : null}
        <OpsTable label="The Money" head={['Window', 'Rounds', 'Taken In', 'Net']}>
          {(pnl?.windows ?? []).map((w) => (
            <OpsTableRow key={w.window}>
              <OpsCell>{w.window}</OpsCell>
              <OpsCell>{w.rounds}</OpsCell>
              <OpsCell>{money(w.intake_chips, rate)}</OpsCell>
              <OpsCell ink={w.net_chips >= 0 ? 'green' : 'red'}>{money(w.net_chips, rate)}</OpsCell>
            </OpsTableRow>
          ))}
        </OpsTable>
        {day ? (
          <>
            <OpsTable label="Today, By Game" head={['Today, By Game', 'Rounds', 'Paid Out', 'Net']}>
              {day.games.map((g) => (
                <OpsTableRow key={g.game}>
                  <OpsCell>{gameWord(g.game)}</OpsCell>
                  <OpsCell>{g.rounds}</OpsCell>
                  <OpsCell>{money(g.chips_paid, rate)}</OpsCell>
                  <OpsCell ink={g.net_chips >= 0 ? 'green' : 'red'}>
                    {money(g.net_chips, rate)}
                  </OpsCell>
                </OpsTableRow>
              ))}
            </OpsTable>
            {day.welcome_chips > 0 ? (
              <OpsRows>
                <OpsRow
                  label="Welcome Spins Today"
                  value={money(day.welcome_chips, rate)}
                  ink="gold"
                  meta="Given Away, Not Lost At The Table"
                />
              </OpsRows>
            ) : null}
          </>
        ) : null}
        {!pnl && !loading ? (
          <p className="arena-ops-copy dops-copy--muted">No Figures Yet.</p>
        ) : null}
      </OpsCase>

      <OpsCase
        eyebrow="Before It Stops"
        title="The Room"
        pill={STATE_WORD[state]}
        pillInk={STATE_INK[state]}
      >
        <p className="arena-ops-copy">
          Top Win Is The Biggest A Player Could Take Right Now At Your Largest Bet, Against The
          Ceiling Your Settings Allow. Every Game Caps What It Offers By What Your Cover Can Pay, So
          A Game Goes Quiet Long Before The Cover Reads Zero. Thin Means The Cover Is What Is
          Holding The Top Prize Down And More Chips In The Promo Wallet Would Lift It. A Game Held
          Down By Its Own Intake Instead Is The House Rule Working, And Needs Nothing From You.
        </p>
        <OpsTable label="The Room" head={['Game', 'Top Win', 'Ceiling', 'State']}>
          {(room?.games ?? []).map((g) => (
            <OpsTableRow key={g.game}>
              <OpsCell>{gameWord(g.game)}</OpsCell>
              <OpsCell>
                {g.game === 'wheel'
                  ? money(g.top_chip_prize_chips, rate)
                  : money(g.max_win_chips, rate)}
              </OpsCell>
              <OpsCell dim>
                {g.game === 'wheel' ? 'Fixed Table' : money(g.ceiling_win_chips, rate)}
              </OpsCell>
              <OpsCell ink={STATE_INK[g.state]}>{STATE_WORD[g.state]}</OpsCell>
            </OpsTableRow>
          ))}
        </OpsTable>
        <OpsRows>
          {(room?.games ?? [])
            .filter((g) => g.enabled && g.capped_by_intake && !g.capped_by_cover)
            .map((g) => (
              <OpsRow
                key={`${g.game}-intake`}
                label={gameWord(g.game)}
                value={`${money(g.max_win_chips, rate)} Of ${money(g.ceiling_win_chips, rate)}`}
                ink="muted"
                meta="Held By What It Has Taken In, Not By Your Cover. Nothing To Do"
              />
            ))}
          {(room?.games ?? [])
            .filter((g) => g.enabled && g.capped_by_cover)
            .map((g) => (
              <OpsRow
                key={`${g.game}-why`}
                label={gameWord(g.game)}
                value={`${money(g.max_win_chips, rate)} Of ${money(g.intake_win_chips, rate)}`}
                ink="gold"
                meta="The Cover Is Holding This One Down"
              />
            ))}
          {(room?.games ?? []).some(
            (g) => g.game === 'wheel' && g.enabled && g.diamond_prize_covered === false
          ) ? (
            <OpsRow
              label="Owner Diamonds"
              value={`${formatWalletDiamonds(room?.owner_diamonds ?? 0)} Will Not Cover The Top Diamond Prize`}
              ink="red"
              wrap
              meta="This Balance Backs Any Daily Diamond Shortfall"
            />
          ) : null}
        </OpsRows>
      </OpsCase>

      <OpsCase
        eyebrow="Today"
        title="Who Is Playing"
        pill={`${roster.length}`}
        pillInk={roster.some((p) => p.at_spin_cap || p.at_round_cap) ? 'gold' : 'blue'}
      >
        <p className="arena-ops-copy">
          Everyone Who Has Played This Host Today, Biggest Spender First, Against The Two Daily
          Ceilings. Net Is From The Player Side: A Positive Number Means They Are Ahead.
        </p>
        <OpsTable label="Who Is Playing" head={['Player', 'Rounds', 'Spent', 'Net']}>
          {roster.map((p) => (
            <OpsTableRow key={p.user_id}>
              <OpsCell>{p.name}</OpsCell>
              <OpsCell ink={p.at_spin_cap || p.at_round_cap ? 'gold' : undefined}>
                {p.spins + p.rounds}
              </OpsCell>
              <OpsCell>{money(p.spent_chips, rate)}</OpsCell>
              <OpsCell ink={p.net_chips >= 0 ? 'green' : 'muted'}>
                {money(p.net_chips, rate)}
              </OpsCell>
            </OpsTableRow>
          ))}
        </OpsTable>
        {roster.length === 0 ? (
          <p className="arena-ops-copy dops-copy--muted">Nobody Has Played Here Today.</p>
        ) : null}
        {roster.some((p) => p.at_spin_cap || p.at_round_cap) ? (
          <OpsRows>
            <OpsRow
              label="At The Daily Ceiling"
              value={String(roster.filter((p) => p.at_spin_cap || p.at_round_cap).length)}
              ink="gold"
            />
          </OpsRows>
        ) : null}
      </OpsCase>
    </>
  );
}
