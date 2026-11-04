import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./terminalDurableRequest.js', () => ({ readDurableTerminalRequest: mocks.read }));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
import { GameServer } from '../GameServer.js';
beforeEach(() => vi.clearAllMocks());
function server() {
  return Object.assign(Object.create(GameServer.prototype), {
    tournamentEngines: new Map(),
    directAdmissionIsCurrent: vi.fn(() => true),
    ensureTournamentManagerAdmission: vi.fn().mockResolvedValue(undefined),
  });
}
describe('original terminal discovery isolates each event', () => {
  it('fences an unreadable first event and still admits the healthy next original', async () => {
    const owner = server();
    mocks.read
      .mockRejectedValueOnce(new Error('unreadable'))
      .mockResolvedValueOnce({ requestId: 'original' });
    const legacy: string[] = [];
    for (const id of ['unreadable', 'healthy']) {
      if (await owner.admitOriginalTerminalContinuation(id, 7)) continue;
      legacy.push(id);
    }
    expect(legacy).toEqual([]);
    expect(owner.ensureTournamentManagerAdmission.mock.calls).toEqual([
      ['healthy', 'resume', 'original terminal continuation', 7],
    ]);
    const source = readFileSync(new URL('../GameServer.ts', import.meta.url), 'utf8');
    expect(source).toContain(
      'if (await this.admitOriginalTerminalContinuation(stuck.id, generation)) continue;'
    );
  });
  it('a shutdown during the read admits neither original nor legacy reconstruction', async () => {
    const owner = server();
    mocks.read.mockImplementation(async () => {
      owner.directAdmissionIsCurrent.mockReturnValue(false);
      return { requestId: 'original' };
    });
    expect(await owner.admitOriginalTerminalContinuation('event', 7)).toBe(true);
    expect(owner.ensureTournamentManagerAdmission).not.toHaveBeenCalled();
  });
});
