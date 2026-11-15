/**
 * The stats card shares a picture AND the player's link (2026-11-15). A
 * picture alone gave whoever received it nowhere to go. Presentation mode
 * hides who the player is, so it carries no link at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const shareFile = vi.fn().mockResolvedValue('saved');
vi.mock('../../src/lib/share', () => ({
  shareFile: (...args: unknown[]) => shareFile(...args),
  hasShareSheet: () => false,
  profileShareUrl: (id: string) => `https://smarter.poker/hub/club-arena/profile/${id}`,
}));

import StatsShareCard from '../../src/components/stats/StatsShareCard';

const STATS = { hands: 1200, bb100: 4.2, profit: 310, vpip: 24, pfr: 18, hoursPlayed: 12 };

describe('the stats card carries the player link', () => {
  const original = HTMLCanvasElement.prototype.toBlob;
  beforeEach(() => {
    shareFile.mockClear();
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(new Blob(['png'], { type: 'image/png' }));
    };
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.toBlob = original;
  });

  it('shares the public profile link with the picture', async () => {
    render(<StatsShareCard displayName="Mongo" stats={STATS} profileUserId="user-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save Image' }));
    await waitFor(() => expect(shareFile).toHaveBeenCalledTimes(1));
    expect(shareFile.mock.calls[0][0]).toMatchObject({
      source: 'StatsShareCard.share',
      url: 'https://smarter.poker/hub/club-arena/profile/user-1',
      text: 'My Poker Stats On Smarter.Poker',
    });
  });

  it('carries no link in presentation mode', async () => {
    render(
      <StatsShareCard
        displayName="Mongo"
        stats={STATS}
        profileUserId="user-1"
        privacyPresentationMode
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save Image' }));
    await waitFor(() => expect(shareFile).toHaveBeenCalledTimes(1));
    const input = shareFile.mock.calls[0][0] as Record<string, unknown>;
    expect(input.url).toBeUndefined();
    expect(JSON.stringify(input)).not.toContain('user-1');
  });
});
