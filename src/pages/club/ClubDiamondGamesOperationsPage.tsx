/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DIAMOND PLINKO + DIAMOND CRASH - the operator's console
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * One page, two games, a switch on the plates. What a host owner needs to run
 * them and nothing else: open and close each game, the bet sizes, the exposure
 * allowance (the most the host accepts being ahead of what the game has taken
 * in), the cap fraction, the multiplier ceiling, the crash curve, the
 * per-player limits, and the readings that say whether the game is doing what
 * its odds promise: realised return against the 80 percent spec as a z-score
 * per window, the constrained rate, exposure headroom, open rounds still
 * holding a reservation, and the invariant (paid + reserved <= taken in +
 * allowance) that the arithmetic makes impossible to break and
 * fn_diamond_game_metrics re-derives anyway. AMENDED 2026-09-10: nothing is
 * minted any more. The diamonds a round takes in are the host owner's, and
 * every chip a game pays leaves the host's promo wallet, which is why that
 * wallet and the owner's diamonds are the two figures at the top of this page.
 *
 * Every control posts a patch to fn_diamond_game_set_config, which decides who
 * may (fn_wheel_can_operate). The page shows a refusal, it never pre-empts one.
 *
 * THE PICTURE (#SmarterDesign, Dan 2026-11-27). The arena workspace: the
 * chrome mast with the club's name, the live figures as chrome meters, one
 * chrome switch of the games (the chosen one lit), then thin chrome cases for
 * the readings, the promo wallet, the settled play, the controls (dark wells,
 * Close / Open and Save as chrome keys) and the lifetime pool. No painted
 * plates.
 *
 * Route: /clubs/:clubId/diamond-games-operations, finance access in the
 * operations registry. The players' pages are /clubs/:clubId/plinko and
 * /clubs/:clubId/crash. The wheel has its own console at /wheel-operations.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../components/common/Toast';
import ArenaWorkspaceHeader from '../../components/lobby/ArenaWorkspaceHeader';
import PageBar from '../../components/help/PageBar';
import { ArenaState } from '../../components/ops/ArenaOps';
import { useArenaClubName } from '../../components/ops/useArenaClubName';
import {
  OpsBack,
  OpsCase,
  OpsCell,
  OpsField,
  OpsFields,
  OpsReading,
  OpsReadings,
  OpsTable,
  OpsTableRow,
  OpsToggle,
} from '../../components/club/DiamondOpsKit';
import DiamondGamesService, {
  type DiamondGame,
  type GameConfigPatch,
  type GameMetrics,
} from '../../services/DiamondGamesService';
import { multiplierLabel } from '../../utils/diamondGamesFairness';
import { compactChips, formatWalletChips, formatWalletDiamonds } from '../../utils/format';
import { resolveClubUUID } from '../../utils/clubIdResolver';
import { reportError } from '../../utils/errorReporter';
import DiamondGamesMoney from '../../components/club/DiamondGamesMoney';
import DiamondSpinStatements from '../../components/club/DiamondSpinStatements';
import DiamondSpinsOwnerTerms from '../../components/games/DiamondSpinsOwnerTerms';
import { DIAMOND_GAME_TITLES } from '../../utils/diamondGameTitles';
import { uuid } from '../../utils/uuid';
import { useIsMounted } from '../../hooks/useIsMounted';
import { designedReturn } from '../../utils/diamondDesignedReturn';

const chips = (n: number | null | undefined) => compactChips(Number(n ?? 0));
const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? 'N/A' : `${Math.round(n * 100)}%`;

interface Draft {
  bet_options: string;
  min_bet_diamonds: string;
  max_bet_diamonds: string;
  exposure_allowance_chips: string;
  cap_fraction: string;
  max_multiplier: string;
  growth_k: string;
  max_rounds_per_player_per_day: string;
  min_seconds_between_rounds: string;
  purchased_only: boolean;
  allow_fixture_accounts: boolean;
}

function draftFrom(m: GameMetrics | null, game: DiamondGame = 'plinko'): Draft {
  const c = m?.config;
  return {
    bet_options: (c?.bet_options ?? [25, 50, 100, 250, 500, 1000, 2500, 5000]).join(', '),
    min_bet_diamonds: String(c?.min_bet_diamonds ?? 25),
    max_bet_diamonds: String(c?.max_bet_diamonds ?? 5000),
    exposure_allowance_chips: String(c?.exposure_allowance_chips ?? 1250),
    cap_fraction: String(c?.cap_fraction ?? 0.95),
    max_multiplier: String((c?.max_multiplier_cents ?? (game === 'crash' ? 2000 : 100000)) / 100),
    growth_k: String(c?.growth_k ?? (game === 'crash' ? 0.08 : 0.12)),
    max_rounds_per_player_per_day: String(c?.max_rounds_per_player_per_day ?? 500),
    min_seconds_between_rounds: String(c?.min_seconds_between_rounds ?? 2),
    purchased_only: false,
    allow_fixture_accounts: c?.allow_fixture_accounts ?? false,
  };
}

/** One name per game, from the single source, so no console can drift from it. */
const GAME_WORD: Record<DiamondGame, string> = DIAMOND_GAME_TITLES;

export default function ClubDiamondGamesOperationsPage() {
  const { clubId: routeClubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const isMountedRef = useIsMounted();
  const clubName = useArenaClubName();

  const [game, setGame] = useState<DiamondGame>('plinko');
  const [clubUuid, setClubUuid] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<GameMetrics | null>(null);
  const [draft, setDraft] = useState<Draft>(draftFrom(null));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fundChips, setFundChips] = useState('');
  const [funding, setFunding] = useState(false);
  /**
   * ONE KEY PER INTENT, HELD ACROSS A FAILURE (2026-09-11). The server spends a
   * funding key once and answers a second press under the same key with
   * replayed = true, having moved nothing. So a press whose reply was lost has
   * to be retried under the SAME key: mint on a new amount, keep on a thrown
   * request, clear only once the server has actually answered.
   */
  const fundKeyRef = useRef<{ amount: number; key: string } | null>(null);

  const load = useCallback(
    async (which: DiamondGame) => {
      if (!routeClubId) return;
      setLoading(true);
      setError(null);
      try {
        const uuid = clubUuid ?? (await resolveClubUUID(routeClubId));
        if (!isMountedRef.current) return;
        setClubUuid(uuid);
        const m = await DiamondGamesService.metrics(uuid, which);
        if (!isMountedRef.current) return;
        if (!m.ok) {
          setError(m.error || 'The Readings Could Not Be Loaded');
          return;
        }
        setMetrics(m);
        setDraft(draftFrom(m, which));
      } catch (err) {
        reportError(err, 'ClubDiamondGamesOperationsPage.load');
        if (isMountedRef.current) setError('The Readings Could Not Be Loaded');
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
    },
    [routeClubId, clubUuid, isMountedRef]
  );

  useEffect(() => {
    void load(game);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, routeClubId]);

  const apply = useCallback(
    async (patch: GameConfigPatch, done: string) => {
      if (!clubUuid) return;
      setSaving(true);
      try {
        const res = await DiamondGamesService.setConfig(clubUuid, game, patch);
        if (!isMountedRef.current) return;
        if (!res.ok) {
          toast.error(res.error || 'That Change Was Refused');
          return;
        }
        toast.success(done);
        await load(game);
      } catch (err) {
        reportError(err, 'ClubDiamondGamesOperationsPage.apply');
        if (isMountedRef.current) toast.error('That Change Did Not Go Through');
      } finally {
        if (isMountedRef.current) setSaving(false);
      }
    },
    [clubUuid, game, isMountedRef, toast, load]
  );

  /** Bank into promo wallet. The server decides who may; this only asks. */
  const moveIntoPromo = useCallback(
    async (amount: number) => {
      if (!clubUuid) return;
      if (!Number.isFinite(amount) || amount <= 0)
        return toast.error('Enter How Many Chips To Move');
      const held = fundKeyRef.current;
      const intent = held && held.amount === amount ? held : { amount, key: uuid() };
      fundKeyRef.current = intent;
      setFunding(true);
      try {
        const res = await DiamondGamesService.fundPromo(clubUuid, amount, intent.key);
        // The server answered, so this intent is closed either way: a refusal
        // moved nothing, and a success must never be sent a second time.
        fundKeyRef.current = null;
        if (!isMountedRef.current) return;
        if (!res.ok) {
          toast.error(res.error ?? 'Those Chips Could Not Be Moved');
        } else {
          toast.success(
            res.replayed ? 'Those Chips Were Already Moved' : 'The Promo Wallet Is Funded'
          );
          setFundChips('');
          await load(game);
        }
      } catch (err) {
        // No answer came back, so nobody knows whether the chips moved. The key
        // is deliberately kept: the next press is the same intent, not a new one,
        // and the server will either carry it out or report it as a replay.
        //
        // The first cut of this said the chips had not moved, which is a claim
        // nobody here is in a position to make, printed over numbers that were
        // never rechecked. The console rereads and lets the wallet answer.
        reportError(err, 'ClubDiamondGamesOperationsPage.fundPromo');
        if (!isMountedRef.current) return;
        toast.error('No Answer Came Back. The Numbers Below Are Rechecked');
        await load(game);
      } finally {
        if (isMountedRef.current) setFunding(false);
      }
    },
    [clubUuid, game, isMountedRef, toast, load]
  );

  const saveNumbers = () => {
    const bets = draft.bet_options
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (!bets.length || bets.some((b) => !Number.isInteger(b) || b <= 0))
      return toast.error('Bet Sizes Must Be Whole Numbers Of Diamonds');
    const minBet = 25;
    const maxBet = 5000;
    const allowance = Number(draft.exposure_allowance_chips);
    const capFraction = Number(draft.cap_fraction);
    const maxMult = Number(draft.max_multiplier);
    const growthK = Number(draft.growth_k);
    const rounds = Number(draft.max_rounds_per_player_per_day);
    const gap = Number(draft.min_seconds_between_rounds);
    if (!Number.isInteger(minBet) || minBet <= 0 || !Number.isInteger(maxBet) || maxBet < minBet)
      return toast.error('The Bet Limits Must Be Whole Numbers Of Diamonds, Max At Least Min');
    if (!Number.isFinite(allowance) || allowance < 0)
      return toast.error('The Exposure Allowance Must Be Zero Or More');
    if (!Number.isFinite(capFraction) || capFraction <= 0 || capFraction >= 1)
      return toast.error('The Cap Fraction Must Be Between 0 And 1');
    if (!Number.isFinite(maxMult) || maxMult < 1.01)
      return toast.error('The Multiplier Ceiling Must Be At Least 1.01');
    if (!Number.isFinite(growthK) || growthK <= 0) return toast.error('The Curve Must Climb');
    if (game === 'crash' && (maxMult > 100 || growthK > 0.04))
      return toast.error('Crash Is Limited To 100x And A Curve Of 0.04 Or Slower');
    if (!Number.isInteger(rounds) || rounds <= 0)
      return toast.error('The Daily Limit Must Be A Whole Number Of Rounds');
    if (!Number.isInteger(gap) || gap < 0)
      return toast.error('The Pause Between Rounds Must Be Zero Or More Seconds');
    void apply(
      {
        bet_options: bets,
        min_bet_diamonds: minBet,
        max_bet_diamonds: maxBet,
        exposure_allowance_chips: Math.round(allowance * 100) / 100,
        cap_fraction: Math.round(capFraction * 1000) / 1000,
        max_multiplier_cents: Math.round(maxMult * 100),
        growth_k: Math.round(growthK * 10000) / 10000,
        max_rounds_per_player_per_day: rounds,
        min_seconds_between_rounds: gap,
        purchased_only: false,
        allow_fixture_accounts: draft.allow_fixture_accounts,
      },
      `${GAME_WORD[game]} Settings Saved`
    );
  };

  const back = () => navigate(`/clubs/${routeClubId}/operations`);
  const mast = (
    <>
      <OpsBack onClick={back} />
      <ArenaWorkspaceHeader
        area="finance"
        title="Diamond Games"
        context={clubName}
        subtitle="Games Operations"
        summary="Open And Close Each Diamond Game, Set Its Bets, Cover And Limits, And Read Whether It Pays What Its Odds Promise."
      />
    </>
  );

  if (loading && !metrics) {
    return (
      <div className="arena-workspace dops-page">
        {mast}
        <section className="arena-case arena-ops-case">
          <ArenaState tone="loading" title="Reading The Games" />
        </section>
      </div>
    );
  }
  if (error) {
    return (
      <div className="arena-workspace dops-page">
        {mast}
        <section className="arena-case arena-ops-case">
          <ArenaState
            tone="error"
            title="Not Read"
            message={error}
            actions={
              <button type="button" onClick={() => void load(game)}>
                Try Again
              </button>
            }
          />
        </section>
      </div>
    );
  }

  const cfg = metrics?.config;
  const pool = metrics?.pool;
  const enabled = Boolean(cfg?.enabled) && metrics?.owner_agreed === true;
  const word = GAME_WORD[game];
  const hostWord = metrics?.host_kind === 'union' ? 'Union' : 'Club';
  const promoDry = (metrics?.promo_chips ?? 0) <= 0;
  const set = (key: keyof Draft) => (v: string) => setDraft((d) => ({ ...d, [key]: v }));
  const games = Object.keys(GAME_WORD) as DiamondGame[];

  return (
    <div className="arena-workspace dops-page">
      {mast}
      <PageBar
        title="Diamond Games"
        titleAs={false}
        showHelp={false}
        status={enabled ? `${word} Is Open` : `${word} Is Closed`}
        statusTone={enabled ? 'live' : 'danger'}
        metrics={[
          { label: 'Cover', value: chips(metrics?.cover_chips) },
          {
            label: 'Promo Wallet',
            value: formatWalletChips(metrics?.promo_chips),
            tone: promoDry ? 'attention' : 'live',
          },
          { label: 'Paid Back', value: pct(metrics?.realized_rtp_lifetime) },
          {
            label: 'Invariant',
            value: metrics?.invariant_ok === false ? 'Broken' : 'Holds',
            tone: metrics?.invariant_ok === false ? 'attention' : 'live',
          },
        ]}
      />

      <nav aria-label="Diamond Games">
        <div className="arena-switch arena-ops-keys">
          {games.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={g === game}
              disabled={loading || saving}
              onClick={() => setGame(g)}
            >
              {GAME_WORD[g]}
            </button>
          ))}
        </div>
      </nav>

      <DiamondSpinsOwnerTerms clubId={clubUuid} onAccepted={() => void load(game)} />
      <DiamondSpinStatements />

      <OpsCase
        eyebrow="Operations"
        title={word}
        titleId="diamond-games-ops-title"
        pill={enabled ? 'Open' : 'Closed'}
        pillInk={enabled ? 'green' : 'red'}
        aria-busy={loading || undefined}
      >
        <OpsReadings label={`${word} Readings`}>
          <OpsReading
            label="Cover"
            value={chips(metrics?.cover_chips)}
            ink={(metrics?.cover_chips ?? 0) <= 0 ? 'red' : 'silver'}
            meta={`${formatWalletChips(metrics?.promo_chips)} Promo Plus ${formatWalletChips(metrics?.bank_chips)} Bank`}
          />
          <OpsReading
            label={`${hostWord} Promo Wallet`}
            value={formatWalletChips(metrics?.promo_chips)}
            ink={promoDry ? 'gold' : 'silver'}
            meta={
              promoDry
                ? `Empty, So The ${hostWord} Bank Is Paying`
                : 'Every Payout Is Paid From Here First'
            }
          />
          <OpsReading
            label={`${hostWord} Bank`}
            value={formatWalletChips(metrics?.bank_chips)}
            ink={(metrics?.bank_chips ?? 0) <= 0 ? 'red' : 'blue'}
            meta="Behind The Promo Wallet, And Only When It Runs Dry"
          />
          <OpsReading
            label="Owner Diamonds"
            value={formatWalletDiamonds(metrics?.owner_diamonds ?? 0)}
            ink="blue"
            meta="Daily Net Diamonds Arrive In One Settlement After A 20% Platform Burn"
          />
          <OpsReading
            label="Exposure"
            value={chips(metrics?.exposure_chips)}
            ink={(metrics?.exposure_chips ?? 0) > 0 ? 'gold' : 'silver'}
            meta={`Room ${chips(metrics?.exposure_headroom_chips)}`}
          />
          <OpsReading
            label="Paid Back"
            value={pct(metrics?.realized_rtp_lifetime)}
            ink="silver"
            meta={
              game === 'crash'
                ? 'Return Depends On Cash-Out Target'
                : `Built To Pay ${pct(designedReturn(game, metrics?.tables))}`
            }
          />
          <OpsReading
            label="House Take"
            value={chips(metrics?.house_take_lifetime_chips)}
            ink="gold"
            meta="Chips"
          />
          <OpsReading
            label="Capped"
            value={pct(metrics?.constrained_rate)}
            meta={game === 'crash' ? `${metrics?.open_rounds ?? 0} Open` : 'Of Rounds'}
          />
          <OpsReading
            label="Invariant"
            value={metrics?.invariant_ok === false ? 'Broken' : 'Holds'}
            ink={metrics?.invariant_ok === false ? 'red' : 'green'}
            meta="Paid Plus Held"
          />
        </OpsReadings>
        <p className="arena-ops-copy">
          Paid Plus Reserved Never Exceeds What Was Taken In Plus The Allowance, And Every Chip
          Leaves The Promo Wallet Before The Bank; The Per-Round Cap Makes That Arithmetic, And The
          Metrics Re-Derive It. Capped Rounds Are Ones The Pool Could Not Promise The Full Ceiling
          On.
        </p>
      </OpsCase>

      {/* THE FLOAT, AND WHERE TO PUT IT (Dan 2026-09-10). The bank backs the
          promo wallet on its own, so the games never stop; this is how an
          operator moves the float to where it is meant to sit. */}
      <OpsCase
        eyebrow="Cover"
        title="The Promo Wallet"
        pill={promoDry ? 'On The Bank' : 'Funded'}
        pillInk={promoDry ? 'gold' : 'green'}
        plates={{
          secondary: {
            label: 'Move 100',
            onClick: () => void moveIntoPromo(100),
            disabled: funding,
          },
          primary: {
            label: funding ? 'Moving' : 'Move The Amount',
            ink: 'white',
            onClick: () => void moveIntoPromo(Number(fundChips)),
            disabled: funding,
          },
        }}
      >
        <p className="arena-ops-copy">
          BBJ Funding Feeds The Promo Wallet. Every Chip Prize Uses It First. The {hostWord} Bank
          Pays The Shortfall When Funds Are Available; The Journal Names Which Wallet Paid Which
          Part. Keep The Promo Wallet Funded For Upcoming Prizes.
        </p>
        <OpsFields>
          <OpsField
            label="Move Into The Promo Wallet (Chips)"
            mode="decimal"
            value={fundChips}
            onChange={setFundChips}
            hint="Taken From The Bank, Which Is The Same Money In A Different Pocket."
          />
        </OpsFields>
      </OpsCase>

      <DiamondGamesMoney clubId={clubUuid} />

      <OpsCase eyebrow="Settled Play" title="Game Activity">
        <OpsTable label="Game Activity" head={['Window', 'Rounds', 'Paid Back', 'Review']}>
          {(metrics?.windows ?? []).map((w) => (
            <OpsTableRow key={w.window}>
              <OpsCell
                ink={w.drift ? 'red' : 'silver'}
                meta={`In ${chips(w.intake_chips)}, Out ${chips(w.paid_chips)}${
                  w.constrained ? `, ${compactChips(w.constrained)} Capped` : ''
                }${
                  game === 'crash' && w.instant_crashes
                    ? `, ${compactChips(w.instant_crashes)} Instant`
                    : ''
                }`}
              >
                {w.window.toUpperCase()}
              </OpsCell>
              <OpsCell>{compactChips(w.rounds)}</OpsCell>
              <OpsCell ink={w.drift ? 'red' : 'silver'}>{pct(w.realized_rtp)}</OpsCell>
              <OpsCell ink={w.drift ? 'red' : 'muted'}>
                {w.drift === null ? 'N/A' : w.drift ? 'Review' : 'Clear'}
              </OpsCell>
            </OpsTableRow>
          ))}
        </OpsTable>
        <p className="arena-ops-copy">
          Paid Back Is Chips Paid Out Of Chips Taken In.{' '}
          {game === 'crash'
            ? 'Crash Returns Depend On The Cash-Out Target.'
            : `Designed Return Is ${pct(designedReturn(game, metrics?.tables))}.`}{' '}
          A Short Window Swings Far From It; Review Highlights Activity That Needs An Operator
          Check. Intake And Paid Chips Come From The Settled Game Records.
        </p>
        {game === 'plinko' && metrics?.tables?.length ? (
          <OpsReadings label="Plinko Boards">
            {metrics.tables.map((t) => (
              <OpsReading
                key={t.version}
                label={t.name}
                value={multiplierLabel(t.max_multiplier_cents)}
                ink={t.activated_at ? 'gold' : 'muted'}
                meta={`${t.activated_at ? 'Active Table' : 'Not Yet Live'}${t.spec_rtp !== null ? `, Built To Pay ${pct(t.spec_rtp)}` : ''}`}
              />
            ))}
          </OpsReadings>
        ) : null}
      </OpsCase>

      <OpsCase
        eyebrow={`${word} Is ${enabled ? 'Open' : 'Closed'}`}
        title="Controls"
        plates={{
          secondary: {
            label: enabled ? `Close ${word}` : `Open ${word}`,
            ink: enabled ? 'red' : 'gold',
            disabled: saving,
            onClick: () =>
              void apply({ enabled: !enabled }, enabled ? `${word} Is Closed` : `${word} Is Open`),
          },
          primary: {
            label: saving ? 'Saving' : 'Save Settings',
            ink: 'white',
            onClick: saveNumbers,
            disabled: saving,
          },
        }}
      >
        <p className="arena-ops-copy">
          {enabled
            ? 'Closing It Refuses The Next Round At Once. Rounds Already Open Settle As Normal.'
            : 'Nobody Can Play Until You Open It.'}
        </p>
        <OpsFields>
          <OpsField
            label="Bet Sizes (Diamonds, Comma Separated)"
            mode="text"
            value={draft.bet_options}
            onChange={set('bet_options')}
            hint="25 To 2,500 Diamonds."
          />
          <OpsField
            label="Exposure Allowance (Chips)"
            mode="decimal"
            value={draft.exposure_allowance_chips}
            onChange={set('exposure_allowance_chips')}
            hint={`The Most ${word} May Pay Beyond What It Has Taken In.`}
          />
          <p className="arena-ops-copy">
            Entries Are 25 To 2,500 Diamonds. Earned And Purchased Diamonds Are Accepted.
          </p>
          <OpsField
            label="Cap Fraction"
            mode="decimal"
            value={draft.cap_fraction}
            onChange={set('cap_fraction')}
            hint="The Share Of The Pool Headroom One Round May Be Promised. 0.95 Keeps The Pool Alive After A Full Hit."
          />
          <OpsField
            label="Multiplier Ceiling"
            mode="decimal"
            value={draft.max_multiplier}
            onChange={set('max_multiplier')}
            hint={
              game === 'crash'
                ? 'Every Flight Is Capped At 20x. The Server Holds It There Whatever Is Saved.'
                : 'Never Above The Board Itself.'
            }
          />
          {game === 'crash' ? (
            <OpsField
              label="Curve (K Per Second)"
              mode="decimal"
              value={draft.growth_k}
              onChange={set('growth_k')}
              hint="0.08 Reaches 2x In 8.7 Seconds And 20x In 37 Seconds. 0.08 Is The Fastest Allowed; A Smaller Value Is Slower."
            />
          ) : null}
          <OpsField
            label="Rounds Per Player Per Day"
            mode="numeric"
            value={draft.max_rounds_per_player_per_day}
            onChange={set('max_rounds_per_player_per_day')}
          />
          <OpsField
            label="Seconds Between Rounds"
            mode="numeric"
            value={draft.min_seconds_between_rounds}
            onChange={set('min_seconds_between_rounds')}
          />
          <OpsToggle
            label="Allow Certification Accounts"
            hint="For Burn-In Only. Their Rounds Are Kept Out Of The Fairness Statistics."
            on={draft.allow_fixture_accounts}
            onToggle={() =>
              setDraft((d) => ({ ...d, allow_fixture_accounts: !d.allow_fixture_accounts }))
            }
          />
        </OpsFields>
      </OpsCase>

      <OpsCase
        eyebrow="Lifetime"
        title="The Pool"
        plates={{
          secondary: {
            label: 'Wheel Console',
            onClick: () => navigate(`/clubs/${routeClubId}/wheel-operations`),
          },
          primary: {
            /* The plate carries the game's full title now that GAME_WORD is the
               single source, so "Players Plinko" would read as "Players Diamond
               Plinko". The verb makes it a sentence again. */
            label: `Play ${word}`,
            ink: 'white',
            /* Both targets spelled out. `/clubs/${id}/${game}` resolves at
               runtime, but check-route-targets reads the source, not the
               runtime, and a template it cannot resolve reads as a navigation
               to a route nobody declared. The two literals are what the gate
               is entitled to see, and the allowlist is for paths this router
               does not own, which these are not. */
            onClick: () =>
              navigate(
                game === 'plinko'
                  ? `/clubs/${routeClubId}/plinko`
                  : game === 'crossing'
                    ? `/clubs/${routeClubId}/crossing`
                    : game === 'mines'
                      ? `/clubs/${routeClubId}/mines`
                      : `/clubs/${routeClubId}/crash`
              ),
          },
        }}
      >
        <OpsReadings label="The Pool">
          <OpsReading label="Rounds" value={compactChips(pool?.rounds ?? 0)} />
          <OpsReading
            label="Diamonds Taken In"
            value={compactChips(pool?.intake_diamonds ?? 0)}
            ink="blue"
          />
          <OpsReading
            label="Chips Taken In"
            value={chips(metrics?.intake_chips)}
            meta="At The Bridge Rate"
          />
          <OpsReading label="Chips Paid To Players" value={chips(pool?.chips_paid)} ink="gold" />
          <OpsReading label="Chips Held For Open Rounds" value={chips(pool?.reserved_chips)} />
          <OpsReading label="Capped Rounds" value={compactChips(pool?.constrained_rounds ?? 0)} />
        </OpsReadings>
      </OpsCase>
    </div>
  );
}
