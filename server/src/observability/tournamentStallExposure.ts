import { HELD_STALL_MS } from '../engine/heldTableStall.js';

type Format = 'mtt' | 'spin' | 'sng' | 'satellite';

interface Table {
  tableId: string;
  gameFormat: Format | 'cash' | null;
  satellite?: boolean;
  seated: number;
  dealable: number;
  paused: boolean;
  msSinceProgress: number;
}

/** Sample population and impact together, without exporting a time series per table. */
export function tournamentStallExposure(
  tables: readonly Table[],
  heldMs: ReadonlyMap<string, number>
): string[] {
  const formats: Format[] = ['mtt', 'spin', 'sng', 'satellite'];
  const groups = new Map<
    Format,
    { active: number; stalled: number; seats: number; worstMs: number }
  >();
  for (const format of formats) {
    groups.set(format, { active: 0, stalled: 0, seats: 0, worstMs: 0 });
  }
  for (const table of tables) {
    const format = table.satellite ? 'satellite' : table.gameFormat;
    if (!format || format === 'cash') continue;
    const held = heldMs.get(table.tableId);
    if (held === undefined && (table.paused || table.dealable < 2)) continue;
    const group = groups.get(format)!;
    group.active++;
    const age = held ?? table.msSinceProgress;
    if (age < HELD_STALL_MS) continue;
    group.stalled++;
    group.seats += table.seated;
    group.worstMs = Math.max(group.worstMs, age);
  }
  const lines: string[] = [];
  for (const [format, group] of groups) {
    const labels = '{format="' + format + '"}';
    lines.push(
      'poker_tournament_observed_active_tables' + labels + ' ' + group.active,
      'poker_tournament_observed_stalled_tables' + labels + ' ' + group.stalled,
      'poker_tournament_observed_stalled_seats' + labels + ' ' + group.seats,
      'poker_tournament_observed_longest_stall_ms' + labels + ' ' + group.worstMs
    );
  }
  return lines;
}
