/**
 * THE ACTED RECEIPTS OF AN OPTION, FROM THE LEDGER (2026-11-26, PLO-OWNER lead-7, lane HARDENING).
 *
 * WHY. The live shadow watch (scripts/ops/horse-option-shadow-watch.mjs) knew the acted receipts of four options by a
 * table in the script and took any other from a --acted-prefix flag; without one it printed VERDICT=DIRTY
 * reasons=acted_leak_unchecked, so a clean shadow trial of any other option read as dirty.
 *
 * WHAT. An option's acted receipts are derived from its own ledger entries (HorseDataLedger.ts): every receipt entry
 * whose consumer names the option (a whole word, or a glob such as holdemTournament*DefenceIsPriced). A receipt
 * whose consumer also names other registered options is legitimate while one of those is on (`unlessOn`). Where the
 * receipt entries do not name it, OPTION_ACTED_RECEIPTS_DECLARED (in the ledger) declares them, or declares `none`
 * with the reason. The check applies only to an option that is off by release default: in shadow the acted decision
 * runs at the release default, so an option on (or code-decided) by default acts and fires its receipts by design.
 *
 * THE BUILD GATE. Every registered option that takes shadow or on_shadow and is off by release default resolves to
 * at least one receipt or a reasoned `none` (optionActedReceiptGaps; law
 * everyShadowOptionKnowsItsActedReceipts.law.test.ts). The watch reads the resolved table from
 * scripts/ops/horse-option-acted-receipts.json, written by `npx tsx scripts/gen-horse-option-acted-receipts.ts` from
 * server/; the same law fails when that file's data differs from this derivation.
 */
import {
  HORSE_DATA_LEDGER,
  OPTION_ACTED_RECEIPTS_DECLARED,
  type LedgerEntry,
  type OptionActedReceiptsDeclaration,
} from './HorseDataLedger.js';

export interface OptionActedReceipts {
  readonly option: string;
  readonly releaseDefault: string;
  /** Where the receipts came from: the ledger's receipt entries, a declaration, or nothing (a gap). */
  readonly source: 'ledger' | 'declared' | 'none_declared' | 'not_applicable' | 'unknown';
  /** Exact receipt keys the option fires only when it acts. */
  readonly keys: readonly string[];
  /** Receipt-key prefixes (ledger families `x_*` and declared prefixes). */
  readonly prefixes: readonly string[];
  /** Options whose being on makes these receipts legitimate. */
  readonly unlessOn: readonly string[];
  /** Why no receipt can show it acted (source none_declared), or why the check does not apply. */
  readonly reason?: string;
}

const TOKEN = /[A-Za-z][A-Za-z0-9]*(?:\*[A-Za-z0-9]*)*/g;

/** The option names a consumer string names, among `names` (whole words and `*` globs). */
export function consumerNames(consumer: string, names: readonly string[]): string[] {
  const out = new Set<string>();
  const set = new Set(names);
  for (const t of consumer.match(TOKEN) ?? []) {
    if (!t.includes('*')) {
      if (set.has(t)) out.add(t);
      continue;
    }
    const re = new RegExp(
      `^${t
        .split('*')
        .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[A-Za-z0-9]*')}$`
    );
    for (const n of names) if (re.test(n)) out.add(n);
  }
  return [...out];
}

export interface ActedRegistryEntry {
  readonly name: string;
  readonly releaseDefault: string;
  readonly states: readonly string[];
}

/** Each receipt entry with the registered names its consumer names, computed once per registry and ledger. */
const INDEX = new WeakMap<object, WeakMap<object, { r: LedgerEntry; named: string[] }[]>>();
function receiptIndex(
  registry: readonly ActedRegistryEntry[],
  ledger: readonly LedgerEntry[]
): { r: LedgerEntry; named: string[] }[] {
  let byLedger = INDEX.get(registry);
  if (!byLedger) INDEX.set(registry, (byLedger = new WeakMap()));
  let idx = byLedger.get(ledger);
  if (!idx) {
    const names = registry.map((e) => e.name);
    idx = ledger
      .filter((r) => r.kind === 'receipt')
      .map((r) => ({ r, named: consumerNames(r.consumer, names) }))
      .filter((x) => x.named.length > 0);
    byLedger.set(ledger, idx);
  }
  return idx;
}

const shadowable = (e: ActedRegistryEntry) =>
  e.states.includes('shadow') || e.states.includes('on_shadow');

/** The acted receipts of one registered option. */
export function optionActedReceipts(
  entry: ActedRegistryEntry,
  registry: readonly ActedRegistryEntry[],
  ledger: readonly LedgerEntry[] = HORSE_DATA_LEDGER,
  declared: Readonly<
    Record<string, OptionActedReceiptsDeclaration>
  > = OPTION_ACTED_RECEIPTS_DECLARED
): OptionActedReceipts {
  const base = { option: entry.name, releaseDefault: entry.releaseDefault };
  const keys: string[] = [];
  const prefixes: string[] = [];
  const unlessOn = new Set<string>();
  for (const { r, named } of receiptIndex(registry, ledger)) {
    if (!named.includes(entry.name)) continue;
    if (r.key.endsWith('*')) prefixes.push(r.key.slice(0, -1));
    else keys.push(r.key);
    for (const n of named) if (n !== entry.name) unlessOn.add(n);
  }
  const d = Object.hasOwn(declared, entry.name) ? declared[entry.name]! : null;
  if (d && 'none' in d)
    return {
      ...base,
      source: 'none_declared',
      keys: [],
      prefixes: [],
      unlessOn: [],
      reason: d.none,
    };
  if (d) {
    for (const p of d.prefixes) prefixes.push(p);
    for (const n of d.unlessOn ?? []) unlessOn.add(n);
  }
  const uniq = (a: string[]) => [...new Set(a)].sort();
  const found = keys.length + prefixes.length > 0;
  const source = d
    ? 'declared'
    : found
      ? 'ledger'
      : entry.releaseDefault === 'off'
        ? 'unknown'
        : 'not_applicable';
  return {
    ...base,
    source,
    keys: uniq(keys),
    prefixes: uniq(prefixes),
    unlessOn: uniq([...unlessOn]),
    ...(source === 'not_applicable'
      ? {
          reason: `release default ${entry.releaseDefault}: in shadow the acted decision runs it, so its receipts fire by design`,
        }
      : {}),
  };
}

/** The table the watch reads: every registered option that takes shadow or on_shadow, by name. */
export function optionActedReceiptTable(
  registry: readonly ActedRegistryEntry[],
  ledger: readonly LedgerEntry[] = HORSE_DATA_LEDGER,
  declared: Readonly<
    Record<string, OptionActedReceiptsDeclaration>
  > = OPTION_ACTED_RECEIPTS_DECLARED
): Record<string, Omit<OptionActedReceipts, 'option'>> {
  const out: Record<string, Omit<OptionActedReceipts, 'option'>> = {};
  for (const e of registry) {
    if (!shadowable(e)) continue;
    const { option: _o, ...rest } = optionActedReceipts(e, registry, ledger, declared);
    out[e.name] = rest;
  }
  return out;
}

/**
 * The gaps: a registered option that takes shadow or on_shadow and is off by release default with no acted receipt
 * and no reasoned `none`; a declaration for a name that is not such an option; an empty reason; an unlessOn name or
 * a prefix that is not well formed. Empty when the gate holds.
 */
export function optionActedReceiptGaps(
  registry: readonly ActedRegistryEntry[],
  ledger: readonly LedgerEntry[] = HORSE_DATA_LEDGER,
  declared: Readonly<
    Record<string, OptionActedReceiptsDeclaration>
  > = OPTION_ACTED_RECEIPTS_DECLARED
): string[] {
  const gaps: string[] = [];
  const byName = new Map(registry.map((e) => [e.name, e]));
  for (const e of registry) {
    if (!shadowable(e) || e.releaseDefault !== 'off') continue;
    const r = optionActedReceipts(e, registry, ledger, declared);
    if (r.source === 'unknown')
      gaps.push(
        `${e.name}: a default-off option that takes shadow names its acted receipts (a ledger receipt whose consumer names it, or OPTION_ACTED_RECEIPTS_DECLARED)`
      );
  }
  for (const [name, d] of Object.entries(declared)) {
    const e = byName.get(name);
    if (!e || !shadowable(e) || e.releaseDefault !== 'off')
      gaps.push(
        `${name}: declared acted receipts but is not a registered default-off option that takes shadow`
      );
    if ('none' in d) {
      if (String(d.none ?? '').trim().length < 24)
        gaps.push(`${name}: the reason for no acted receipt is not a reason`);
    } else {
      if (!d.prefixes.length) gaps.push(`${name}: declares no prefix`);
      for (const p of d.prefixes)
        if (!/^[a-z][a-z0-9_]{2,99}$/.test(p)) gaps.push(`${name}: malformed receipt prefix ${p}`);
      for (const n of d.unlessOn ?? [])
        if (!byName.has(n)) gaps.push(`${name}: unlessOn names an unregistered option ${n}`);
    }
  }
  return gaps;
}

export const OPTION_ACTED_RECEIPTS_SCHEMA = 'horse-option-acted-receipts/v1';

/** The exact text of scripts/ops/horse-option-acted-receipts.json for a registry. */
export function optionActedReceiptsJson(
  registry: readonly ActedRegistryEntry[],
  ledger: readonly LedgerEntry[] = HORSE_DATA_LEDGER,
  declared: Readonly<
    Record<string, OptionActedReceiptsDeclaration>
  > = OPTION_ACTED_RECEIPTS_DECLARED
): string {
  return (
    JSON.stringify(
      {
        schema: OPTION_ACTED_RECEIPTS_SCHEMA,
        generatedBy:
          'server/scripts/gen-horse-option-acted-receipts.ts from HorseDataLedger.ts (do not edit by hand)',
        options: optionActedReceiptTable(registry, ledger, declared),
      },
      null,
      1
    ) + '\n'
  );
}
