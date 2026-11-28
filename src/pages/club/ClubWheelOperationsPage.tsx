/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DIAMOND WHEEL - the operator's console
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * What a union owner (or a standalone club's owner) needs to run the wheel and
 * nothing else: turn it on and off, set the spin price, set the exposure
 * allowance (the most the host accepts being ahead of what the wheel has taken
 * in), the diamond seed the prize float starts from, the per-player caps, and
 * READ the numbers that say whether the wheel is doing what the odds table
 * promises - realised return against the 80 percent spec as a z-score, the
 * lock rate, the exposure headroom, and the invariant (paid <= taken in +
 * allowance) that the arithmetic makes impossible to break and
 * fn_wheel_metrics re-derives anyway. AMENDED 2026-09-10: nothing is minted
 * any more. The diamonds a spin takes in are the host owner's, and every chip
 * the wheel pays leaves the host's promo wallet, which is why that wallet and
 * the owner's diamonds are the two figures at the top of this page.
 *
 * THE FREE SPIN (2026-09-09) has its own console here: the switch and the
 * budget and window post to fn_wheel_set_welcome_spin, the count and what the
 * window has paid come from fn_wheel_welcome_state. It pays out of the
 * owner's own balance, so it never touches the promo wallet, the exposure or
 * the invariant printed above it.
 *
 * Every control posts a patch to fn_wheel_set_config, which decides who may:
 * fn_wheel_can_operate (union owner, co-owner or admin through
 * fn_union_can_manage_wallets; a standalone club's owner, co_owner or admin;
 * platform management). The page shows a refusal, it never pre-empts one.
 *
 * THE PICTURE (#SmarterDesign, Dan 2026-11-27). The arena workspace: the
 * chrome mast with the club's name, the live figures as chrome meters, then
 * thin chrome cases for the readings, the promo wallet, the settled play, the
 * controls (dark wells, Close / Open and Save as chrome keys), the welcome spin
 * and the lifetime pool. No painted plates.
 *
 * Route: /clubs/:clubId/wheel-operations, finance access in the operations
 * registry. The player's page is /clubs/:clubId/wheel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import DiamondSpinsOwnerTerms from '../../components/games/DiamondSpinsOwnerTerms';
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
import DiamondWheelService, {
  type WheelConfigPatch,
  type WheelWelcomePatch,
  type WheelWelcomeState,
  type WheelMetrics,
} from '../../services/DiamondWheelService';
import DiamondGamesService from '../../services/DiamondGamesService';
import { compactChips, formatWalletChips, formatWalletDiamonds } from '../../utils/format';
import { resolveClubUUID } from '../../utils/clubIdResolver';
import { reportError } from '../../utils/errorReporter';
import DiamondGamesMoney from '../../components/club/DiamondGamesMoney';
import { uuid } from '../../utils/uuid';
import { useIsMounted } from '../../hooks/useIsMounted';

const chips = (n: number | null | undefined) => compactChips(Number(n ?? 0));
const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? 'N/A' : `${Math.round(n * 100)}%`;

interface Draft {
  spin_price_diamonds: string;
  exposure_allowance_chips: string;
  diamond_seed: string;
  min_seconds_between_spins: string;
  allow_fixture_accounts: boolean;
  welcome_budget_chips: string;
  welcome_budget_period_days: string;
}

function draftFrom(m: WheelMetrics | null): Draft {
  const c = m?.config;
  return {
    spin_price_diamonds: String(c?.spin_price_diamonds ?? 100),
    exposure_allowance_chips: String(c?.exposure_allowance_chips ?? 500),
    diamond_seed: String(c?.diamond_seed ?? 2500),
    min_seconds_between_spins: String(c?.min_seconds_between_spins ?? 3),
    allow_fixture_accounts: c?.allow_fixture_accounts ?? false,
    welcome_budget_chips: String(c?.welcome_budget_chips ?? 0),
    welcome_budget_period_days: String(c?.welcome_budget_period_days ?? 30),
  };
}

export default function ClubWheelOperationsPage() {
  const { clubId: routeClubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const isMountedRef = useIsMounted();
  const clubName = useArenaClubName();

  const [clubUuid, setClubUuid] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<WheelMetrics | null>(null);
  const [welcome, setWelcome] = useState<WheelWelcomeState | null>(null);
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

  const load = useCallback(async () => {
    if (!routeClubId) return;
    setLoading(true);
    setError(null);
    try {
      const uuid = await resolveClubUUID(routeClubId);
      if (!isMountedRef.current) return;
      setClubUuid(uuid);
      const [m, f] = await Promise.all([
        DiamondWheelService.metrics(uuid),
        DiamondWheelService.welcomeState(uuid).catch((err) => {
          reportError(err, 'ClubWheelOperationsPage.welcome');
          return null;
        }),
      ]);
      if (!isMountedRef.current) return;
      if (!m.ok) {
        setError(m.error || 'The Wheel Readings Could Not Be Loaded');
        return;
      }
      setMetrics(m);
      setWelcome(f);
      setDraft(draftFrom(m));
    } catch (err) {
      reportError(err, 'ClubWheelOperationsPage.load');
      if (isMountedRef.current) setError('The Wheel Readings Could Not Be Loaded');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [routeClubId, isMountedRef]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = useCallback(
    async (patch: WheelConfigPatch, done: string) => {
      if (!clubUuid) return;
      setSaving(true);
      try {
        const res = await DiamondWheelService.setConfig(clubUuid, patch);
        if (!isMountedRef.current) return;
        if (!res.ok) {
          toast.error(res.error || 'That Change Was Refused');
          return;
        }
        toast.success(done);
        await load();
      } catch (err) {
        reportError(err, 'ClubWheelOperationsPage.apply');
        if (isMountedRef.current) toast.error('That Change Did Not Go Through');
      } finally {
        if (isMountedRef.current) setSaving(false);
      }
    },
    [clubUuid, isMountedRef, toast, load]
  );

  const applyWelcome = useCallback(
    async (patch: WheelWelcomePatch, done: string) => {
      if (!clubUuid) return;
      setSaving(true);
      try {
        const res = await DiamondWheelService.setWelcomeSpin(clubUuid, patch);
        if (!isMountedRef.current) return;
        if (!res.ok) {
          toast.error(res.error || 'That Change Was Refused');
          return;
        }
        toast.success(done);
        await load();
      } catch (err) {
        reportError(err, 'ClubWheelOperationsPage.applyWelcome');
        if (isMountedRef.current) toast.error('That Change Did Not Go Through');
      } finally {
        if (isMountedRef.current) setSaving(false);
      }
    },
    [clubUuid, isMountedRef, toast, load]
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
          await load();
        }
      } catch (err) {
        // No answer came back, so nobody knows whether the chips moved. The key
        // is deliberately kept: the next press is the same intent, not a new one,
        // and the server will either carry it out or report it as a replay.
        //
        // The first cut of this said the chips had not moved, which is a claim
        // nobody here is in a position to make, printed over numbers that were
        // never rechecked. The console rereads and lets the wallet answer.
        reportError(err, 'ClubWheelOperationsPage.fundPromo', { clubId: clubUuid });
        if (!isMountedRef.current) return;
        toast.error('No Answer Came Back. The Numbers Below Are Rechecked');
        await load();
      } finally {
        if (isMountedRef.current) setFunding(false);
      }
    },
    [clubUuid, isMountedRef, toast, load]
  );

  const saveWelcomeBudget = () => {
    const budget = Number(draft.welcome_budget_chips);
    if (!Number.isFinite(budget) || budget < 0)
      return toast.error('The Welcome Budget Must Be Zero Or More Chips');
    const days = Number(draft.welcome_budget_period_days);
    if (!Number.isInteger(days) || days < 0)
      return toast.error('The Window Must Be A Whole Number Of Days, Or Zero');
    void applyWelcome(
      { welcome_budget_chips: budget, welcome_budget_period_days: days },
      'The Welcome Budget Is Saved'
    );
  };

  const saveNumbers = () => {
    const price = Number(draft.spin_price_diamonds);
    const allowance = Number(draft.exposure_allowance_chips);
    const seed = Number(draft.diamond_seed);
    const gap = Number(draft.min_seconds_between_spins);
    if (!Number.isInteger(price) || price <= 0)
      return toast.error('The Spin Price Must Be A Whole Number Of Diamonds');
    if (!Number.isFinite(allowance) || allowance < 0)
      return toast.error('The Exposure Allowance Must Be Zero Or More');
    if (!Number.isInteger(seed) || seed < 0)
      return toast.error('The Diamond Seed Must Be A Whole Number Of Diamonds');
    if (!Number.isInteger(gap) || gap < 0)
      return toast.error('The Pause Between Spins Must Be Zero Or More Seconds');
    void apply(
      {
        spin_price_diamonds: price,
        exposure_allowance_chips: Math.round(allowance * 100) / 100,
        diamond_seed: seed,
        min_seconds_between_spins: gap,
        allow_fixture_accounts: draft.allow_fixture_accounts,
      },
      'Wheel Settings Saved'
    );
  };

  const back = () => navigate(`/clubs/${routeClubId}/operations`);
  const mast = (
    <>
      <OpsBack onClick={back} />
      <ArenaWorkspaceHeader
        area="finance"
        title="Diamond Wheel"
        context={clubName}
        subtitle="Wheel Operations"
        summary="Open And Close The Diamond Wheel, Set Its Price, Cover And Welcome Spin, And Read Whether It Pays What Its Odds Promise."
      />
    </>
  );

  if (loading) {
    return (
      <div className="arena-workspace dops-page">
        {mast}
        <section className="arena-case arena-ops-case">
          <ArenaState tone="loading" title="Reading The Wheel" />
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
              <button type="button" onClick={() => void load()}>
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
  const enabled = Boolean(cfg?.enabled);
  const promoDry = (metrics?.promo_chips ?? 0) <= 0;
  const welcomeOn = Boolean(cfg?.welcome_spin_enabled);
  /* The window the budget is spent against, said in words rather than a number
     an operator has to interpret. Zero is a lifetime budget, not a zero-day one. */
  const windowWord =
    (welcome?.budget_period_days ?? 0) > 0
      ? `Chips From The Promo Wallet, In The Last ${welcome?.budget_period_days} Days`
      : 'Chips From The Promo Wallet, All Time';
  const hostWord = metrics?.host_kind === 'union' ? 'Union' : 'Club';
  const set = (key: keyof Draft) => (v: string) => setDraft((d) => ({ ...d, [key]: v }));

  return (
    <div className="arena-workspace dops-page">
      {mast}
      <PageBar
        title="Diamond Wheel"
        titleAs={false}
        showHelp={false}
        status={enabled ? 'The Wheel Is Open' : 'The Wheel Is Closed'}
        statusTone={enabled ? 'live' : 'danger'}
        metrics={[
          { label: 'Cover', value: chips(metrics?.cover_chips) },
          {
            label: 'Promo Wallet',
            value: formatWalletChips(metrics?.promo_chips),
            tone: promoDry ? 'attention' : 'live',
          },
          { label: 'Owner Diamonds', value: formatWalletDiamonds(metrics?.owner_diamonds ?? 0) },
          {
            label: 'Invariant',
            value: metrics?.invariant_ok === false ? 'Broken' : 'Holds',
            tone: metrics?.invariant_ok === false ? 'attention' : 'live',
          },
        ]}
      />

      <DiamondSpinsOwnerTerms clubId={clubUuid} />

      <OpsCase
        eyebrow="Operations"
        title="Wheel Readings"
        titleId="wheel-ops-title"
        pill={enabled ? 'Open' : 'Closed'}
        pillInk={enabled ? 'green' : 'red'}
      >
        <OpsReadings label="Wheel Readings">
          <OpsReading
            label="Cover"
            value={chips(metrics?.cover_chips)}
            ink={(metrics?.cover_chips ?? 0) <= 0 ? 'red' : 'silver'}
            meta={`${formatWalletChips(metrics?.promo_chips)} Promo Plus ${formatWalletChips(metrics?.bank_chips)} Bank`}
          />
          <OpsReading
            label={`${hostWord} Promo Wallet`}
            value={formatWalletChips(metrics?.promo_chips)}
            ink={(metrics?.promo_chips ?? 0) <= 0 ? 'gold' : 'silver'}
            meta={
              (metrics?.promo_chips ?? 0) <= 0
                ? `Empty, So The ${hostWord} Bank Is Paying The Prizes`
                : 'Every Chip Prize Is Paid From Here First'
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
            meta="Where The Diamonds Taken In Land, And Where Diamond Prizes Come From"
          />
          <OpsReading
            label="Exposure"
            value={chips(metrics?.exposure_chips)}
            ink={(metrics?.exposure_chips ?? 0) > 0 ? 'gold' : 'silver'}
            meta={`Room ${chips(metrics?.exposure_headroom_chips)}`}
          />
          <OpsReading
            label="House Take"
            value={chips(metrics?.house_take_lifetime_chips)}
            ink="gold"
            meta="Chips"
          />
          <OpsReading
            label="Lock Rate"
            value={pct(metrics?.lock_rate)}
            meta="Spins With A Tier Off The Table"
          />
          <OpsReading
            label="Invariant"
            value={metrics?.invariant_ok === false ? 'Broken' : 'Holds'}
            ink={metrics?.invariant_ok === false ? 'red' : 'green'}
            meta="Paid Against Taken In"
          />
        </OpsReadings>
        <p className="arena-ops-copy">
          Paid Never Exceeds What Was Taken In Plus The Allowance, And Every Chip Leaves The Promo
          Wallet Before The Bank; The Per-Spin Gate Makes That Arithmetic, And The Metrics Re-Derive
          It. A Locked Tier Is One The Cover Could Not Pay On That Spin.
        </p>
      </OpsCase>

      {/* THE FLOAT, AND WHERE TO PUT IT (Dan 2026-09-10). The bank backs the
          promo wallet on its own, so the games never stop; this is how an
          operator moves the float to where it is meant to sit, without leaving
          the console they are already reading. */}
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
          Every Chip Prize Leaves The Promo Wallet First. When It Runs Dry The {hostWord} Bank Pays
          The Rest, So The Games Never Stop; The Journal Names Which Wallet Paid Which Part. Keep
          The Float Here And The Bank Stays A Backstop Rather Than A Habit.
        </p>
        <OpsReadings label="The Promo Wallet">
          <OpsReading
            label="Cover"
            value={chips(metrics?.cover_chips)}
            ink={(metrics?.cover_chips ?? 0) <= 0 ? 'red' : 'silver'}
            meta="What A Prize May Draw On"
          />
          <OpsReading
            label="Promo Wallet"
            value={formatWalletChips(metrics?.promo_chips)}
            ink={promoDry ? 'gold' : 'green'}
            meta={promoDry ? 'Empty: The Bank Is Carrying The Games' : 'Paid First'}
          />
          <OpsReading
            label={`${hostWord} Bank`}
            value={formatWalletChips(metrics?.bank_chips)}
            ink={(metrics?.bank_chips ?? 0) <= 0 ? 'red' : 'blue'}
            meta="The Backstop"
          />
        </OpsReadings>
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

      <OpsCase eyebrow="Settled Play" title="Game Activity">
        <OpsTable label="Game Activity" head={['Window', 'Spins', 'Chips Paid', 'Review']}>
          {(metrics?.windows ?? []).map((w) => (
            <OpsTableRow key={w.window}>
              <OpsCell
                ink={w.drift ? 'red' : 'silver'}
                meta={`In ${chips(w.intake_chips)}, Out ${chips(w.paid_chips)}${
                  w.constrained ? `, ${compactChips(w.constrained)} Locked` : ''
                }`}
              >
                {w.window.toUpperCase()}
              </OpsCell>
              <OpsCell>{compactChips(w.spins)}</OpsCell>
              <OpsCell ink={w.drift ? 'red' : 'silver'}>{chips(w.paid_chips)}</OpsCell>
              <OpsCell ink={w.drift ? 'red' : 'muted'}>{w.drift ? 'Review' : 'Clear'}</OpsCell>
            </OpsTableRow>
          ))}
        </OpsTable>
        <p className="arena-ops-copy">
          Review Highlights Activity That Needs An Operator Check. Intake And Paid Chips Come From
          The Settled Game Records.
        </p>
      </OpsCase>

      <OpsCase
        eyebrow={`The Wheel Is ${enabled ? 'Open' : 'Closed'}`}
        title="Controls"
        plates={{
          secondary: {
            label: enabled ? 'Close The Wheel' : 'Open The Wheel',
            ink: enabled ? 'red' : 'gold',
            disabled: saving,
            onClick: () =>
              void apply(
                { enabled: !enabled },
                enabled ? 'The Wheel Is Closed' : 'The Wheel Is Open'
              ),
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
            ? 'Closing It Refuses The Next Spin At Once.'
            : 'Nobody Can Spin Until You Open It.'}
        </p>
        <OpsFields>
          <OpsField
            label="Spin Price (Diamonds)"
            value={draft.spin_price_diamonds}
            onChange={set('spin_price_diamonds')}
            hint="A Multiple Of 100. Prizes Scale With It."
          />
          <OpsField
            label="Exposure Allowance (Chips)"
            mode="decimal"
            value={draft.exposure_allowance_chips}
            onChange={set('exposure_allowance_chips')}
            hint="The Most The Wheel May Pay Beyond What It Has Taken In."
          />
          <OpsField
            label="Diamond Seed (Diamonds)"
            value={draft.diamond_seed}
            onChange={set('diamond_seed')}
            hint="The Float The Diamond Prizes Start From, So No Tier Opens Locked."
          />

          <OpsField
            label="Seconds Between Spins"
            value={draft.min_seconds_between_spins}
            onChange={set('min_seconds_between_spins')}
          />

          <OpsToggle
            label="Allow Certification Accounts"
            hint="For Burn-In Only. Their Spins Are Kept Out Of The Fairness Statistics."
            on={draft.allow_fixture_accounts}
            onToggle={() =>
              setDraft((d) => ({ ...d, allow_fixture_accounts: !d.allow_fixture_accounts }))
            }
          />
        </OpsFields>
      </OpsCase>

      <OpsCase
        eyebrow="On The Club"
        title="The Welcome Spin"
        pill={welcomeOn ? 'On' : 'Off'}
        pillInk={welcomeOn ? 'green' : 'red'}
        plates={{
          secondary: {
            label: welcomeOn ? 'Turn It Off' : 'Turn It On',
            ink: welcomeOn ? 'red' : 'gold',
            disabled: saving,
            onClick: () =>
              void applyWelcome(
                { welcome_spin_enabled: !welcomeOn },
                welcomeOn ? 'The Welcome Spin Is Off' : 'The Welcome Spin Is On'
              ),
          },
          primary: {
            label: saving ? 'Saving' : 'Save The Budget',
            ink: 'white',
            onClick: saveWelcomeBudget,
            disabled: saving,
          },
        }}
      >
        <p className="arena-ops-copy">
          Every New Member May Take One Spin On The Real Wheel, Once, On The Club. You Take No
          Diamonds In For It, And Whatever It Pays Comes Out Of The Promo Wallet. The Budget Is The
          Most The Welcome Spins May Cost You Inside The Window, And The Window Slides: Spend Older
          Than It Stops Counting, So The Budget Comes Back On Its Own. A Welcome Spin Is The Whole
          Wheel Or It Is Not Offered, So When What Is Left Can No Longer Cover The Top Prize The
          Offer Closes Rather Than Handing A New Member A Wheel With Its Best Tiers Locked.
          {enabled ? '' : ' The Wheel Is Closed, So The Welcome Spin Is Closed With It.'}
        </p>
        <OpsReadings label="The Welcome Spin">
          <OpsReading
            label="Welcome Spins Given"
            value={compactChips(welcome?.welcome_spins ?? 0)}
            meta={`Each One Is A ${compactChips(welcome?.spin_price_diamonds ?? 0)} Diamond Spin You Did Not Charge For`}
          />
          <OpsReading
            label="Budget Spent"
            value={`${compactChips(welcome?.budget_paid_chips ?? 0)} Of ${compactChips(welcome?.budget_chips ?? 0)}`}
            ink={welcome?.reason === 'pot_empty' || welcome?.reason === 'unfunded' ? 'red' : 'blue'}
            meta={
              welcome?.reason === 'unfunded'
                ? 'Set A Budget And The Welcome Spin Opens'
                : welcome?.reason === 'pot_empty'
                  ? 'What Is Left Cannot Cover The Top Prize, So The Offer Is Closed'
                  : windowWord
            }
          />
          <OpsReading
            label="Top Prize"
            value={compactChips(welcome?.top_prize_chips ?? 0)}
            meta="What The Window Must Be Able To Cover Before A Spin Is Offered"
          />
          <OpsReading
            label="Given Away, All Time"
            value={compactChips(welcome?.lifetime_chips_paid ?? 0)}
            meta="Across Every Window, Since The Welcome Spin Opened"
          />
        </OpsReadings>
        <OpsFields>
          <OpsField
            label="Welcome Budget (Chips)"
            mode="decimal"
            value={draft.welcome_budget_chips}
            onChange={set('welcome_budget_chips')}
            hint="Zero Closes The Welcome Spin Without Turning It Off."
          />
          <OpsField
            label="Budget Window (Days)"
            value={draft.welcome_budget_period_days}
            onChange={set('welcome_budget_period_days')}
            hint="The Budget Is Spent Per Window And Comes Back As Spend Ages Out. Zero Means It Never Turns."
          />
        </OpsFields>
      </OpsCase>

      <DiamondGamesMoney clubId={clubUuid} />

      <OpsCase
        eyebrow="Lifetime"
        title="The Pool"
        plates={{
          secondary: {
            label: 'Games Console',
            onClick: () => navigate(`/clubs/${routeClubId}/diamond-games-operations`),
          },
          primary: {
            label: 'Players Wheel',
            ink: 'white',
            onClick: () => navigate(`/clubs/${routeClubId}/wheel`),
          },
        }}
      >
        <OpsReadings label="The Pool">
          <OpsReading label="Spins" value={compactChips(pool?.spins ?? 0)} />
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
          <OpsReading
            label="Chips Paid To Players"
            value={chips(pool?.chips_paid)}
            ink="gold"
            meta="Out Of The Promo Wallet"
          />
          <OpsReading
            label="Diamond Prize Float"
            value={compactChips(Math.floor(pool?.diamond_float ?? 0))}
            ink="blue"
          />
          <OpsReading
            label="Diamonds Paid As Prizes"
            value={compactChips(pool?.diamonds_paid ?? 0)}
          />
        </OpsReadings>
      </OpsCase>
    </div>
  );
}
