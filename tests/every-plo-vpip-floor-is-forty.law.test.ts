/**
 * ===========================================================================
 *  LAW: EVERY PLO VPIP FLOOR IS 40, AND MADNESS IS A RULESET NOT A NUMBER
 * ===========================================================================
 *
 * Dan, 2026-11-17: "lower the vpip down to 40%", and then, when the first pass
 * left the Madness cluster behind, "PLO5 MADNESS NEEDS TO GO TO 40".
 *
 * Two migrations carry it. 20261118004324 took Classic plo5/plo6 from 50 to 40,
 * which needed BOTH sources moved - fn_cash_game_floor_from_template resolves
 * the template default and then RAISES it with GREATEST against the
 * ca_classic_vpip_floors row, so changing either alone is a no-op that still
 * reads as applied. 20261118025205 then took the madness_without_lightning
 * cluster to 40 by removing the explicit 50 the trigger pinned for it.
 *
 * THE DANGEROUS HALF IS THE IDENTITY, NOT THE FLOOR.
 * `server/src/services/HorseMadnessSelection.ts` used to decide a table was
 * Madness by `Number(table.maintain_percent_min) === 50`, because 50 was the
 * value only that profile carried. Moving Madness to 40 would have made that
 * condition stop matching, switching the measured-PLO horse ordering off with
 * no failing test and no log line. And simply deleting the floor clause would
 * have been worse: Lightning and Action plo5 tables carry the same bomb pot,
 * big-blind ante, nit game AND the same 40, so they would have started being
 * ordered as Madness.
 *
 * So the identity is now the ruleset the trigger itself keys on,
 * `rules_profile = 'madness_without_lightning'`, kept inside the original plo5
 * scope. This law pins both halves: no 50 survives in the sources, and the
 * selector never goes back to deciding Madness by a number.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const CLASSIC = 'supabase/migrations/20261118004324_the_classic_plo_vpip_floor_is_forty.sql';
const MADNESS = 'supabase/migrations/20261118025205_madness_plo5_vpip_floor_is_forty.sql';

describe('the classic plo floor moved both of its sources', () => {
  const sql = read(CLASSIC);

  it('pins the pre-image and the post-image of the defaults function', () => {
    expect(sql).toContain('112ace6ab51cebe8a86a75e5701eb911');
    expect(sql).toContain('6ad34a35974530555157dcf9e4f299c6');
  });

  it('writes the whole function out, so the laws that read it can see it', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_cash_template_defaults');
    expect(sql).toContain("'min_buyin_bb',50,");
  });

  it('sets the classic plo arm to 40 and leaves no 50 arm behind', () => {
    expect(sql).toContain("v IN ('plo5','plo6') THEN 40");
    expect(sql).not.toContain("v IN ('plo5','plo6') THEN 50");
  });

  it('moves the config row too, because GREATEST would keep the higher one', () => {
    expect(sql).toMatch(/UPDATE public\.ca_classic_vpip_floors/);
    expect(sql).toMatch(/SET floor_percent = 40/);
  });
});

describe('madness came to 40 and stopped being identified by a number', () => {
  const sql = read(MADNESS);

  it('pins the floor trigger it rewrites, pre and post', () => {
    expect(sql).toContain('b45a0612b5c6956dfe33c632446caee9');
    expect(sql).toContain('5b0b03754daf121c77d2a451bb9f8839');
  });

  it('removes the explicit 50 the madness branch pinned', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_cash_game_floor_from_template');
    expect(sql).not.toContain("'vpip_floor', 50");
    expect(sql).toContain("rules_profile' = 'madness_without_lightning'");
  });

  it('keeps the floor trigger feeding the template minimum through', () => {
    expect(sql).toContain("'min_buyin_bb', v_def->'min_buyin_bb'");
  });

  it('refuses itself if any open cluster is left on 50', () => {
    expect(sql).toMatch(/open clusters still carry a 50 percent floor/);
    expect(sql).toMatch(/live madness tables did not land on 40/);
  });

  it('leaves a retired club alone, because its records are read-only', () => {
    expect(sql).toContain("c.lifecycle_status <> 'retired'");
  });

  it('is re-runnable, because the merger dispatches it to the applier', () => {
    expect(sql).toMatch(/^\s*BEGIN;/m);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(sql).toMatch(/IS DISTINCT FROM '40'/);
    expect(sql).toMatch(/maintain_percent_min IS DISTINCT FROM 40/);
  });
});

describe('the madness selector reads the ruleset, never a floor value', () => {
  const sel = read('server/src/services/HorseMadnessSelection.ts');

  it('identifies madness by its rules profile', () => {
    expect(sel).toContain("rulesProfileOf(table) === 'madness_without_lightning'");
  });

  it('never decides madness from maintain_percent_min again', () => {
    const code = sel
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/maintain_percent_min\s*\)?\s*(===|==|>=|>)\s*\d+/);
  });

  it('keeps the plo5 scope it was measured on', () => {
    expect(sel).toContain("=== 'plo5'");
  });

  it('is fed the profile by the fleet manager', () => {
    const fleet = read('server/src/services/HorseFleetManager.ts');
    expect(fleet).toContain('rules_profile:ruleset_snapshot->>rules_profile');
    // The fleet manager only has to SELECT it; the selector reads the embedded
    // row itself, so the seating call site still passes the table unchanged
    // (pinned by HorseSitVerdict's "same pool, same table" law).
    expect(sel).toContain('function rulesProfileOf(');
  });
});
