/**
 * ===========================================================================
 *  LAW: THE LIGHTNING GAMES VPIP FLOOR IS 25, AND IT IS THE TEMPLATE'S ANSWER
 * ===========================================================================
 *
 * Dan, 2026-11-19, 1:38 PM Chicago: "LOWER THE VPIP IN LIGHTNING GAMES TO 25%
 * ACROSS THE BOARD FOR ALL LIGHTNING GAMES, NO LIMIT OR PLO".
 *
 * A Lightning game's floor is not a setting on the game or on its tables. It
 * is what fn_cash_template_defaults answers for the Lightning Games format
 * (template madness, historical action) in a variant Lightning deals, and
 * every other place only copies it: the creator into the game's snapshot, the
 * floor trigger on every later snapshot write, the table opener into a new
 * table, fn_cash_apply_ruleset onto every open table on every cluster tick.
 * Twelve table rows set by hand would have been back at 40 within one tick.
 *
 * So the law reads the NEWEST definition of the two functions that decide the
 * number, whichever migration holds it. A later migration that re-seeds the
 * template at another floor, or lets Madness without Lightning follow the
 * Lightning floor down, fails here before it can merge.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  CASH_TEMPLATES,
  LIGHTNING_RULES_SUMMARY,
  LIGHTNING_VPIP_FLOOR,
  cashTemplateNote,
} from '../src/config/cashGames';
import {
  ALLOWED_VPIP_REQUIREMENTS,
  isAllowedVpipRequirement,
} from '../src/components/table/VpipRequirementBadge';

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'supabase/migrations');
const FILE = '20261119195413_the_lightning_games_vpip_floor_is_twenty_five.sql';
const read = (name: string) => fs.readFileSync(path.join(DIR, name), 'utf8');

/** This migration and everything after it, newest first. */
const sinceTheRuling = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.sql') && f >= FILE)
  .sort()
  .reverse();

/** The body of the newest `CREATE OR REPLACE FUNCTION public.<fn>(` from the ruling on. */
function newestBody(fn: string): { file: string; body: string } {
  const head = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`);
  for (const file of sinceTheRuling) {
    const sql = read(file);
    const at = sql.search(head);
    if (at < 0) continue;
    const open = /AS (\$[A-Za-z_]*\$)/.exec(sql.slice(at));
    if (!open) throw new Error(`${file} defines ${fn} without a dollar-quoted body`);
    const from = at + open.index + open[0].length;
    const to = sql.indexOf(open[1], from);
    return { file, body: sql.slice(from, to) };
  }
  throw new Error(`no migration from ${FILE} on defines ${fn}`);
}

/**
 * The template's floor for one template and variant, worked out from the SQL
 * CASE itself. The arms are read in order, as Postgres reads them, so a new
 * arm placed in front of the Lightning arm changes the answer here too.
 */
function floorFromSql(body: string, template: string, variant: string): number {
  const t = ['action', 'madness', 'lightning'].includes(template) ? 'madness' : template;
  const expr = /'vpip_floor',\s*CASE\s+([\s\S]*?)\s+END\s*,\s*'vpip_window'/.exec(body);
  if (!expr) throw new Error('the template no longer answers vpip_floor with one CASE');
  const arms = expr[1].split(/\s+(?=WHEN\b|ELSE\b)/);
  const holds = (cond: string): boolean =>
    cond.split(/\s+AND\s+/).every((part) => {
      const eq = /^t\s*=\s*'(\w+)'$/.exec(part);
      if (eq) return t === eq[1];
      const ne = /^t\s*<>\s*'(\w+)'$/.exec(part);
      if (ne) return t !== ne[1];
      const list = /^v\s+(NOT\s+)?IN\s*\(([^)]*)\)$/.exec(part);
      if (list) {
        const inList = list[2]
          .split(',')
          .map((x) => x.trim().replace(/'/g, ''))
          .includes(variant);
        return list[1] ? !inList : inList;
      }
      throw new Error(`a floor condition this law cannot read: ${part}`);
    });
  for (const arm of arms) {
    const when = /^WHEN\s+([\s\S]+?)\s+THEN\s+(\d+)$/.exec(arm);
    if (when) {
      if (holds(when[1])) return Number(when[2]);
      continue;
    }
    const otherwise = /^ELSE\s+(\d+)$/.exec(arm);
    if (otherwise) return Number(otherwise[1]);
    throw new Error(`a floor arm this law cannot read: ${arm}`);
  }
  throw new Error('the floor CASE has no ELSE');
}

const LIGHTNING_VARIANTS = ['nlh', 'plo4', 'plo5', 'plo6'];

describe('the template answers 25 for every Lightning game, whichever migration defines it last', () => {
  const { body } = newestBody('fn_cash_template_defaults');

  it('No Limit and PLO4, PLO5, PLO6 keep 25 under both names of the format', () => {
    for (const template of ['madness', 'action', 'lightning']) {
      for (const variant of LIGHTNING_VARIANTS) {
        expect(floorFromSql(body, template, variant), `${template} ${variant}`).toBe(25);
      }
    }
  });

  it('no Classic floor moved with it', () => {
    expect(floorFromSql(body, 'classic', 'plo5')).toBe(40);
    expect(floorFromSql(body, 'classic', 'plo6')).toBe(40);
    for (const variant of ['nlh', 'plo4', 'plo8', 'flh', 'flo8', 'short_deck', 'pineapple']) {
      expect(floorFromSql(body, 'classic', variant), `classic ${variant}`).toBe(0);
    }
  });

  it('a legacy Action or Madness row in a variant Lightning does not deal keeps 40', () => {
    for (const variant of ['plo8', 'flo8', 'flh', 'short_deck']) {
      expect(floorFromSql(body, 'madness', variant), `madness ${variant}`).toBe(40);
    }
  });

  it('the window is still ten hands: only the percentage moved', () => {
    expect(body).toMatch(/END,'vpip_window',10,/);
  });

  it('the variant list is inline, because the template runs with its caller rights', () => {
    // An authenticated caller may not execute fn_lightning_variant_allowed, and
    // the create flow calls this function directly.
    expect(body).not.toContain('fn_lightning_variant_allowed');
  });
});

describe('the floor trigger copies the template, and Madness without Lightning states its own 40', () => {
  const { body } = newestBody('fn_cash_game_floor_from_template');

  it('every snapshot write takes the floor from the template', () => {
    expect(body).toContain(
      'v_def := public.fn_cash_template_defaults(NEW.template_name, NEW.variant);'
    );
    expect(body).toContain("'vpip_floor',   v_def->'vpip_floor'");
  });

  it('the madness_without_lightning branch cannot follow Lightning down', () => {
    expect(body).toMatch(
      /rules_profile' = 'madness_without_lightning' THEN\s+v_def := public\.fn_cash_template_defaults\('madness', NEW\.variant\)\s+\|\| jsonb_build_object\('vpip_floor', 40\);/
    );
  });

  it('a Classic floor is still raised to its config row, never lowered', () => {
    expect(body).toMatch(/'vpip_floor', GREATEST\(/);
  });
});

describe('the migration moves the source and every open Lightning row, and nothing else', () => {
  const sql = read(FILE);
  const md5 = (s: string) => createHash('md5').update(s).digest('hex');
  const bodyOf = (fn: string) => {
    const m = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?AS \\$fn\\$([\\s\\S]*?)\\$fn\\$;`
    ).exec(sql);
    if (!m) throw new Error(`${fn} is not written out in ${FILE}`);
    return m[1];
  };

  it('pins both pre-images and the post-images of the bodies it actually carries', () => {
    expect(sql).toContain('6ad34a35974530555157dcf9e4f299c6');
    expect(sql).toContain('5b0b03754daf121c77d2a451bb9f8839');
    const defaults = md5(bodyOf('fn_cash_template_defaults'));
    const trigger = md5(bodyOf('fn_cash_game_floor_from_template'));
    expect(sql).toContain(`fn_cash_template_defaults post-image is %, expected ${defaults}`);
    expect(sql).toContain(`fn_cash_game_floor_from_template post-image is %, expected ${trigger}`);
  });

  it('selects Lightning games by their format columns, never by a name', () => {
    const code = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(code).toContain("g.template_name IN ('action','madness','lightning')");
    expect(code).toContain("lower(g.variant) IN ('nlh','plo4','plo5','plo6')");
    expect(code).not.toMatch(/\bi?like\b/i);
    expect(code).not.toMatch(/\bname\s*(=|~)/i);
  });

  it('refuses itself if this transaction wrote any row that is not a Lightning row', () => {
    expect(sql).toMatch(/games that are not Lightning games were written/);
    expect(sql).toMatch(/tables that are not open Lightning tables were written/);
    expect(sql).toMatch(/a rule other than the floor changed on a Lightning game/);
    expect(sql).toMatch(/madness_without_lightning games left 40/);
  });

  it('refuses itself if an open Lightning game or table is left on another floor', () => {
    expect(sql).toMatch(/open Lightning games did not land on 25/);
    expect(sql).toMatch(/open Lightning tables did not land on 25/);
  });

  it('writes one column on the tables, and only the tables the ruleset projection writes', () => {
    expect(sql).toMatch(/UPDATE public\.tables t\s+SET maintain_percent_min = 25\s+FROM/);
    expect(sql).not.toMatch(/SET[^;]*maintain_hands\s*=/);
    expect(sql).toContain("t.lifecycle <> 'closed'");
    expect(sql).toContain('coalesce(t.is_deleted, false) = false');
  });

  it('leaves a retired club alone, because its records are read-only', () => {
    expect(sql).toContain("c.lifecycle_status = 'retired'");
  });

  it('is one transaction and re-runnable, because the merger dispatches it to the applier', () => {
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(sql).toMatch(/IS DISTINCT FROM '25'/);
    expect(sql).toMatch(/maintain_percent_min IS DISTINCT FROM 25/);
    expect(sql).not.toContain('@install-window');
  });
});

describe('the screens print the same floor', () => {
  it('one constant, and it is 25', () => {
    expect(LIGHTNING_VPIP_FLOOR).toBe(25);
    expect(LIGHTNING_RULES_SUMMARY).toBe('Big Blind Ante, 25% Minimum VPIP');
  });

  it('the format card and the lobby note read it', () => {
    expect(CASH_TEMPLATES.find((t) => t.id === 'madness')?.blurb).toContain('25% Minimum VPIP');
    expect(cashTemplateNote('madness')).toBe(LIGHTNING_RULES_SUMMARY);
    expect(cashTemplateNote('action')).toBe(LIGHTNING_RULES_SUMMARY);
  });

  it('the table badge accepts 25 as a real game rule', () => {
    expect(isAllowedVpipRequirement(LIGHTNING_VPIP_FLOOR)).toBe(true);
    expect([...ALLOWED_VPIP_REQUIREMENTS]).toContain(25);
  });

  it('no Lightning module states a floor of its own', () => {
    // The engine reads tables.maintain_percent_min (fn_nit_policy for the
    // judgement, loadHostRules per pool hand): a number written into a
    // Lightning module would be a second answer.
    const dir = path.join(ROOT, 'server/src/lightning');
    const offenders = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !/\.test\.|test-support|TestKit/.test(f))
      .filter((f) =>
        fs
          .readFileSync(path.join(dir, f), 'utf8')
          .split('\n')
          .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
          .some((l) =>
            /maintain_percent_min\s*(\?\?\s*)?(===|==|>=|<=|>|<|=)\s*(25|30|40|50)\b/.test(l)
          )
      );
    expect(offenders).toEqual([]);
  });
});
