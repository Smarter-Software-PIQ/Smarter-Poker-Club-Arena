/**
 * EVERY DECISION UPGRADE HAS A LIVE SWITCH (2026-11-14).
 *
 * The style read live switch (HorseStyleSwitch.ts, migration 20261113201841, delivery in
 * horseDecision/styleSwitchDelivery.ts) could carry seven options. This file generalises that ONE mechanism (the
 * same table, the same 30 s main-thread read, the same STYLE_SWITCH_STATE message, the same worker inbox) so it can
 * carry any decision option REGISTERED here. It adds no second table, poller or message.
 *
 * THE REGISTRY (OPTION_SWITCH_REGISTRY) declares, per switchable option: its name, the lane that owns it, the scope
 * it acts in, the states it supports, its release default and one line of description. Only a registered option can
 * be set; the database whitelist (migration 20261114072215) is the same list, and
 * everyUpgradeHasALiveSwitch.law.test.ts fails when the two differ.
 *
 * STATES. Every option supports `off` (and clear). `on` is offered to a non-style option ONLY when its promotion
 * evidence exists (OPTION_SWITCH_EVIDENCED_ON below, HA-10878-1): a fleet-wide `on` row is the same behaviour as
 * default-on, so it needs the same evidence file, docs/horse-default-on.d/<option>.md, that
 * HorseDefaultOnNeedsEvidence.law.test.ts requires before a source default is on. Without it the option is
 * registered `off` only: the registry does not offer `on`, the parser refuses a configuration that carries it (so
 * every non-style option runs at its release default) and the database refuses to write it. `shadow` and `canary`
 * exist only for an option that has a shadow arm in the brain (today the seven style options, HorseStyleShadow.ts).
 * An option without a shadow arm cannot be put in shadow or canary: the registry does not offer it, the parser
 * rejects it and the database refuses it. The seven style options keep their own states and controls, unchanged.
 *
 * SEMANTICS. No row = the release default: the option key is NOT passed to the brain at all, so the code default
 * decides exactly as before this file existed. A row `on` passes `<option>: true`; a row `off` passes
 * `<option>: false`. So the switch can turn on what defaults off and turn off what defaults on. An empty switch
 * gives {} and every decision's options are byte-identical to before.
 *
 * FAIL SAFE: THE TWO RULES DIFFER, ON PURPOSE.
 * - The seven style options keep their rule (HorseStyleSwitch.ts, unchanged): unreadable, invalid or stale reads
 *   as OFF.
 * - Every other registered option fails safe to its RELEASE DEFAULT: unreadable, invalid or stale removes every
 *   switched value, so the code default decides. It is NOT "off": an option that is on by default must not be
 *   turned off by a database hiccup, and an option that is off by default must not stay on after one.
 *
 * NOT SWITCHABLE HERE (OPTION_SWITCH_REFUSED, optionSwitchRefusal): the eight authority-gated options, the phase
 * packs, the deep-dive discipline (Pillar 2 lives inside it), the V31 solver store (R7/R8), and anything named for
 * All-In-Or-Fold widening or a blind steal, and every option that changes a preflop range (the owner's preflop range
 * hold: v46ShortDeck, nashPushFoldIcm, huBbDefendsToPrice, facingOpenFullRingZone, committedStackPricedIn,
 * vs3BetShortStack and the heads-up opener and limp defences). They are held by separate owner rulings. The registry
 * throws at module load if one of them is ever registered.
 *
 * FLEET-WIDE ONLY. A switched option is the same for every Horse, lane, club and table: the table is keyed by the
 * option name alone and optionSwitchDecisionOpts reads nothing but the switched set.
 */
import { HORSE_FEATURE_FLAGS } from './HorseFeatureAuthority.js';
import type { HorseDecideOpts } from './HorseLogic.js';
import {
  STYLE_SWITCH_OPTIONS,
  STYLE_SWITCH_POLL_MS,
  STYLE_SWITCH_STALE_MS,
  STYLE_SWITCH_STATES,
  type StyleSwitchOption,
} from './HorseStyleSwitch.js';

/** The lanes of the Horse programme that own decision options. */
export type OptionSwitchOwner = "Hold'em Strategy" | 'Heads Up' | 'PLO Strategy' | 'PLO6';
export type OptionSwitchAnyState = 'off' | 'shadow' | 'canary' | 'on';

export interface OptionSwitchEntry {
  readonly name: string;
  readonly owner: OptionSwitchOwner;
  /** Where it acts: the "Lane / variant" column of the activation inventory (06d45e7d). */
  readonly scope: string;
  readonly states: readonly OptionSwitchAnyState[];
  /** What the code does when the option is not passed. Registering an option never changes this. */
  readonly releaseDefault: 'off' | 'on';
  /** True only where the brain has a shadow arm for the option (HorseStyleShadow.ts). */
  readonly shadowArm: boolean;
  readonly description: string;
}

const ON_OFF = Object.freeze(['off', 'on'] as const);
const OFF_ONLY = Object.freeze(['off'] as const);
const HOLDEM = "Hold'em Strategy" as const;

/**
 * HA-10878-1: the non-style options that may be switched `on`, each by exact name. An option is listed here only
 * when docs/horse-default-on.d/<option>.md exists, with the eight evidence rows, the option's name, its pull
 * request, the scope it was measured for and the head it was reviewed at. The migration lists the same names
 * (registry:evidenced-on-options markers) and everyUpgradeHasALiveSwitch.law.test.ts fails when the list, the
 * migration and the evidence directory diverge. Evidence for one option cannot unlock another. Today: none.
 */
export const OPTION_SWITCH_EVIDENCED_ON: readonly string[] = Object.freeze([]);
const evidencedOn = (name: string): boolean => OPTION_SWITCH_EVIDENCED_ON.includes(name);

/**
 * Options without a shadow arm: `off`, and `on` only with evidence. Names are checked against HorseDecideOpts at
 * compile time.
 */
const plain = <K extends keyof HorseDecideOpts & string>(
  name: K,
  owner: OptionSwitchOwner,
  scope: string,
  description: string
): OptionSwitchEntry =>
  Object.freeze({
    name,
    owner,
    scope,
    states: evidencedOn(name) ? ON_OFF : OFF_ONLY,
    releaseDefault: 'off' as const,
    shadowArm: false,
    description,
  });

const STYLE_DESCRIPTION: Readonly<Record<StyleSwitchOption, readonly [string, string]>> = {
  styleValueBettorNotManiac: [
    'NLH (not bounty), postflop call-down',
    'a value-heavy big bettor is not read as a maniac',
  ],
  styleBigBetHonesty: ['NLH turn/river big bets', 'respect for an honest big bettor'],
  styleRaiseRespect: [
    'NLH HU flop/turn raises',
    'respect for a raise from a player who rarely raises',
  ],
  styleTightReRaiserRespect: [
    'NLH preflop >25bb, not bounty',
    'tighter continuing bars against a tight opener or 3-bettor',
  ],
  styleFoldRatePreRepair: [
    'NLH cash (pre-repair rows)',
    'the legacy over-folder read stands down on a pre-repair row',
  ],
  styleValueExtraction: [
    'NLH heads-up postflop, not bounty',
    'bigger, thinner value against a caller',
  ],
  styleFoldBluff: [
    'NLH heads-up postflop, not bounty',
    "bluff frequency follows this street's fold-to-bet",
  ],
};

/**
 * THE REGISTRY. The seven style options first (unchanged: all four states, held by StyleSwitchHolder), then the
 * options the activation inventory classifies as RELEASE DEFAULT ONLY. Registering makes an option switchable; it
 * does not turn it on.
 */
export const OPTION_SWITCH_REGISTRY: readonly OptionSwitchEntry[] = Object.freeze([
  ...STYLE_SWITCH_OPTIONS.map(
    (name): OptionSwitchEntry =>
      Object.freeze({
        name,
        owner: HOLDEM,
        scope: STYLE_DESCRIPTION[name][0],
        states: STYLE_SWITCH_STATES,
        releaseDefault: 'off' as const,
        shadowArm: true,
        description: STYLE_DESCRIPTION[name][1],
      })
  ),
  plain('v16Hu', 'Heads Up', 'Heads-up postflop', 'heads-up postflop overlay'),
  plain('v16Ratio', HOLDEM, 'All (dead by precedence under V38)', 'V16 call/fold ratio rescale'),
  plain('v17RiverProbe', HOLDEM, 'River probe', 'river probe into a capped field'),
  plain('v23ShortDeck', HOLDEM, 'Short deck', 'the short-deck half of the V23 variant polish'),
  plain('v32FacingDefense', HOLDEM, 'NLH solver facing-bet defence', 'solver facing-bet defence'),
  plain('v33DepthCeiling', HOLDEM, 'NLH solver lookups >300bb', 'solver depth ceiling (300bb)'),
  plain(
    'v55OmahaRiverTripsFlat',
    'PLO Strategy',
    'Omaha river',
    'river Omaha weak sets/trips keep call pricing without re-shoving'
  ),
  plain(
    'commitUnderPot',
    'Heads Up',
    'NLH heads-up, flop/turn (cash+tourney)',
    'a priced fold under a committed pot becomes a call'
  ),
  plain('v62RiverBettorPolarity', HOLDEM, 'NLH river', "a river wager's hand is drawn by bet size"),
  plain(
    'readPostflopFoldRate',
    HOLDEM,
    'All, legacy exploit fold read',
    'the fold read uses the postflop fold-to-bet rate'
  ),
  plain(
    'readShrinkResponse',
    HOLDEM,
    'All, river-fold / fold-to-cbet reads',
    'small-sample reads shrink toward the population rate'
  ),
  plain(
    'readBreakEvenBluff',
    HOLDEM,
    'NLH + PLO4-6 postflop bluff pricing',
    'a bluff is priced against its break-even fold share'
  ),
  plain(
    'readScopedShrink',
    HOLDEM,
    'All, opponent read bucket',
    'a thin read answers from its own game scope, shrunk'
  ),
  plain(
    'omahaNeutralUnknown',
    'PLO Strategy',
    'Omaha (all), unknown opponent read',
    'an unknown Omaha opponent gets a neutral read'
  ),
]);

/** Every registered name, in registry order. */
export const OPTION_SWITCH_NAMES: readonly string[] = Object.freeze(
  OPTION_SWITCH_REGISTRY.map((e) => e.name)
);
/** The registered options held by this file's holder: every registered option that is not a style option. */
export const OPTION_SWITCH_PLAIN_REGISTRY: readonly OptionSwitchEntry[] = Object.freeze(
  OPTION_SWITCH_REGISTRY.filter(
    (e) => !(STYLE_SWITCH_OPTIONS as readonly string[]).includes(e.name)
  )
);
export const OPTION_SWITCH_PLAIN_NAMES: readonly string[] = Object.freeze(
  OPTION_SWITCH_PLAIN_REGISTRY.map((e) => e.name)
);
const PLAIN_BY_NAME: ReadonlyMap<string, OptionSwitchEntry> = new Map(
  OPTION_SWITCH_PLAIN_REGISTRY.map((e) => [e.name, e])
);

/**
 * The owner's preflop range hold: an option that changes which hands a Horse opens, defends, calls or jams with
 * preflop is not switchable here. The owner lifts the hold option by option, by name (so far only for the style
 * option styleTightReRaiserRespect, which the style switch already carried). A lift is a source change to this list
 * and to the migration whitelist, reviewed like any other.
 */
const PREFLOP_RANGE_HOLD =
  'owner hold: preflop range hold (a preflop range change; the hold is lifted by name only)';

/**
 * REFUSED BY NAME: options this switch may never carry, each with the ruling that holds it. Registering one throws
 * at module load (below) and fails everyUpgradeHasALiveSwitch.law.test.ts.
 */
export const OPTION_SWITCH_REFUSED: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(
    HORSE_FEATURE_FLAGS.map((flag) => [
      flag,
      'authority-gated: HorseFeatureAuthority (held-out cash feature pack, no selection file)',
    ])
  ),
  v53PloTourneyIcm:
    'authority-gated: HorseTournamentFlagAuthority (held-out PLO tournament cards, no selection file)',
  phase8Postflop: 'phase pack: worker-owned phase authority',
  phase8PolicyFamily: 'phase pack: worker-owned phase authority',
  phase8CatastropheGuard: 'phase pack: worker-owned phase authority',
  phase10Plo4: 'phase pack: worker-owned phase authority',
  phase11Omaha: 'phase pack: worker-owned phase authority',
  phase12Remaining: 'phase pack: worker-owned phase authority',
  phase13Joint: 'phase pack: worker-owned phase authority',
  phase14: 'phase pack: worker-owned phase authority',
  phase14Corrective: 'phase pack: worker-owned phase authority',
  v87DeepDiveDiscipline: 'owner hold: Pillar 2 lives inside the deep-dive discipline',
  v31GtoSuitAware: 'owner hold: the V31 solver store (R7/R8) is registration-gated',
  vpipFloorDeepStackOff: 'withdrawn by law: HorseWithdrawnRulesStayOff.law.test.ts (#10705)',
  omahaPreflopCallWithActionBehind:
    'withdrawn by law: HorseWithdrawnRulesStayOff.law.test.ts (#10705)',
  v87ShouldSuppressOmahaPositionStab: 'owner hold: Pillar 2',
  v46ShortDeck: PREFLOP_RANGE_HOLD,
  nashPushFoldIcm: PREFLOP_RANGE_HOLD,
  huBbDefendsToPrice: PREFLOP_RANGE_HOLD,
  facingOpenFullRingZone: PREFLOP_RANGE_HOLD,
  committedStackPricedIn: PREFLOP_RANGE_HOLD,
  vs3BetShortStack: PREFLOP_RANGE_HOLD,
  huOpenerDefendsToPrice: PREFLOP_RANGE_HOLD,
  huLimpDefendsToPrice: PREFLOP_RANGE_HOLD,
  holdemPersonaReRaiseMix: PREFLOP_RANGE_HOLD,
});

/** Name patterns of the owner's named holds, for options that do not exist yet. */
const HELD_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/pillar/i, 'owner hold: Pillar 2'],
  [/^phase\d/i, 'phase pack: worker-owned phase authority'],
  [/held[-_]?out|holdout/i, 'owner hold: held-out packs'],
  [/v31|(^|[^a-z0-9])r[78]($|[^a-z0-9])|round[78]/i, 'owner hold: R7/R8 solver rounds'],
  [/all[-_]?in[-_]?or[-_]?fold|(^|[^a-z])aof/i, 'owner hold: All-In-Or-Fold widening'],
  [/steal/i, 'owner hold: blind steal'],
];

/** Why an option may not be carried by this switch, or null when nothing holds it. */
export function optionSwitchRefusal(name: string): string | null {
  const byName = Object.hasOwn(OPTION_SWITCH_REFUSED, name) ? OPTION_SWITCH_REFUSED[name]! : null;
  if (byName) return byName;
  for (const [pattern, reason] of HELD_PATTERNS) if (pattern.test(name)) return reason;
  return null;
}

/** The registry is checked where it is declared: a held option, a duplicate or a pretended shadow arm throws. */
export function assertOptionSwitchRegistry(entries: readonly OptionSwitchEntry[]): void {
  const seen = new Set<string>();
  for (const e of entries) {
    const refusal = optionSwitchRefusal(e.name);
    if (refusal) throw new Error(`option switch: ${e.name} may not be registered (${refusal})`);
    if (seen.has(e.name)) throw new Error(`option switch: ${e.name} is registered twice`);
    seen.add(e.name);
    if (!/^[A-Za-z][A-Za-z0-9]{0,62}$/.test(e.name))
      throw new Error(`option switch: ${e.name} is not a plain option name`);
    if (!e.states.includes('off')) throw new Error(`option switch: ${e.name} must support off`);
    const style = (STYLE_SWITCH_OPTIONS as readonly string[]).includes(e.name);
    if (e.states.includes('on') && !style && !evidencedOn(e.name))
      throw new Error(
        `option switch: ${e.name} has no promotion evidence (docs/horse-default-on.d/${e.name}.md), so no on state`
      );
    const split = e.states.includes('shadow') || e.states.includes('canary');
    if (split && !e.shadowArm)
      throw new Error(`option switch: ${e.name} has no shadow arm, so no shadow or canary state`);
    if (split !== style)
      throw new Error(`option switch: only the style options carry shadow and canary (${e.name})`);
  }
}
assertOptionSwitchRegistry(OPTION_SWITCH_REGISTRY);

/** The states an option may be set to, or null when the option is not registered. */
export function optionSwitchStatesOf(name: string): readonly OptionSwitchAnyState[] | null {
  return OPTION_SWITCH_REGISTRY.find((e) => e.name === name)?.states ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// The switched values of the non-style options.
// ---------------------------------------------------------------------------------------------------------------

export type OptionSwitchValue = 'off' | 'on';
/**
 * What is switched right now: only the options that have a row, in registry order. An option not named runs at its
 * release default. {} = nothing switched.
 */
export type OptionSwitchStates = Readonly<Record<string, OptionSwitchValue>>;
export const OPTION_SWITCH_NOTHING_SWITCHED: OptionSwitchStates = Object.freeze({});

export function optionSwitchNothingSwitched(
  states: OptionSwitchStates | null | undefined
): boolean {
  return !states || Object.keys(states).length === 0;
}

/**
 * A valid switched set (registered non-style names, each in a state it supports), in registry order; null when it is
 * not one. `on` for an option without promotion evidence (HA-10878-1) makes the whole set invalid, so a row written
 * before the guard, or by a role that bypassed the set function, never acts: every non-style option then runs at its
 * release default.
 */
export function optionSwitchStatesFrom(value: unknown): OptionSwitchStates | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  for (const [k, s] of Object.entries(v)) {
    const entry = PLAIN_BY_NAME.get(k);
    if (!entry || typeof s !== 'string' || !(entry.states as readonly string[]).includes(s))
      return null;
    if (s === 'on' && !evidencedOn(k)) return null;
  }
  const out: Record<string, OptionSwitchValue> = {};
  for (const name of OPTION_SWITCH_PLAIN_NAMES)
    if (Object.hasOwn(v, name)) out[name] = v[name] as OptionSwitchValue;
  return Object.freeze(out);
}

/**
 * The configuration as fn_ca_horse_option_switch_effective answers:
 *   { version: 2, style: { version: 1, options: {...} }, options: { <option>: 'off' | 'on', ... } }
 * `style` belongs to StyleSwitchHolder and is not judged here. `options` may name registered non-style options
 * only, each in a state it supports; anything else is invalid.
 *
 * The version 1 answer of fn_ca_horse_style_switch_effective ({ version: 1, options }) is also accepted: it is what
 * the engine reads from a database that does not have the wider function yet, it carries no non-style option, and
 * so nothing is switched.
 */
export function parseOptionSwitchConfig(
  raw: unknown
): { ok: true; states: OptionSwitchStates } | { ok: false } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r).sort().join(',');
  if (keys === 'options,version' && r.version === 1)
    return r.options && typeof r.options === 'object' && !Array.isArray(r.options)
      ? { ok: true, states: OPTION_SWITCH_NOTHING_SWITCHED }
      : { ok: false };
  if (keys !== 'options,style,version' || r.version !== 2) return { ok: false };
  const states = optionSwitchStatesFrom(r.options);
  return states ? { ok: true, states } : { ok: false };
}

/** The style half of a delivered configuration: a version 2 answer carries it under `style`. */
export function styleConfigOf(raw: unknown): unknown {
  return raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    (raw as { version?: unknown }).version === 2
    ? (raw as { style?: unknown }).style
    : raw;
}

export type OptionSwitchReading =
  | { kind: 'absent' }
  | { kind: 'present'; raw: unknown; receivedAtMs: number };
export type OptionSwitchSource = (nowMs: number) => OptionSwitchReading;
export const ABSENT_OPTION_SWITCH_SOURCE: OptionSwitchSource = () => ({ kind: 'absent' });

/** Replay: serves the recorded switched set as received now (it never ages inside a replay). */
export function optionSwitchSourceFromStates(
  states: OptionSwitchStates | null | undefined
): OptionSwitchSource {
  if (optionSwitchNothingSwitched(states)) return ABSENT_OPTION_SWITCH_SOURCE;
  const options = { ...states };
  return (nowMs) => ({
    kind: 'present',
    raw: { version: 2, style: { version: 1, options: {} }, options },
    receivedAtMs: nowMs,
  });
}

const RECEIPT = 'option_switch';

/**
 * The per-process holder of the non-style options. Same cadence and the same strict 120 s staleness as
 * StyleSwitchHolder (one read per STYLE_SWITCH_POLL_MS, a configuration older than STYLE_SWITCH_STALE_MS stops at
 * the next refresh). THE DIFFERENCE: every failure (unreadable, invalid, stale) leaves NOTHING SWITCHED, which is
 * every option at its release default, not every option off. Never throws.
 *
 * Receipts: option_switch_<option>_<on|off|default>_seen when an option's switched value changes (`default`: its
 * row went away or the configuration failed), and option_switch_config_unreadable_seen / _invalid_seen /
 * _stale_seen.
 */
export class OptionSwitchHolder {
  private states: OptionSwitchStates = OPTION_SWITCH_NOTHING_SWITCHED;
  private readAt = Number.NEGATIVE_INFINITY;
  private receivedAt: number | null = null;

  constructor(
    private readonly source: OptionSwitchSource,
    private readonly note: (feature: string) => void,
    private readonly pollMs: number = STYLE_SWITCH_POLL_MS
  ) {}

  refresh(nowMs: number): OptionSwitchStates {
    if (!(nowMs - this.readAt < this.pollMs) || nowMs < this.readAt) {
      this.readAt = nowMs;
      let next: OptionSwitchStates = OPTION_SWITCH_NOTHING_SWITCHED;
      let receivedAt: number | null = null;
      try {
        const reading = this.source(nowMs);
        if (reading?.kind === 'absent') next = OPTION_SWITCH_NOTHING_SWITCHED;
        else if (
          reading?.kind === 'present' &&
          (typeof reading.receivedAtMs !== 'number' || !Number.isFinite(reading.receivedAtMs))
        )
          this.note('option_switch_config_invalid_seen');
        else if (
          reading?.kind === 'present' &&
          !(nowMs - reading.receivedAtMs <= STYLE_SWITCH_STALE_MS)
        )
          this.note('option_switch_config_stale_seen');
        else if (reading?.kind === 'present') {
          const parsed = parseOptionSwitchConfig(reading.raw);
          if (parsed.ok) {
            next = parsed.states;
            receivedAt = reading.receivedAtMs;
          } else this.note('option_switch_config_invalid_seen');
        } else this.note('option_switch_config_invalid_seen');
      } catch {
        this.note('option_switch_config_unreadable_seen');
      }
      this.apply(next, receivedAt);
    }
    if (this.receivedAt !== null && !(nowMs - this.receivedAt <= STYLE_SWITCH_STALE_MS)) {
      this.note('option_switch_config_stale_seen');
      this.apply(OPTION_SWITCH_NOTHING_SWITCHED, null);
    }
    return this.states;
  }

  private apply(next: OptionSwitchStates, receivedAt: number | null): void {
    for (const name of OPTION_SWITCH_PLAIN_NAMES) {
      const was = this.states[name] ?? 'default';
      const now = next[name] ?? 'default';
      if (was !== now) this.note(`${RECEIPT}_${name}_${now}_seen`);
    }
    this.states = next;
    this.receivedAt = optionSwitchNothingSwitched(next) ? null : receivedAt;
  }

  current(): OptionSwitchStates {
    return this.states;
  }
}

/**
 * The decision options a switched set gives EVERY Horse alike (no Horse id is read: only a style canary splits
 * Horses): `<option>: true` for on (only for an option with promotion evidence, OPTION_SWITCH_EVIDENCED_ON),
 * `<option>: false` for off, nothing for an option without a row. Nothing switched gives {}.
 */
export function optionSwitchDecisionOpts(
  states: OptionSwitchStates | null | undefined
): Readonly<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  if (states)
    for (const name of OPTION_SWITCH_PLAIN_NAMES)
      if (states[name] === 'on' && evidencedOn(name)) out[name] = true;
      else if (states[name] === 'off') out[name] = false;
  return out;
}
