/**
 * LAW: THE RAISE-DEFENCE FITS READ NO UNSHOWN HOLE CARD (2026-11-24).
 *
 * The owner's ruling: zero unshown hole cards read, live or stored, and that covers offline fitting. The first
 * realisation table of the hold'em tournament raise defence was fitted from ca_hand_facts with every player's
 * starting hand, cards never shown included; it was withdrawn and refitted in self-play
 * (realisation-selfplay.ts: league hands, every card the engine's own simulated players'). This law reads the
 * sources of every fit behind the raise-defence tables and holds them to it:
 *   - no source names ca_hand_facts or hand_class (per-player starting hands of production hands);
 *   - a SQL export may read hand_history.hole_cards only through the showdown list, a seat's cards only when the
 *     showdown does not mark them mucked (h.hole_cards->(s->>'user_id') with s over h.showdown and
 *     (s->>'mucked')::boolean is not true), besides naming the column in its source CTE;
 *   - the realisation fit reads no database (its offline placeholders are set before any import) and the committed
 *     table, and the tables built from it, carry the self-play version.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOLDEM_RAISE_DEFENCE_REALISATION } from './HorseHoldemTournamentRaiseDefenceSolved.data.js';

const SERVER = join(__dirname, '..', '..');
const SOLVE_DIR = join(SERVER, 'scripts', 'holdem-tournament-raise-defence-solve');
const FIT_SOURCES = [
  ...readdirSync(SOLVE_DIR)
    .filter((f) => /\.(py|ts|mts|mjs|sql|sh)$/.test(f))
    .map((f) => join(SOLVE_DIR, f)),
  join(SERVER, 'scripts', 'holdem-tournament-raise-defence-export.sql'),
  join(SERVER, 'scripts', 'holdem-tournament-raise-defence-fit.ts'),
  join(SERVER, 'scripts', 'holdem-preflop-class-equity-gen.ts'),
];
const SHOWN_READ = /h\.hole_cards(->|\s\?\s)\(s->>'user_id'\)/g;

describe('the raise-defence fits read no unshown hole card', () => {
  it('there are fit sources to read', () => {
    expect(FIT_SOURCES.length).toBeGreaterThanOrEqual(5);
  });

  it.each(FIT_SOURCES.map((f) => [f.slice(SERVER.length + 1), f]))(
    '%s: no per-player starting hands of production hands; hole_cards only through the shown showdown',
    (_name, file) => {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toMatch(/ca_hand_facts/);
      expect(src).not.toMatch(/\bhand_class\b/);
      const all = src.match(/hole_cards/g)?.length ?? 0;
      if (all === 0) return;
      // Only a SQL export may name it, and only through the showdown list.
      expect(file.endsWith('.sql')).toBe(true);
      const shown = src.match(SHOWN_READ)?.length ?? 0;
      const column = src.match(/select[^;]*\bhole_cards\b[^;]*from hand_history/i) ? 1 : 0;
      expect(all, 'every hole_cards read is the CTE column or a shown read').toBe(shown + column);
      expect(shown).toBeGreaterThan(0);
      expect(src).toMatch(/jsonb_array_elements\(coalesce\(h\.showdown/);
      expect(src).toMatch(/\(s->>'mucked'\)::boolean is not true/);
    }
  );

  it('the realisation is fitted in self-play, reads no database, and the tables carry its version', () => {
    const src = readFileSync(join(SOLVE_DIR, 'realisation-selfplay.ts'), 'utf8');
    const placeholder = src.indexOf("process.env.SUPABASE_URL = 'https://supabase.invalid'");
    expect(placeholder).toBeGreaterThan(0);
    expect(placeholder).toBeLessThan(src.indexOf('await import('));
    expect(src).not.toMatch(/api\.supabase\.com|SUPABASE_ACCESS_TOKEN|createClient|\.from\(/);
    const table = JSON.parse(readFileSync(join(SOLVE_DIR, 'realisation.json'), 'utf8'));
    expect(table.version).toBe('holdem-tournament-flop-realisation-selfplay-v2');
    expect(String(table.source)).toMatch(/self-play/);
    expect(HOLDEM_RAISE_DEFENCE_REALISATION.version).toBe(table.version);
    // The withdrawn fit and its export are gone.
    const files = readdirSync(SOLVE_DIR);
    expect(files).not.toContain('realisation-fit.py');
    expect(files).not.toContain('realisation-export.sql');
  });
});
