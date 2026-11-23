/**
 * A HAND-WRITTEN CHIP CORRECTION RE-CHECKS AT INSTALL THAT NOBODY ALREADY
 * MADE THE PLAYER WHOLE (2026-11-23).
 *
 * 20261123002808 returned promo to two members. It was proven in a rolled-back
 * production probe at 00:31 UTC, merged, and then waited about ninety minutes
 * for an install slot. At 00:38 UTC one member's agent re-sent him the same
 * 10.00 by hand. The file refused only on its OWN idempotency keys, which a
 * person's manual credit does not carry, so it would have paid him twice. It
 * was caught by a reader, held and superseded; nothing in the build would have
 * stopped it. Its replacement, 20261123024924, refuses when any promo credit
 * from the same fund reached the member after the refund that started it.
 *
 * A proof says what was true when it ran. A migration installs later:
 * minutes, or hours behind a break window or an engine cycle. Support staff,
 * agents and other sessions keep working in that gap.
 *
 * THE RULE, for migrations from MADE_WHOLE_CHECKED_FROM on whose install text
 * calls public.fn_ca_adjustment_under_10_9 (the hand-settlement door):
 *
 * 1. THE HEADER NAMES THE CHECK. Before BEGIN; one line
 *        -- @already-made-whole-guard: <one sentence naming what is checked>
 *    with a real sentence (at least 30 characters, no <placeholder>).
 *
 * 2. THE BODY REFUSES ON A COMPETING CREDIT. Somewhere in the install text:
 *        IF ... EXISTS (SELECT ... public.chip_ledger ... created_at > <event time> ...) THEN
 *          RAISE EXCEPTION ...
 *    that is, an IF whose condition holds a positive EXISTS (not NOT EXISTS)
 *    reading chip_ledger with a created_at lower bound, and whose first
 *    statement is RAISE EXCEPTION. The bound is what makes it a read of what
 *    happened SINCE the triggering event, by anyone, rather than a lookup of
 *    this file's own keys.
 *
 * WHAT A TEXTUAL CHECK CANNOT PROVE. It cannot tell that the EXISTS names the
 * right member, fund, categories or event time, or that the ledger is the only
 * place a make-good could have landed (a seat stack, a ticket, a different
 * club). It proves the author was made to write the re-check and say in one
 * sentence what it reads; the sentence is there so a reviewer can hold the SQL
 * to it. The rolled-back production probe (CLAUDE.md 11.5) is still the proof
 * of the amounts.
 *
 * Merge-time only (tests/a-hand-settlement-rechecks-at-install.law.test.ts);
 * files before MADE_WHOLE_CHECKED_FROM are not re-judged.
 */
import { installExecutedText } from './migration-cost-shape.mjs';

/** Migrations at or after this version must pass madeWholeGuardGaps. */
export const MADE_WHOLE_CHECKED_FROM = '20261123120000';
export const MADE_WHOLE_HEADER = '-- @already-made-whole-guard:';
const MIN_SENTENCE = 30;

/** True when the install itself calls the hand-settlement door. */
export function callsHandSettlementDoor(sql) {
  const text = installExecutedText(sql);
  const call = /(?<![\w."])(?:public\s*\.\s*)?"?fn_ca_adjustment_under_10_9"?\s*\(/gi;
  let m;
  while ((m = call.exec(text))) {
    // GRANT/REVOKE/ALTER/DROP/COMMENT ON FUNCTION name(args) names it without calling it.
    if (!/\b(?:function|procedure|routine)\s+(?:if\s+exists\s+)?$/i.test(text.slice(0, m.index)))
      return true;
  }
  return false;
}

/** The declared sentences, read from the header (the lines before BEGIN;). */
export function madeWholeDeclarations(sql) {
  const lines = sql.split('\n');
  const begin = lines.findIndex((l) => /^\s*begin\s*;/i.test(l));
  return (begin === -1 ? lines : lines.slice(0, begin))
    .filter((l) => l.startsWith(MADE_WHOLE_HEADER))
    .map((l) => l.slice(MADE_WHOLE_HEADER.length).trim());
}

/** True when the install text holds the competing-credit refusal described above. */
export function hasCompetingCreditRefusal(sql) {
  const text = installExecutedText(sql);
  const guard = /\bif\b([^;]*?)\bthen\s+raise\s+exception\b/gi;
  const bounded = /\bcreated_at\s*>=?|<=?\s*(?:[\w"]+\s*\.\s*)?"?created_at\b/i;
  let m;
  while ((m = guard.exec(text))) {
    const condition = m[1];
    const exists = /(\bnot\s+)?\bexists\s*\(/gi;
    let e;
    while ((e = exists.exec(condition))) {
      if (e[1]) continue;
      const read = condition.slice(e.index);
      if (/\bchip_ledger\b/i.test(read) && bounded.test(read)) return true;
    }
  }
  return false;
}

/**
 * @param {string} file the migration file name
 * @param {string} sql  the whole file
 * @returns {string[]} what is missing; empty when the file does not call the
 *   door or carries both the declaration and the refusal
 */
export function madeWholeGuardGaps(file, sql) {
  if (!callsHandSettlementDoor(sql)) return [];
  const gaps = [];
  const said = madeWholeDeclarations(sql);
  if (said.length !== 1 || said[0].length < MIN_SENTENCE || /[<>]/.test(said[0])) {
    gaps.push(
      `${file}: settles by hand through fn_ca_adjustment_under_10_9 and must carry exactly one header line ` +
        `"${MADE_WHOLE_HEADER} <one sentence naming what is checked>" before BEGIN; (found ${said.length}` +
        `${said.length === 1 ? ', too short or still a placeholder' : ''}). Example: ${MADE_WHOLE_HEADER} refuses ` +
        'if any promo credit from the union promo wallet reached the member after the refund.'
    );
  }
  if (!hasCompetingCreditRefusal(sql)) {
    gaps.push(
      `${file}: settles by hand through fn_ca_adjustment_under_10_9 but never re-checks, at install, that nobody ` +
        'already made the player whole. The install can be hours after the proof (20261123002808: the agent re-sent ' +
        'the same 10.00 by hand while the file waited; it checked only its own keys and would have paid twice). ' +
        'Add: IF EXISTS (SELECT 1 FROM public.chip_ledger l WHERE <the member, the fund, the categories> AND ' +
        "l.created_at > <the triggering event's time>) THEN RAISE EXCEPTION ...; " +
        '(scripts/ci/migration-made-whole-guard.mjs; worked example 20261123024924).'
    );
  }
  return gaps;
}

/** True when this file is judged by madeWholeGuardGaps. */
export const isMadeWholeChecked = (file) => String(file).slice(0, 14) >= MADE_WHOLE_CHECKED_FROM;
