import { describe, expect, it } from 'vitest';
import { tournamentBoardScope } from '../e2e/support/lobbySourceCensus';

const club = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
const union = 'fade0000-0000-0000-0000-000000000001';
function board() {
  const url = new URL('https://public.example/rest/v1/tournaments');
  url.searchParams.set(
    'select',
    'format_contract,id,name,game_type,buy_in_amount,buy_in_fee,start_time,status,current_players,max_players,club_id,variant,is_private,union_id,blind_structure'
  );
  url.searchParams.set('status', 'in.(REGISTERING,RUNNING,LATE_REG,STARTING_SOON,BAGGED)');
  url.searchParams.set('start_time', 'lte.2026-11-08T01:08:00.000Z');
  url.searchParams.set('order', 'start_time.asc');
  url.searchParams.set('limit', '500');
  url.searchParams.set('or', `(union_id.eq.${union},and(club_id.eq.${club},is_private.eq.true))`);
  return url;
}
describe('independent lobby census provenance', () => {
  it('does not let an initial club-only ancillary query replace the later union board scope', () => {
    const ancillary = board();
    ancillary.searchParams.delete('or');
    ancillary.searchParams.delete('start_time');
    ancillary.searchParams.set('club_id', `eq.${club}`);
    ancillary.searchParams.set('order', 'created_at.desc');
    expect(tournamentBoardScope(ancillary, club)).toBeUndefined();
    expect(tournamentBoardScope(board(), club)).toEqual({ unionId: union, clubIds: [club] });
  });
  it('preserves independently scoped standalone siblings', () => {
    const url = board();
    url.searchParams.delete('or');
    url.searchParams.set('club_id', `in.(${union},${club})`);
    expect(tournamentBoardScope(url, club)).toEqual({
      unionId: null,
      clubIds: [club, union].sort(),
    });
  });
  it.each(['id', 'name', 'format_contract', 'offset'])('rejects a partial %s census', (key) => {
    const url = board();
    url.searchParams.set(key, key === 'offset' ? '1' : 'eq.value');
    expect(tournamentBoardScope(url, club)).toBeUndefined();
  });
  it('does not admit a narrow projection or a different status cohort', () => {
    const url = board();
    url.searchParams.set('select', 'id,name,start_time');
    expect(tournamentBoardScope(url, club)).toBeUndefined();
    const status = board();
    status.searchParams.set('status', 'eq.REGISTERING');
    expect(tournamentBoardScope(status, club)).toBeUndefined();
  });
  it('fails closed for missing or foreign main-board membership', () => {
    const missing = board();
    missing.searchParams.delete('or');
    expect(() => tournamentBoardScope(missing, club)).toThrow(/membership scope/);
    const foreign = board();
    foreign.searchParams.set(
      'or',
      `(union_id.eq.${union},and(club_id.eq.${union},is_private.eq.true))`
    );
    expect(() => tournamentBoardScope(foreign, club)).toThrow(/membership scope/);
  });
});
