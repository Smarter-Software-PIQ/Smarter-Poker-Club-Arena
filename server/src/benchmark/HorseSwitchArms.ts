/**
 * PRODUCTION SWITCH SETS AS EVALUATION ARMS (2026-11-19, Horse Switch lane).
 *
 * One reader for the input every switch evaluation starts from: the switch set
 * production serves, written option -> boolean. It accepts the three shapes the
 * lane writes:
 *   - a map           { "omahaFacingBetEv": true, "styleFoldBluff": false, ... }
 *   - sorted entries  [["omahaFacingBetEv", true], ...]  (an arms.json arm)
 *   - an arms.json    { "a": [...], "b": [...], ... }    (its control arm, `b`, is the base)
 *   - switch rows     [{ "option": "...", "state": "on" | "off" }, ...]  (a live switch read)
 *
 * Every name must be a registered switch (OPTION_SWITCH_NAMES: the style options
 * and every plain on/off or off-only option). A decision-plumbing key
 * (OPTION_SWITCH_PLUMBING: telemetry, observeMind, mind) is dropped and listed in
 * `ignored`: the harnesses set those themselves. Anything else (a parameter, an
 * unknown or refused name, a non-boolean value, `true` for an off-only option, a
 * duplicate entry) throws: a partial or mistyped production set is void, never
 * repaired.
 *
 * horseSwitchArms(base, flag) builds the two arms of a leave-one-out card: arm B
 * is the base exactly; arm A is the base with `flag` set to the candidate value
 * (by default the opposite of the base's value). The function refuses unless A
 * and B differ in that one option. Benchmark plumbing only: no production path
 * reads this file.
 */
import { createHash } from 'node:crypto';
import {
  OPTION_SWITCH_NAMES,
  OPTION_SWITCH_OFF_ONLY_NAMES,
  OPTION_SWITCH_PLUMBING,
} from '../engine/HorseOptionSwitch.js';

export type HorseSwitchSet = Readonly<Record<string, boolean>>;

export interface ParsedHorseSwitchSet {
  /** The registered options, sorted by name, frozen. */
  set: HorseSwitchSet;
  /** Plumbing keys that were present and dropped (sorted). */
  ignored: readonly string[];
}

const REGISTERED: ReadonlySet<string> = new Set(OPTION_SWITCH_NAMES);
const OFF_ONLY: ReadonlySet<string> = new Set(OPTION_SWITCH_OFF_ONLY_NAMES);
const PLUMBING: ReadonlySet<string> = new Set(OPTION_SWITCH_PLUMBING);

export function isRegisteredHorseSwitch(name: string): boolean {
  return REGISTERED.has(name);
}

function entriesOf(input: unknown, label: string): Array<[string, unknown]> {
  if (Array.isArray(input)) {
    const out: Array<[string, unknown]> = [];
    for (const e of input) {
      if (e && typeof e === 'object' && !Array.isArray(e) && typeof e.option === 'string') {
        // A switch row as the live read returns it: 'on' / 'off' only.
        if (e.state !== 'on' && e.state !== 'off')
          throw new Error(`${label}: ${e.option} has state ${String(e.state)}, not on or off`);
        out.push([e.option, e.state === 'on']);
        continue;
      }
      if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== 'string')
        throw new Error(`${label}: an entry is not [option, boolean] or {option, state}`);
      out.push([e[0], e[1]]);
    }
    return out;
  }
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    // An arms.json: its control arm is the production base.
    if (Array.isArray(o.a) && Array.isArray(o.b)) return entriesOf(o.b, `${label} (arms.json b)`);
    return Object.entries(o);
  }
  throw new Error(`${label}: expected an option -> boolean map, entries or an arms.json`);
}

export function parseHorseSwitchSet(input: unknown, label = 'switch set'): ParsedHorseSwitchSet {
  const seen = new Set<string>();
  const ignored: string[] = [];
  const out: Record<string, boolean> = {};
  for (const [name, value] of entriesOf(input, label)) {
    if (seen.has(name)) throw new Error(`${label}: ${name} is given twice`);
    seen.add(name);
    if (PLUMBING.has(name)) {
      ignored.push(name);
      continue;
    }
    if (!REGISTERED.has(name)) throw new Error(`${label}: ${name} is not a registered switch`);
    if (typeof value !== 'boolean') throw new Error(`${label}: ${name} is not a boolean`);
    if (value && OFF_ONLY.has(name))
      throw new Error(`${label}: ${name} is off-only and cannot be on`);
    out[name] = value;
  }
  const set: Record<string, boolean> = {};
  for (const name of Object.keys(out).sort()) set[name] = out[name]!;
  return { set: Object.freeze(set), ignored: Object.freeze(ignored.sort()) };
}

export interface HorseSwitchArms {
  flag: string;
  /** The flag's value in arm A. */
  candidateValue: boolean;
  /** The flag's value in arm B (undefined: no row, the release default). */
  baseValue: boolean | undefined;
  /** Arm A: the base with the flag at candidateValue. */
  a: HorseSwitchSet;
  /** Arm B: the base, unchanged. */
  b: HorseSwitchSet;
  ignored: readonly string[];
  /** sha256 of the canonical {flag, candidateValue, a, b}. */
  digest: string;
}

export function canonicalSwitchJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalSwitchJson).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value as object)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) + ':' + canonicalSwitchJson((value as Record<string, unknown>)[k])
        )
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}

export function horseSwitchArms(
  base: unknown,
  flag: string,
  candidateValue?: boolean
): HorseSwitchArms {
  if (!REGISTERED.has(flag)) throw new Error(`switch card: ${flag} is not a registered switch`);
  const { set: b, ignored } = parseHorseSwitchSet(base, 'switch card base');
  const baseValue = Object.hasOwn(b, flag) ? b[flag] : undefined;
  if (candidateValue === undefined && baseValue === undefined)
    throw new Error(
      `switch card: ${flag} has no value in the base; declare the candidate value explicitly`
    );
  const value = candidateValue ?? !baseValue;
  if (value && OFF_ONLY.has(flag))
    throw new Error(`switch card: ${flag} is off-only, so arm A cannot switch it on`);
  if (value === baseValue)
    throw new Error(`switch card: arm A equals arm B (${flag} is already ${value})`);
  const a: Record<string, boolean> = {};
  for (const name of Object.keys({ ...b, [flag]: value }).sort())
    a[name] = name === flag ? value : b[name]!;
  const differ = Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]);
  if (differ.length !== 1 || differ[0] !== flag)
    throw new Error('switch card: arm A is not arm B with the flag changed');
  const frozenA = Object.freeze(a);
  const digest = createHash('sha256')
    .update(canonicalSwitchJson({ flag, candidateValue: value, a: frozenA, b }))
    .digest('hex');
  return { flag, candidateValue: value, baseValue, a: frozenA, b, ignored, digest };
}
