/**
 * A MIGRATION CANNOT FORCE THE INSTALLER'S OWN DEFERRED CLAIM CHECK
 * (2026-11-23).
 *
 * apply-recorded-migration.mjs installs a file and its history row in ONE
 * transaction. Since 20261119053515 that transaction carries a deferred
 * constraint trigger, ca_migration_applier_claim_is_recorded on
 * smarter_private.ca_migration_applier_claims: at COMMIT it refuses a claim
 * whose history row does not exist. The history row is written AFTER the
 * file's own statements.
 *
 * 20261123024924 (a 10.9 chip correction) ran SET CONSTRAINTS ALL IMMEDIATE
 * inside its DO block to fire the ledger's deferred conservation checks early.
 * ALL includes the applier's claim check, so it fired before the history row
 * existed and production refused the install at 2026-11-23 04:10 UTC with
 * migration_applier_claim_unrecorded. Nothing applied; the member waited
 * another cycle. Every check had passed, because no check installs a file the
 * way the applier does. Repaired in #11822 by forcing the checks only in the
 * rolled-back probe branch.
 *
 * THE RULE, for migrations from CLAIM_CHECKED_FROM on. In the text an install
 * executes (comments, string literals and CREATE FUNCTION/PROCEDURE bodies
 * removed; DO blocks and top-level statements kept), SET CONSTRAINTS ALL
 * IMMEDIATE, in any case or spacing, is allowed in exactly one shape:
 *
 *     IF <condition> THEN
 *       SET CONSTRAINTS ALL IMMEDIATE;
 *       RAISE EXCEPTION ...;
 *
 * that is, it is the first statement after the THEN of an IF (no semicolon
 * between that IF and it) and the very next statement is RAISE EXCEPTION. A branch that always raises cannot commit, so
 * the applier's claim is never judged on a path that installs. Anything else
 * is refused: at the top level, unguarded in a DO block, in an ELSE/ELSIF
 * branch, or with another statement between it and the RAISE.
 *
 * Still allowed: SET CONSTRAINTS <named constraint, ...> IMMEDIATE, which does
 * not touch the applier's trigger, and the statement inside a function body,
 * which the install does not run.
 *
 * WHAT A TEXTUAL CHECK CANNOT PROVE. It cannot tell that <condition> is false
 * at install (IF true THEN ... passes and the install is then refused by
 * production, nothing committed). It cannot see the statement sent through
 * EXECUTE '...' (string literals are blanked), or a function the same file
 * creates and then calls that forces the checks itself. It is a floor that
 * removes the mistake as written, shared by the applier and the merge check
 * (tests/a-migration-cannot-force-the-installers-claim-check.law.test.ts) so
 * the two cannot disagree. Files before CLAIM_CHECKED_FROM already ran, or
 * never will, and are not re-judged.
 *
 * A SIBLING LAW LANDED THE SAME NIGHT (#11830,
 * tests/a-migration-never-fires-the-applier-claim-early.law.test.ts). It is
 * line-based and accepts the statement only when the line above it is exactly
 * "IF v_probe THEN". The two agree on the shape every author should write, the
 * one 20261123024924 carries: the probe flag named v_probe, the IF, the
 * statement and the RAISE each on a line of their own. This rule adds what
 * that one does not hold: the RAISE that makes the branch unable to commit,
 * any case or spacing, and the applier's refusal before anything is sent.
 */
import { installExecutedText } from './migration-cost-shape.mjs';

/** Migrations at or after this version must pass installerClaimRisks. */
export const CLAIM_CHECKED_FROM = '20261123024924';

const FORCE_ALL = /\bset\s+constraints\s+all\s+immediate\b/gi;
/** Nothing but "IF <condition> THEN" stands between the last semicolon and the statement. */
const OPENS_AN_IF_BRANCH = /\bif\b[^;]*\bthen\s*$/i;
/** The very next statement raises. */
const THEN_RAISES = /^\s*;\s*raise\s+exception\b/i;

/**
 * @param {string} file the migration file name
 * @param {string} sql  the whole file
 * @returns {string[]} one reason per SET CONSTRAINTS ALL IMMEDIATE the install
 *   could execute outside the probe-only shape; empty means none
 */
export function installerClaimRisks(file, sql) {
  const text = installExecutedText(sql);
  const reasons = [];
  let m;
  FORCE_ALL.lastIndex = 0;
  while ((m = FORCE_ALL.exec(text))) {
    const statementStart = text.lastIndexOf(';', m.index) + 1;
    const before = text.slice(statementStart, m.index);
    const after = text.slice(m.index + m[0].length);
    if (OPENS_AN_IF_BRANCH.test(before) && THEN_RAISES.test(after)) continue;
    reasons.push(
      `${file}: SET CONSTRAINTS ALL IMMEDIATE is on the install path. The applier installs the file and its ` +
        'history row in one transaction with its own deferred claim check ' +
        '(ca_migration_applier_claim_is_recorded); forcing ALL constraints fires that check before the history ' +
        'row exists, and production refuses the install with migration_applier_claim_unrecorded ' +
        '(20261123024924, 2026-11-23 04:10 UTC). Let the deferred checks run at COMMIT, name the constraints ' +
        '(SET CONSTRAINTS <name> IMMEDIATE), or force them only in a probe branch written exactly as three ' +
        'lines: IF v_probe THEN / SET CONSTRAINTS ALL IMMEDIATE; / RAISE EXCEPTION ...; ' +
        '(scripts/ci/migration-installer-claim-shape.mjs).'
    );
  }
  return reasons;
}

/** True when this file is judged by installerClaimRisks. */
export const isClaimChecked = (file) => String(file).slice(0, 14) >= CLAIM_CHECKED_FROM;
