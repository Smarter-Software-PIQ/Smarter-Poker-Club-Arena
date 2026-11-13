/**
 * STYLE READ LIVE SWITCH (2026-11-13). Each style option has a runtime state: off, shadow, canary or on.
 *
 * - The SOURCE DEFAULT is off for every option (STYLE_SWITCH_SOURCE_DEFAULT). It wins whenever no runtime
 *   configuration is present.
 * - A runtime configuration is read through a StyleSwitchSource at most once per STYLE_SWITCH_POLL_MS (the 60 s
 *   cadence of the existing runtime policy read, HorseFleetPolicy POLICY_TTL_MS), so a switch-off takes effect at
 *   the first decision after the next read, within one poll interval.
 * - A configuration that cannot be read, or that is not exactly the documented shape, FAILS SAFE TO OFF for every
 *   option (unlike the fleet policy, which fails open: a style option that cannot be confirmed stays off).
 * - Every state change of an option fires style_switch_<option>_<state>_seen (the option and the new state are in the
 *   receipt name; brain telemetry carries counters only).
 *
 * WHERE THE CONFIGURATION COMES FROM: no existing runtime configuration path carries a per-option state (the fleet
 * policy RPC has fixed fields and fails open; the feature and phase authorities are selected at a protected release
 * and never read a database row). The table ca_horse_style_switch and the read fn_ca_horse_style_switch_effective
 * (migration 20261113201841) carry it; the main thread reads them and delivers the configuration to every worker
 * (horseDecision/styleSwitchDelivery.ts). A worker that has been delivered nothing reports `absent`, so the source
 * default (off) holds.
 *
 * CANARY: 'canary' is on for the Horses whose stable bucket (sha256 of `style-canary-v1:` + the lower-cased Horse
 * id, first 32 bits, modulo 10) is 0, about one Horse in ten, and shadow for every other Horse. The bucket is fixed
 * by the Horse id alone, so it is deterministic across processes and restarts. This is the one recorded exception
 * to "one effective configuration for all Horses", and it exists only while an option is in canary.
 */
import { createHash } from 'node:crypto';

export const STYLE_SWITCH_OPTIONS = [
  'styleValueBettorNotManiac',
  'styleBigBetHonesty',
  'styleRaiseRespect',
  'styleTightReRaiserRespect',
  'styleFoldRatePreRepair',
  'styleValueExtraction',
  'styleFoldBluff',
] as const;
export type StyleSwitchOption = (typeof STYLE_SWITCH_OPTIONS)[number];
export const STYLE_SWITCH_STATES = ['off', 'shadow', 'canary', 'on'] as const;
export type StyleSwitchState = (typeof STYLE_SWITCH_STATES)[number];
export type StyleSwitchStates = Readonly<Record<StyleSwitchOption, StyleSwitchState>>;

/** The source default: every option off. */
export const STYLE_SWITCH_SOURCE_DEFAULT: StyleSwitchStates = Object.freeze(
  Object.fromEntries(STYLE_SWITCH_OPTIONS.map((o) => [o, 'off'])) as Record<
    StyleSwitchOption,
    StyleSwitchState
  >
);
const ALL_OFF = STYLE_SWITCH_SOURCE_DEFAULT;

/** The receipt family of state changes: style_switch_<option>_<state>_seen. */
const STYLE_SWITCH_RECEIPT = 'style_switch';

/** The existing runtime policy cadence (HorseFleetPolicy POLICY_TTL_MS): one read per minute at most. */
export const STYLE_SWITCH_POLL_MS = 60_000;

/**
 * L1 (review 64466c83): a configuration delivered longer ago than two poll intervals is stale and fails safe to off,
 * exactly as an unreadable one. The age is measured on the holder's own (monotonic) clock: the source reports when it
 * received the configuration (receivedAtMs) on that clock.
 */
export const STYLE_SWITCH_STALE_MS = 2 * STYLE_SWITCH_POLL_MS;

/** The canary arm: bucket 0 of 10, from the Horse id alone. */
export const STYLE_CANARY_SALT = 'style-canary-v1:';
export const STYLE_CANARY_BUCKETS = 10;
export const STYLE_CANARY_ON_BUCKET = 0;

export function styleCanaryBucket(horseId: string): number {
  const h = createHash('sha256')
    .update(STYLE_CANARY_SALT + String(horseId).toLowerCase())
    .digest();
  return h.readUInt32BE(0) % STYLE_CANARY_BUCKETS;
}

/**
 * The documented configuration shape: { version: 1, options: { <option>: <state>, ... } }. Options not named keep
 * the source default. Anything else (an unknown option, an unknown state, extra keys, another version) is invalid.
 */
export function parseStyleSwitchConfig(
  raw: unknown
): { ok: true; states: StyleSwitchStates } | { ok: false } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r).sort().join(',');
  if (keys !== 'options,version' || r.version !== 1) return { ok: false };
  const o = r.options;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false };
  const states: Record<string, StyleSwitchState> = { ...STYLE_SWITCH_SOURCE_DEFAULT };
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (!(STYLE_SWITCH_OPTIONS as readonly string[]).includes(k)) return { ok: false };
    if (!(STYLE_SWITCH_STATES as readonly unknown[]).includes(v)) return { ok: false };
    states[k] = v as StyleSwitchState;
  }
  return { ok: true, states: Object.freeze(states) as StyleSwitchStates };
}

/** What a source returns: no configuration on file, or the raw configuration to validate. A throw is unreadable. */
/**
 * A present reading MUST say when it was received, on the holder's own (monotonic) clock: a reading without
 * receivedAtMs is invalid and fails safe to off (review f8948093: staleness is strict, not optional).
 */
export type StyleSwitchReading =
  | { kind: 'absent' }
  | { kind: 'present'; raw: unknown; receivedAtMs: number };
/** The source is asked with the holder's clock, so a source that serves a stored value can stamp it. */
export type StyleSwitchSource = (nowMs: number) => StyleSwitchReading;

/** The production source until the configuration table lands (design note): nothing on file, the default holds. */
export const ABSENT_STYLE_SWITCH_SOURCE: StyleSwitchSource = () => ({ kind: 'absent' });

/**
 * A source that serves recorded states (M3: replay restores the switch state a decision was journaled with). null or
 * all off serves absent, the source default.
 */
export function styleSwitchSourceFromStates(
  states: StyleSwitchStates | null | undefined
): StyleSwitchSource {
  if (!states || styleSwitchStatesAreDefault(states)) return ABSENT_STYLE_SWITCH_SOURCE;
  const options = Object.fromEntries(STYLE_SWITCH_OPTIONS.map((o) => [o, states[o]]));
  // replay: the recorded state is served as received now (it never ages inside a replay)
  return (nowMs) => ({ kind: 'present', raw: { version: 1, options }, receivedAtMs: nowMs });
}

/** True when every option is at the source default (off). */
export function styleSwitchStatesAreDefault(states: StyleSwitchStates): boolean {
  return STYLE_SWITCH_OPTIONS.every((o) => states[o] === STYLE_SWITCH_SOURCE_DEFAULT[o]);
}

/** A complete recorded state set (all seven options, valid states, nothing else), or null. */
export function styleSwitchStatesFrom(value: unknown): StyleSwitchStates | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== [...STYLE_SWITCH_OPTIONS].sort().join(',')) return null;
  for (const o of STYLE_SWITCH_OPTIONS)
    if (!(STYLE_SWITCH_STATES as readonly unknown[]).includes(v[o])) return null;
  return Object.freeze({ ...v }) as StyleSwitchStates;
}

/**
 * The per-process holder. refresh(now) re-reads the source when the last read is STYLE_SWITCH_POLL_MS old or older,
 * or when the clock went backwards (L2: callers pass a monotonic clock; a step back is treated as due, never as a
 * freeze); between reads the last result stands. STRICT STALENESS: at EVERY refresh, not only at a read, a
 * configuration received more than STYLE_SWITCH_STALE_MS ago turns every option off, so no state outlives its
 * delivery by more than 120 s. Never throws.
 */
export class StyleSwitchHolder {
  private states: StyleSwitchStates = STYLE_SWITCH_SOURCE_DEFAULT;
  private readAt = Number.NEGATIVE_INFINITY;
  /** when the configuration now in force was received (null: none in force, the default holds) */
  private receivedAt: number | null = null;

  constructor(
    private readonly source: StyleSwitchSource,
    private readonly note: (feature: string) => void,
    private readonly pollMs: number = STYLE_SWITCH_POLL_MS
  ) {}

  refresh(nowMs: number): StyleSwitchStates {
    if (!(nowMs - this.readAt < this.pollMs) || nowMs < this.readAt) {
      this.readAt = nowMs;
      let next: StyleSwitchStates = ALL_OFF;
      let receivedAt: number | null = null;
      try {
        const reading = this.source(nowMs);
        if (reading?.kind === 'absent') next = STYLE_SWITCH_SOURCE_DEFAULT;
        else if (
          reading?.kind === 'present' &&
          (typeof reading.receivedAtMs !== 'number' || !Number.isFinite(reading.receivedAtMs))
        )
          this.note('style_switch_config_invalid_seen');
        else if (
          reading?.kind === 'present' &&
          !(nowMs - reading.receivedAtMs <= STYLE_SWITCH_STALE_MS)
        )
          this.note('style_switch_config_stale_seen');
        else if (reading?.kind === 'present') {
          const parsed = parseStyleSwitchConfig(reading.raw);
          if (parsed.ok) {
            next = parsed.states;
            receivedAt = reading.receivedAtMs;
          } else this.note('style_switch_config_invalid_seen');
        } else this.note('style_switch_config_invalid_seen');
      } catch {
        this.note('style_switch_config_unreadable_seen');
      }
      this.apply(next, receivedAt);
    }
    // strict: a configuration that aged past the stale bound between reads stops now, not at the next read
    if (this.receivedAt !== null && !(nowMs - this.receivedAt <= STYLE_SWITCH_STALE_MS)) {
      this.note('style_switch_config_stale_seen');
      this.apply(ALL_OFF, null);
    }
    return this.states;
  }

  private apply(next: StyleSwitchStates, receivedAt: number | null): void {
    for (const o of STYLE_SWITCH_OPTIONS)
      if (next[o] !== this.states[o]) this.note(`${STYLE_SWITCH_RECEIPT}_${o}_${next[o]}_seen`);
    this.states = next;
    this.receivedAt = styleSwitchStatesAreDefault(next) ? null : receivedAt;
  }

  current(): StyleSwitchStates {
    return this.states;
  }
}

/** The arm one Horse gets for one option: the state itself, except canary, which resolves by the Horse's bucket. */
export function styleArmFor(
  state: StyleSwitchState,
  horseId: string
): { arm: 'off' | 'shadow' | 'on'; canary: boolean; bucket: number | null } {
  if (state !== 'canary') return { arm: state, canary: false, bucket: null };
  const bucket = styleCanaryBucket(horseId);
  return { arm: bucket === STYLE_CANARY_ON_BUCKET ? 'on' : 'shadow', canary: true, bucket };
}

/**
 * The decision options a state set gives one Horse: `<option>: true` for each option on (or canary-on), and
 * `styleShadow` listing the options in shadow (or canary-shadow). All off gives {} (the decision's options are
 * byte-identical to before the switch existed).
 */
export function styleSwitchDecisionOpts(
  states: StyleSwitchStates,
  horseId: string,
  allowShadow: boolean
): Partial<Record<StyleSwitchOption, true>> & {
  styleShadow?: readonly StyleSwitchOption[];
  styleCanaryBucket?: number;
  styleCanaryOptions?: readonly StyleSwitchOption[];
} {
  const out: Partial<Record<StyleSwitchOption, true>> & {
    styleShadow?: StyleSwitchOption[];
    styleCanaryBucket?: number;
    styleCanaryOptions?: StyleSwitchOption[];
  } = {};
  for (const o of STYLE_SWITCH_OPTIONS) {
    const s = states[o];
    if (s === 'off') continue;
    const a = styleArmFor(s, horseId);
    if (a.canary) {
      out.styleCanaryBucket = a.bucket!;
      // L4: which options are in canary, so a plain-shadow option on the same Horse is not labelled canary
      (out.styleCanaryOptions ??= []).push(o);
    }
    if (a.arm === 'on') out[o] = true;
    else if (a.arm === 'shadow' && allowShadow) (out.styleShadow ??= []).push(o);
  }
  return out;
}

/**
 * The options a decision passes to HorseLogic: styleSwitchDecisionOpts without its receipt-only fields (the canary
 * bucket and the canary option list never reach the brain).
 */
export function styleSwitchBrainOpts(
  opts: ReturnType<typeof styleSwitchDecisionOpts>
): Partial<Record<StyleSwitchOption, true>> & { styleShadow?: readonly StyleSwitchOption[] } {
  const { styleCanaryBucket: _bucket, styleCanaryOptions: _canary, ...brain } = opts;
  return brain;
}
