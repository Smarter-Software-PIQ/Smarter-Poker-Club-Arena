/**
 * LAW: a poll that backs up a realtime channel follows one shared rule.
 * ═══════════════════════════════════════════════════════════════════════════
 * Added 2026-11-27 (client performance review, finding 10). Surfaces that open
 * a Supabase Realtime channel and also re-read the same rows on a timer each
 * hand-rolled that timer, and two Table Studio reads ran every two seconds for
 * the whole life of a HEALTHY channel, while a sign-in pairing wait polled
 * every 2.5 s regardless of its channel. The rule now lives in one place,
 * `src/lib/realtimeAwarePoll.ts` (React face: `src/hooks/useRealtimeAwarePoll.ts`):
 * fast while the channel is not SUBSCRIBED, a slow safety cadence (default
 * 30 s) or nothing while it is, fast again the moment it drops.
 *
 * WHAT THIS LAW CAN SEE, AND WHAT IT CANNOT.
 * A static scan cannot prove what a timer reads or which channel it shadows,
 * so this is a ratchet over the files where the mistake can be made: every
 * client file that opens a realtime channel (`.channel(`,
 * `getOrCreateChannel(`, `useMasterBusChannel(`, `useMasterBusBroadcastChannel(`)
 * must account for each raw `setInterval(` it contains in the inventory below,
 * with the reason it is not a realtime-backed poll (a display clock, a write,
 * or a read of a table the `supabase_realtime` publication does not carry, so
 * the channel answers SUBSCRIBED and delivers nothing and the read is the only
 * path). A new raw interval in such a file fails here until it either goes
 * through the shared rule or is added to the inventory with its reason. A poll
 * in a file with no channel of its own, shadowing a channel opened elsewhere,
 * is outside what a per-file scan can attribute; the shared module's header
 * says when to use it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

/* Every raw setInterval in a channel-owning client file, counted, with why it
   is not a realtime-backed poll. Keep the reasons honest: "the table is not
   published" is checked against pg_publication_tables, not assumed. */
const INVENTORY: Record<string, { count: number; why: string }> = {
  'src/components/table/RealTimeResultPanel.tsx': {
    count: 1,
    why: 'one-second display clock while the card is open; its channel is observer presence',
  },
  'src/components/table/TournamentBreakScreen.tsx': {
    count: 1,
    why: 'break countdown display clock',
  },
  'src/components/tournament/TournamentClock.tsx': {
    count: 2,
    why: 'level countdown clock, and a 30 s read because tournament_players is not published, so its channel delivers nothing',
  },
  'src/core/MasterBus.ts': {
    count: 1,
    why: 'channel health monitor, not a data read',
  },
  'src/lib/diamondJackpotFeed.ts': {
    count: 1,
    why: 'already a 60 s safety read beside its channel, no fast cadence to drop',
  },
  'src/pages/CashierPage.tsx': { count: 1, why: 'three-second button cooldown display' },
  'src/pages/CashierTradePage.tsx': { count: 1, why: 'one-second display clock' },
  'src/pages/ClubHomePage.tsx': {
    count: 2,
    why: '20 s occupancy read and 90 s lobby net; tables and tournaments are not published (the waitlist count poll moved to src/lib/gameWaitlistWatch.ts, on the shared rule)',
  },
  'src/pages/MultiTablePage.tsx': {
    count: 3,
    why: 'two one-second clocks, and the quick-join spin read; tables and tournaments are not published',
  },
  'src/pages/TablePage.tsx': {
    count: 14,
    why: 'chest offer retry (bounded), heartbeat write, sit-out, seat-fill, run-it-twice, buy-in and time bank clocks, winner label watchdog, hero card recovery while blind, bounty heads, tournament follow and engine reconnect nudges, and two table_seats reads (table_seats is not published)',
  },
  'src/pages/TournamentPage.tsx': {
    count: 4,
    why: 'list and detail reads (tournaments is not published), a countdown clock, and the tables read (no carrier)',
  },
  'src/pages/UnionDetailPage.tsx': { count: 1, why: 'online count RPC, no carrier' },
  'src/pages/club/ClubDashboard.tsx': { count: 1, why: '"Updated Xs ago" label clock' },
  'src/pages/club/ClubDataPage.tsx': {
    count: 2,
    why: 'telemetry label clock, and the report aggregates read (no carrier)',
  },
  'src/pages/tournament/TournamentDetails.tsx': {
    count: 2,
    why: 'late registration clock, and the tournament read (tournaments is not published)',
  },
  'src/services/TournamentTimerService.ts': { count: 1, why: 'countdown clock' },
  'src/services/VoiceSignalService.ts': {
    count: 2,
    why: 'audio level sampling and silence detection, no network',
  },
  'src/stores/useHeaderDataStore.ts': {
    count: 1,
    why: 'messages badge drift read; a conversation read in the Hub raises no event',
  },
};

/* The polls that DO back up a working carrier, and must keep using the rule. */
const SHARED_RULE_SITES: Record<string, RegExp> = {
  'src/components/table/ThemeSettingsModal.tsx': /useRealtimeAwarePoll\(/g,
  'src/lib/activeLogin.ts': /startRealtimeAwarePoll\(/g,
  'src/lib/gameWaitlistWatch.ts': /startRealtimeAwarePoll\(/g,
};
const SHARED_RULE_MINIMUM: Record<string, number> = {
  'src/components/table/ThemeSettingsModal.tsx': 2,
  'src/lib/activeLogin.ts': 1,
  'src/lib/gameWaitlistWatch.ts': 1,
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

/* Comments mention setInterval and channels in prose; only code counts. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const OWNS_CHANNEL =
  /\.channel\s*\(|getOrCreateChannel\s*\(|useMasterBusChannel\s*\(|useMasterBusBroadcastChannel\s*\(/;
const RAW_INTERVAL = /\bsetInterval\s*\(/g;

function scan(): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of sourceFiles(SRC)) {
    const body = code(readFileSync(file, 'utf8'));
    const count = (body.match(RAW_INTERVAL) || []).length;
    if (count > 0 && OWNS_CHANNEL.test(body)) found.set(relative(ROOT, file), count);
  }
  return found;
}

describe('realtime-backed polls use the shared rule', () => {
  const found = scan();

  it('every raw interval in a channel-owning file is accounted for', () => {
    const problems: string[] = [];
    for (const [file, count] of found) {
      const entry = INVENTORY[file];
      if (!entry) {
        problems.push(
          `${file} opens a realtime channel and has ${count} raw setInterval call(s). ` +
            'If one re-reads what the channel delivers, run it through ' +
            'useRealtimeAwarePoll / startRealtimeAwarePoll (src/lib/realtimeAwarePoll.ts). ' +
            'Otherwise add the file to INVENTORY with the reason.'
        );
      } else if (entry.count !== count) {
        problems.push(
          `${file} has ${count} raw setInterval call(s); the inventory accounts for ${entry.count}. ` +
            'A new interval beside a realtime channel goes through the shared rule, or is ' +
            'added here with its reason; a removed one lowers the count.'
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it('the inventory names no file that no longer needs it', () => {
    const ghosts = Object.keys(INVENTORY).filter((file) => !found.has(file));
    expect(ghosts).toEqual([]);
  });

  it('the polls that shadow a working carrier keep using the shared rule', () => {
    for (const [file, pattern] of Object.entries(SHARED_RULE_SITES)) {
      const body = code(readFileSync(join(ROOT, file), 'utf8'));
      const uses = (body.match(pattern) || []).length;
      expect(uses, file).toBeGreaterThanOrEqual(SHARED_RULE_MINIMUM[file]);
    }
    const studio = code(
      readFileSync(join(ROOT, 'src/components/table/ThemeSettingsModal.tsx'), 'utf8')
    );
    const pairing = code(readFileSync(join(ROOT, 'src/lib/activeLogin.ts'), 'utf8'));
    const waitlist = code(readFileSync(join(ROOT, 'src/lib/gameWaitlistWatch.ts'), 'utf8'));
    expect(studio.match(RAW_INTERVAL) || []).toHaveLength(0);
    expect(pairing.match(RAW_INTERVAL) || []).toHaveLength(0);
    expect(waitlist.match(RAW_INTERVAL) || []).toHaveLength(0);
  });

  it('the shared rule is the one place a realtime-backed cadence is chosen', () => {
    const rule = readFileSync(join(ROOT, 'src/lib/realtimeAwarePoll.ts'), 'utf8');
    expect(rule).toMatch(/export const REALTIME_SAFETY_POLL_MS = 30_000;/);
    expect(rule).toMatch(/cadence = stopped \? null : isLive \? slowMs : fastMs;/);
    const hook = readFileSync(join(ROOT, 'src/hooks/useRealtimeAwarePoll.ts'), 'utf8');
    expect(hook).toContain('startRealtimeAwarePoll(');
    expect(code(hook).match(RAW_INTERVAL) || []).toHaveLength(0);
  });
});
