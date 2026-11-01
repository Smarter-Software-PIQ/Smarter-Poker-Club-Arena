import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Run 41280281132 (World Hub suite messenger-calls-clubarena): on a cold load
 * straight onto a table, the header notifications channel joined before the
 * realtime socket was authorised. Row level security then dropped every
 * notifications INSERT and passed only DELETEs, so a ringing call, a new
 * message and the bell count never reached a player at a table. The channel
 * must join through subscribeRealtime, which waits for the shared realtime
 * admission, like every other page channel.
 */
const store = readFileSync(resolve(process.cwd(), 'src/stores/useHeaderDataStore.ts'), 'utf8');

describe('the header notifications channel joins as the signed-in player', () => {
  it('subscribes through the shared realtime admission', () => {
    expect(store).toMatch(/import \{ subscribeRealtime \} from '\.\.\/lib\/subscribeRealtime';/);
    expect(store).toMatch(/void subscribeRealtime\(\s*channel,/);
  });

  it('never calls subscribe() on the channel directly', () => {
    expect(store).not.toMatch(/\.subscribe\(\(status/);
  });

  it('abandons a pending admission when the store is torn down or the user changes', () => {
    expect(store).toMatch(/const admission = new AbortController\(\);/);
    expect(store).toMatch(/_busUnsubscribers: \[\s*stopAdmission,/);
  });
});
