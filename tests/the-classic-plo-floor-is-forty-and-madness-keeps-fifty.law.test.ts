/**
 * ===========================================================================
 *  LAW: THE CLASSIC PLO FLOOR IS 40 AND MADNESS KEEPS 50
 * ===========================================================================
 *
 * Dan, 2026-11-17: "lower the vpip down to 40%", and then, so it could not be
 * read as a blanket: 50% is "for all madness games ... 50% VPIP only".
 *
 * The floor a Classic plo5/plo6 table keeps was never one number in one place.
 * `fn_cash_game_floor_from_template` resolves the template default first and
 * then RAISES it with GREATEST against the `ca_classic_vpip_floors` config row,
 * so the live value was the larger of two numbers that both read 50. Changing
 * either alone is a no-op that still looks applied. Migration 20261118004324
 * moves both, and this law pins that it keeps moving both.
 *
 * The other half matters more. Madness is identified elsewhere in this estate
 * BY THE NUMBER 50:
 *
 *   - `server/src/services/HorseMadnessSelection.ts` treats a plo5 table with
 *     bombs, the big-blind ante, the nit game and `maintain_percent_min === 50`
 *     as Madness, and only there orders horse candidates by measured PLO
 *     performance.
 *   - `20261024200548_plo5_one_two_madness_without_lightning.sql` carries an
 *     `@live-proof` asserting that cluster still reads exactly 50.
 *
 * Before 2026-11-17 Classic plo5 also sat at 50, so that check was true for
 * tables that were never Madness. Lowering Classic to 40 is what made it exact.
 * A later edit that lowered Madness too, or that swept every nit table to one
 * value, would silently take the measured-performance ordering away from the
 * only tables it was built for, and would do it without failing a type check.
 * So this file reads the migration and refuses that edit.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION = path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20261118004324_the_classic_plo_vpip_floor_is_forty.sql'
);

describe('the classic plo floor is forty and madness keeps fifty', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');

  it('pins the pre-image and the post-image, so drift is refused not installed', () => {
    expect(sql).toContain('112ace6ab51cebe8a86a75e5701eb911');
    expect(sql).toContain('6ad34a35974530555157dcf9e4f299c6');
    expect(sql).toMatch(/RAISE EXCEPTION 'fn_cash_template_defaults drifted/);
    expect(sql).toMatch(/post-image is %, expected 6ad34a35974530555157dcf9e4f299c6/);
  });

  it('writes the whole function out, so the laws that read it can still see it', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_cash_template_defaults');
    // The 50 BB minimum law reads the newest definition of this function.
    expect(sql).toContain("'min_buyin_bb',50,");
  });

  it('sets the classic plo arm to 40 and leaves no 50 arm behind', () => {
    expect(sql).toContain("v IN ('plo5','plo6') THEN 40");
    expect(sql).not.toContain("v IN ('plo5','plo6') THEN 50");
  });

  it('is re-runnable, because the merger dispatches it to the applier', () => {
    expect(sql).toMatch(/^\s*BEGIN;/m);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    for (const guard of [
      /floor_percent IS DISTINCT FROM 40/,
      /\(ruleset_snapshot->>'vpip_floor'\) IS DISTINCT FROM '40'/,
      /t\.maintain_percent_min IS DISTINCT FROM 40/,
    ]) {
      expect(sql).toMatch(guard);
    }
  });

  it('moves the config row too, because GREATEST would keep the higher one', () => {
    expect(sql).toMatch(/UPDATE public\.ca_classic_vpip_floors/);
    expect(sql).toMatch(/SET floor_percent = 40/);
    expect(sql).toMatch(/WHERE variant IN \('plo5', 'plo6'\)/);
  });

  it('excludes madness from every write it makes', () => {
    const writes = sql.split(/UPDATE public\./).slice(1);
    const touchingClusters = writes.filter((w) => w.startsWith('cash_games'));
    const touchingTables = writes.filter((w) => w.startsWith('tables'));
    expect(touchingClusters.length).toBeGreaterThan(0);
    expect(touchingTables.length).toBeGreaterThan(0);
    for (const w of [...touchingClusters, ...touchingTables]) {
      expect(w).toContain("<> 'madness_without_lightning'");
    }
  });

  it('leaves a retired club alone, because its records are read-only', () => {
    expect(sql).toContain("c.lifecycle_status <> 'retired'");
  });

  it('refuses itself if madness lost its 50 or classic missed 40', () => {
    expect(sql).toMatch(/classic plo5 template default is %, expected 40/);
    expect(sql).toMatch(/ca_classic_vpip_floors plo5\/plo6 is %, expected 40/);
    expect(sql).toMatch(/live classic plo clusters did not land on 40/);
    expect(sql).toMatch(/madness_without_lightning clusters lost their 50 floor/);
  });

  it('never lowers madness anywhere in the file', () => {
    expect(sql).not.toMatch(/madness_without_lightning[\s\S]{0,200}?vpip_floor', *40/);
  });
});

describe('the madness detector still reads an exact 50', () => {
  const selector = fs.readFileSync(
    path.join(__dirname, '..', 'server', 'src', 'services', 'HorseMadnessSelection.ts'),
    'utf8'
  );

  it('keeps the identity test exact, never a threshold', () => {
    expect(selector).toContain('Number(table.maintain_percent_min) === 50');
    expect(selector).not.toMatch(/maintain_percent_min\s*\)\s*>=/);
  });
});
