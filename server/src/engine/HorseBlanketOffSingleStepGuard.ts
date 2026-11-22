/**
 * CODE-LEVEL 1-AT-A-TIME BLANKET-OFF SETTINGS GUARD (2026-11-21, Horse Switch lane).
 *
 * Owner direction (2026-11-21 02:00 America/Chicago): every blanket rule comes off ONE AT A TIME, each tested and
 * validated before the next moves. Process discipline alone is not enough — this module enforces the 1-at-a-time
 * invariant directly in code on every runtime-settings transition and publisher check:
 *
 *   - 0 newly disabled blanket rules (no-op, non-blanket metadata/parameter update, or rollback): ALLOWED.
 *   - Re-enabling ANY number of previously disabled blanket rules (1 -> 0 / removing from off-list): ALWAYS ALLOWED
 *     (emergency rollback must NEVER be blocked!).
 *   - Turning AT MOST 1 new blanket rule OFF in a single published version transition: ALLOWED.
 *   - Turning 2 or more new blanket rules OFF in a single version transition: REFUSED with error code
 *     `BLANKET_OFF_MULTI_STEP_REFUSED` and the exact sorted list of newly disabled rules.
 *
 * Inspects all blanket-off representations uniformly:
 *   - `horse.blanketRowOffInPlo45Cash.<rule>` (= 1 or true means OFF)
 *   - `horse.holdemBlanketRuleOff.<rule>` (= 1 or true means OFF)
 *   - Array off-lists (`omahaBlanketRowsOffList`, `holdemBlanketRulesOffList`) or bare string arrays (`readonly string[]`).
 *
 * Pure, leaf module (zero engine/runtime imports, zero side effects, zero random draws).
 */

export const BLANKET_OFF_MULTI_STEP_REFUSED = 'BLANKET_OFF_MULTI_STEP_REFUSED' as const;

export const BLANKET_OFF_KEY_PREFIXES = Object.freeze([
  'horse.blanketRowOffInPlo45Cash.',
  'horse.holdemBlanketRuleOff.',
] as const);

export const BLANKET_OFF_LIST_KEY_TO_PREFIX: Readonly<Record<string, string>> = Object.freeze({
  omahaBlanketRowsOffList: 'horse.blanketRowOffInPlo45Cash.',
  holdemBlanketRulesOffList: 'horse.holdemBlanketRuleOff.',
});

export type BlanketOffSettingsInput =
  | null
  | undefined
  | Readonly<Record<string, unknown>>
  | readonly string[];

export interface BlanketOffSingleStepAllowed {
  readonly ok: true;
  readonly newlyDisabled: readonly string[];
  readonly reEnabled: readonly string[];
}

export interface BlanketOffSingleStepRefused {
  readonly ok: false;
  readonly code: typeof BLANKET_OFF_MULTI_STEP_REFUSED;
  readonly newlyDisabled: readonly string[];
  readonly reEnabled: readonly string[];
  readonly reason: string;
}

export type BlanketOffSingleStepVerdict = BlanketOffSingleStepAllowed | BlanketOffSingleStepRefused;

const isBlanketOffKey = (key: string): boolean =>
  BLANKET_OFF_KEY_PREFIXES.some((prefix) => key.startsWith(prefix) && key.length > prefix.length);

const isDisabledFlagValue = (value: unknown): boolean => value === 1 || value === true;

/**
 * Extracts the canonical set of disabled blanket rules from a settings object or array off-list.
 * Non-blanket settings and falsy/0 entries are ignored.
 */
export function extractDisabledBlanketRules(input: BlanketOffSettingsInput): ReadonlySet<string> {
  const disabled = new Set<string>();
  if (input === null || input === undefined) return disabled;
  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed.length > 0) disabled.add(trimmed);
      }
    }
    return disabled;
  }
  if (typeof input !== 'object') return disabled;
  for (const [key, value] of Object.entries(input)) {
    if (isBlanketOffKey(key)) {
      if (isDisabledFlagValue(value)) disabled.add(key);
      continue;
    }
    const listPrefix = Object.hasOwn(BLANKET_OFF_LIST_KEY_TO_PREFIX, key)
      ? BLANKET_OFF_LIST_KEY_TO_PREFIX[key]
      : undefined;
    if (listPrefix && Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          const trimmed = item.trim();
          if (trimmed.length > 0) disabled.add(listPrefix + trimmed);
        }
      }
    }
  }
  return disabled;
}

/**
 * Enforces the 1-at-a-time blanket-off invariant across a runtime settings version transition.
 *
 * - Allows turning 0 or 1 new blanket rule OFF in a single version transition.
 * - Allows turning ANY number of blanket rules back ON (emergency rollback is never blocked).
 * - Refuses any transition that turns 2 or more new blanket rules OFF in a single step, returning
 *   `code: 'BLANKET_OFF_MULTI_STEP_REFUSED'` and the exact sorted list of `newlyDisabled` rules.
 */
export function validateSingleBlanketOffStep(
  previousSettings: BlanketOffSettingsInput,
  nextSettings: BlanketOffSettingsInput
): BlanketOffSingleStepVerdict {
  const prevOff = extractDisabledBlanketRules(previousSettings);
  const nextOff = extractDisabledBlanketRules(nextSettings);

  const newlyDisabled = Object.freeze([...nextOff].filter((rule) => !prevOff.has(rule)).sort());
  const reEnabled = Object.freeze([...prevOff].filter((rule) => !nextOff.has(rule)).sort());

  if (newlyDisabled.length > 1) {
    return Object.freeze({
      ok: false as const,
      code: BLANKET_OFF_MULTI_STEP_REFUSED,
      newlyDisabled,
      reEnabled,
      reason:
        `${BLANKET_OFF_MULTI_STEP_REFUSED}: cannot disable ${newlyDisabled.length} blanket rules ` +
        `in a single published version (max 1 per step); newly disabled: ${newlyDisabled.join(', ')}`,
    });
  }

  return Object.freeze({
    ok: true as const,
    newlyDisabled,
    reEnabled,
  });
}
