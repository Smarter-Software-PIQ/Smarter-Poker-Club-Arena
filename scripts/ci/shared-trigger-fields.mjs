/**
 * A SHARED TRIGGER READS ONLY THE FIELDS ITS TABLE HAS (2026-11-09).
 *
 * On 2026-11-07 fn_guard_managed_game_lifecycle(), attached to BOTH
 * public.tournaments and public.tables, gained
 *   IF TG_TABLE_NAME='tournaments' AND ... AND OLD.late_reg_levels=12 ... THEN
 * PL/pgSQL plans that whole condition as one expression, so on a tables row
 * the planner meets OLD.late_reg_levels, which tables does not have, and
 * raises `record "old" has no field "late_reg_levels"` before the
 * TG_TABLE_NAME test can short-circuit. Every tables UPDATE failed until
 * 20261108101627 moved the field read inside its own IF TG_TABLE_NAME block.
 *
 * findUnguardedFields() reads a PL/pgSQL body the way the planner does:
 * a NEW.<field> / OLD.<field> read is safe for a table that lacks <field>
 * only when an ENCLOSING IF / ELSIF / CASE branch (whose condition was
 * already closed by THEN) tests the relation: TG_TABLE_NAME, TG_RELID,
 * TG_TABLE_SCHEMA or TG_ARGV; when an EARLIER branch of the same IF chain
 * tested the relation (a later ELSIF / ELSE runs only after that test said no);
 * or after a relation-tested IF whose first branch ends in RETURN or RAISE
 * EXCEPTION (the early exit). A relation test in the SAME expression as the
 * read is exactly the Nov 7 defect and is not a guard.
 *
 * Pure: no database. tests/a-shared-trigger-reads-only-fields-its-table-has.law.test.ts
 * feeds it the production snapshot and every newer migration.
 */

const RELATION_TEST = /\bTG_(TABLE_NAME|RELID|TABLE_SCHEMA|RELNAME|ARGV)\b/i;

/** Blank comments and string/dollar literals (same length) so offsets survive. */
export function blankLiterals(body) {
  let out = '';
  let i = 0;
  const n = body.length;
  while (i < n) {
    const c = body[i];
    if (c === '-' && body[i + 1] === '-') {
      const j = body.indexOf('\n', i);
      const end = j < 0 ? n : j;
      out += ' '.repeat(end - i);
      i = end;
    } else if (c === '/' && body[i + 1] === '*') {
      const j = body.indexOf('*/', i + 2);
      const end = j < 0 ? n : j + 2;
      out += body.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (body[j] === "'" && body[j + 1] === "'") j += 2;
        else if (body[j] === "'") break;
        else j++;
      }
      const end = Math.min(n, j + 1);
      // Keep the literal's text: TG_TABLE_NAME = 'tournaments' must stay readable.
      out += "'" + body.slice(i + 1, end - 1).replace(/[^\n\w]/g, ' ') + (end - 1 > i ? "'" : '');
      i = end;
    } else if (c === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(body.slice(i));
      if (m) {
        const tag = m[0];
        const j = body.indexOf(tag, i + tag.length);
        const end = j < 0 ? n : j + tag.length;
        out += body.slice(i, end).replace(/[^\n]/g, ' ');
        i = end;
      } else {
        out += c;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * @param {string} body  PL/pgSQL source (prosrc)
 * @param {Record<string,string[]>} columnsByTable  attached table -> its columns
 * @returns {{field:string, ref:string, lacking:string[], line:number}[]}
 */
export function findUnguardedFields(body, columnsByTable) {
  const tables = Object.keys(columnsByTable);
  if (tables.length < 2) return [];
  const has = Object.fromEntries(tables.map((t) => [t, new Set(columnsByTable[t].map((c) => c.toLowerCase()))]));
  const code = blankLiterals(body);
  // Token stream of block keywords and references, in order.
  const re = /\b(END\s+IF|END\s+CASE|END\s+LOOP|END|IF|ELSIF|ELSEIF|ELSE|CASE|WHEN|THEN|LOOP|(NEW|OLD)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*))\b/gi;
  const root = { kind: 'ROOT', guarded: false };
  const stack = [root];
  let pending = null; // open condition start offset
  const findings = [];
  let m;
  const guardedNow = () => stack.some((s) => s.guarded);
  const exits = (text) => /(\bRETURN\b[^;]*|\bRAISE\s+EXCEPTION\b[^;]*);\s*$/i.test(text.trim());
  const closeBranch = (top, at) => {
    if (top && top.kind === 'IF' && top.branch === 1 && top.firstTested && top.bodyStart != null) {
      top.firstExits = exits(code.slice(top.bodyStart, at));
    }
  };
  while ((m = re.exec(code))) {
    const tok = m[1].toUpperCase().replace(/\s+/g, ' ');
    if (m[2]) {
      const field = m[3].toLowerCase();
      const lacking = tables.filter((t) => !has[t].has(field));
      if (lacking.length === 0 || lacking.length === tables.length) continue;
      if (guardedNow()) continue;
      findings.push({
        field,
        ref: `${m[2].toUpperCase()}.${field}`,
        lacking,
        line: code.slice(0, m.index).split('\n').length,
      });
      continue;
    }
    const top = stack[stack.length - 1];
    if (tok === 'END IF' || tok === 'END CASE') {
      const want = tok === 'END IF' ? 'IF' : 'CASE';
      while (stack.length > 1 && stack[stack.length - 1].kind !== want) stack.pop();
      const done = stack.length > 1 ? stack.pop() : null;
      if (done && done.kind === 'IF') {
        closeBranch(done, m.index);
        // Early exit: the rest of the enclosing block runs only for the
        // relations the first condition did not select.
        if (done.firstTested && done.firstExits) stack[stack.length - 1].guarded = true;
      }
      pending = null;
    } else if (tok === 'END') {
      // A bare END closes an expression CASE; a block END needs nothing.
      if (top && top.kind === 'CASE') stack.pop();
    } else if (tok === 'END LOOP') {
      while (stack.length > 1 && stack[stack.length - 1].kind !== 'LOOP') stack.pop();
      if (stack.length > 1) stack.pop();
    } else if (tok === 'LOOP') {
      stack.push({ kind: 'LOOP', guarded: false });
    } else if (tok === 'IF') {
      stack.push({ kind: 'IF', guarded: false, branch: 0, chainTested: false });
      pending = m.index + m[0].length;
    } else if (tok === 'ELSIF' || tok === 'ELSEIF') {
      if (top && top.kind === 'IF') {
        closeBranch(top, m.index);
        top.guarded = top.chainTested;
      }
      pending = top && top.kind === 'IF' && top.chainTested ? null : m.index + m[0].length;
    } else if (tok === 'ELSE') {
      if (top && (top.kind === 'IF' || top.kind === 'CASE')) {
        closeBranch(top, m.index);
        top.guarded = !!top.chainTested;
        top.branch = (top.branch || 0) + 1;
      }
      pending = null;
    } else if (tok === 'CASE') {
      const tail = code.slice(m.index + m[0].length, m.index + m[0].length + 60);
      const subject = RELATION_TEST.test(tail.split(/\bWHEN\b/i)[0]);
      stack.push({ kind: 'CASE', guarded: false, chainTested: subject });
      pending = null;
    } else if (tok === 'WHEN') {
      if (top && top.kind === 'CASE') top.guarded = !!top.chainTested;
      pending = top && top.kind === 'CASE' && top.chainTested ? null : m.index + m[0].length;
    } else if (tok === 'THEN') {
      if (top && (top.kind === 'IF' || top.kind === 'CASE')) {
        if (pending != null && RELATION_TEST.test(code.slice(pending, m.index))) top.chainTested = true;
        top.guarded = !!top.chainTested;
        if (top.kind === 'IF') {
          top.branch = (top.branch || 0) + 1;
          if (top.branch === 1) {
            top.firstTested = top.chainTested;
            top.bodyStart = m.index + m[0].length;
          }
        }
      }
      pending = null;
    }
  }
  return findings;
}
