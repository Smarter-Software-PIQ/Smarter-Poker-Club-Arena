import { describe, expect, it } from 'vitest';
import { resolveSeatSitOut } from '../../src/utils/mapEngineSnapshot';

describe('seat sit-out status during reconnect', () => {
  it('keeps a server-confirmed sit-out visible when the row still says active', () => {
    expect(resolveSeatSitOut({ is_sitting_out: true, position: 'BB' }, false)).toBe(true);
  });

  it('does not apply a stale sit-out row to a player in the current hand', () => {
    expect(resolveSeatSitOut({ is_sitting_out: false, position: 'BB' }, true)).toBe(false);
  });

  it('keeps the row fallback before a position is assigned or the engine has connected', () => {
    expect(resolveSeatSitOut({ is_sitting_out: false, position: '' }, true)).toBe(true);
    expect(resolveSeatSitOut(undefined, true)).toBe(true);
    expect(resolveSeatSitOut(undefined, false)).toBe(false);
  });
});
