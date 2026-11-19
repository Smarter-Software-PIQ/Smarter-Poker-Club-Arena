/**
 * ===========================================================================
 *  LAW: THE FORMAT CARD PRINTS THE FLOOR THE TEMPLATE ENFORCES
 * ===========================================================================
 *
 * 2026-11-19: the Classic card in the New Cash Game flow still promised a
 * "50% Minimum VPIP" for PLO5 and PLO6 two days after the owner lowered that
 * floor to 40 (2026-11-17, migration 20261118004324). The card was a typed
 * sentence; the floor lives in fn_cash_template_defaults, which the engine's
 * tables copy (fn_cash_apply_ruleset -> tables.maintain_percent_min).
 *
 * So this law reads the NEWEST definition of fn_cash_template_defaults in any
 * migration, works each template's floor out of its SQL CASE arm by arm, and
 * requires every card sentence and client constant to print exactly that
 * number. A migration that moves a floor without the card fails here.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CASH_TEMPLATES,
  CLASSIC_ANTE_AND_FLOOR_VARIANTS,
  CLASSIC_PLO5_PLO6_BLURB,
  CLASSIC_PLO5_PLO6_VPIP_FLOOR,
  LIGHTNING_RULES_SUMMARY,
  LIGHTNING_VPIP_FLOOR,
  cashTemplateBlurb,
} from '../src/config/cashGames';

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'supabase/migrations');

function newestTemplateBody(): { file: string; body: string } {
  const head = /CREATE OR REPLACE FUNCTION public\.fn_cash_template_defaults\(/;
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
    const at = sql.search(head);
    if (at < 0) continue;
    const open = /AS (\$[A-Za-z_]*\$)/.exec(sql.slice(at));
    if (!open) throw new Error(`${file} defines the template without a dollar-quoted body`);
    const from = at + open.index + open[0].length;
    return { file, body: sql.slice(from, sql.indexOf(open[1], from)) };
  }
  throw new Error('no migration defines fn_cash_template_defaults');
}

/** The template's floor for one template and variant, read from the SQL CASE in order. */
function floorFromSql(body: string, template: string, variant: string): number {
  const t = ['action', 'madness', 'lightning'].includes(template) ? 'madness' : template;
  const expr = /'vpip_floor',\s*CASE\s+([\s\S]*?)\s+END\s*,\s*'vpip_window'/.exec(body);
  if (!expr) throw new Error('the template no longer answers vpip_floor with one CASE');
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
  for (const arm of expr[1].split(/\s+(?=WHEN\b|ELSE\b)/)) {
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

const { body } = newestTemplateBody();
const blurb = Object.fromEntries(CASH_TEMPLATES.map((t) => [t.id, t.blurb]));
const CLASSIC_NO_FLOOR = ['nlh', 'plo4', 'plo8', 'flh', 'flo8', 'short_deck', 'pineapple'];
const LIGHTNING = ['nlh', 'plo4', 'plo5', 'plo6'];

describe('the Classic card prints the Classic template floor', () => {
  it('PLO5 and PLO6 Classic: the constant is the template answer', () => {
    for (const v of CLASSIC_ANTE_AND_FLOOR_VARIANTS) {
      expect(floorFromSql(body, 'classic', v), `classic ${v}`).toBe(CLASSIC_PLO5_PLO6_VPIP_FLOOR);
    }
  });

  it('the card sentences print that number and no other', () => {
    const want = `${CLASSIC_PLO5_PLO6_VPIP_FLOOR}% Minimum VPIP`;
    expect(blurb.classic).toContain(want);
    expect(CLASSIC_PLO5_PLO6_BLURB).toContain(want);
    for (const v of CLASSIC_ANTE_AND_FLOOR_VARIANTS) {
      expect(cashTemplateBlurb('classic', v)).toBe(CLASSIC_PLO5_PLO6_BLURB);
    }
    for (const s of [blurb.classic, CLASSIC_PLO5_PLO6_BLURB]) {
      expect(s.match(/\d+% Minimum VPIP/g)).toEqual([want]);
    }
  });

  it('every other Classic game has no floor, as the card says', () => {
    for (const v of CLASSIC_NO_FLOOR) {
      expect(floorFromSql(body, 'classic', v), `classic ${v}`).toBe(0);
      expect(cashTemplateBlurb('classic', v)).toBe(blurb.classic);
    }
    expect(blurb.classic).toContain('Every Other Game Has No Ante And No Minimum VPIP');
  });
});

describe('the Lightning card prints the Lightning template floor', () => {
  it('every Lightning variant answers the constant', () => {
    for (const v of LIGHTNING) {
      expect(floorFromSql(body, 'madness', v), `madness ${v}`).toBe(LIGHTNING_VPIP_FLOOR);
    }
    expect(blurb.madness).toContain(LIGHTNING_RULES_SUMMARY);
    expect(blurb.madness.match(/\d+% Minimum VPIP/g)).toEqual([
      `${LIGHTNING_VPIP_FLOOR}% Minimum VPIP`,
    ]);
  });
});

describe('a loaded template answer wins over the client constant', () => {
  it('the selected card prints the floor the database answered', () => {
    expect(
      cashTemplateBlurb('classic', 'plo5', { template: 'classic', variant: 'plo5', vpip_floor: 35 })
    ).toContain('35% Minimum VPIP');
    expect(
      cashTemplateBlurb('madness', 'plo4', { template: 'madness', variant: 'plo4', vpip_floor: 20 })
    ).toContain('20% Minimum VPIP');
  });

  it('an answer for another template or variant never leaks onto a card', () => {
    const other = { template: 'madness' as const, variant: 'plo5', vpip_floor: 20 };
    expect(cashTemplateBlurb('classic', 'plo5', other)).toBe(CLASSIC_PLO5_PLO6_BLURB);
    expect(cashTemplateBlurb('madness', 'plo6', other)).toBe(blurb.madness);
  });

  it('the create flow passes the loaded answer to every card', () => {
    const flow = fs.readFileSync(
      path.join(ROOT, 'src/components/cash/CashGameCreateFlow.tsx'),
      'utf8'
    );
    expect(flow).toContain('cashTemplateBlurb(t.id, variant, snapshot)');
  });
});

describe('no client sentence types a floor by hand', () => {
  it('cashGames.ts states every Minimum VPIP number through a constant', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/config/cashGames.ts'), 'utf8');
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join('\n');
    expect(code).not.toMatch(/\b\d+% Minimum VPIP/);
  });
});
