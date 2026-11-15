/**
 * Share buttons say what the tap does, and every tap is counted once
 * (2026-11-15, follow-up to "every share goes through one door").
 *
 * 1. A desktop browser has no share sheet, so "Share" there copies the link
 *    or saves the picture and nothing visibly opens. The resting word is
 *    Copy Link / Save Image where there is no sheet, Share where there is.
 * 2. Each outcome (shared, copied, saved, cancelled, failed) is one
 *    SHARE_OUTCOME row through this tab's own logger batch: the button and
 *    the outcome, never the link or the text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  copyText,
  profileShareUrl,
  setShareOutcomeSink,
  shareButtonLabel,
  shareFile,
  shareLink,
} from '../../src/lib/share';

const URL_ = 'https://smarter.poker/hub/club-arena/tournaments/abc';

/** Stands in for BusEventLogger.record, which registers itself on start. */
const record = vi.fn();
setShareOutcomeSink((source, outcome) => record('SHARE_OUTCOME', { source, outcome }));

/** Kept from the first version: the sink is synchronous, so nothing to wait for. */
async function settle() {
  await Promise.resolve();
}

describe('shareButtonLabel', () => {
  it('says Share where a system sheet opens', () => {
    expect(shareButtonLabel('link', true)).toBe('Share');
    expect(shareButtonLabel('image', true)).toBe('Share');
  });

  it('says what actually happens where there is no sheet', () => {
    expect(shareButtonLabel('link', false)).toBe('Copy Link');
    expect(shareButtonLabel('image', false)).toBe('Save Image');
  });

  it('reads the browser when not told: no navigator.share means Copy Link', () => {
    vi.stubGlobal('navigator', {});
    expect(shareButtonLabel()).toBe('Copy Link');
    vi.stubGlobal('navigator', { share: vi.fn() });
    expect(shareButtonLabel()).toBe('Share');
    vi.unstubAllGlobals();
  });
});

describe('share outcomes are counted once, without the link', () => {
  beforeEach(() => record.mockClear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a shared link is one row naming the button and the outcome only', async () => {
    vi.stubGlobal('navigator', { share: vi.fn().mockResolvedValue(undefined) });
    await shareLink({ source: 'TournamentBreakScreen.share', title: 'T', text: 'Come', url: URL_ });
    await settle();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('SHARE_OUTCOME', {
      source: 'TournamentBreakScreen.share',
      outcome: 'shared',
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain(URL_);
    expect(JSON.stringify(record.mock.calls)).not.toContain('Come');
  });

  it('a closed sheet is counted as cancelled, and copies nothing', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      share: vi.fn().mockRejectedValue(new DOMException('x', 'AbortError')),
      clipboard: { writeText },
    });
    await expect(shareLink({ source: 's', url: URL_ })).resolves.toBe('cancelled');
    await settle();
    expect(writeText).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith('SHARE_OUTCOME', { source: 's', outcome: 'cancelled' });
  });

  it('a copy on a desktop is counted as copied', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    await expect(shareLink({ source: 'TournamentDetails.share', url: URL_ })).resolves.toBe(
      'copied'
    );
    await settle();
    expect(record).toHaveBeenCalledWith('SHARE_OUTCOME', {
      source: 'TournamentDetails.share',
      outcome: 'copied',
    });
  });

  it('a picture whose download fails and falls back to the link is still ONE row', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const outcome = await shareFile({
      source: 'StatsShareCard.share',
      blob: new Blob(['x'], { type: 'image/png' }),
      filename: 'a.png',
      url: URL_,
      download: () => {
        throw new Error('no downloads here');
      },
    });
    expect(outcome).toBe('copied');
    await settle();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('SHARE_OUTCOME', {
      source: 'StatsShareCard.share',
      outcome: 'copied',
    });
  });

  it('a copy-only button is counted too, once, as copied or failed', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    await expect(copyText(URL_, 'ShareHand.copy')).resolves.toBe(true);
    await settle();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('SHARE_OUTCOME', { source: 'ShareHand.copy', outcome: 'copied' });
    record.mockClear();
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new DOMException('x', 'NotAllowedError')) },
    });
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn().mockReturnValue(false);
    await expect(copyText(URL_, 'ShareHand.copy')).resolves.toBe(false);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('SHARE_OUTCOME', { source: 'ShareHand.copy', outcome: 'failed' });
  });

  it('a saved picture is counted as saved', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const download = vi.fn();
    await expect(
      shareFile({
        source: 'AchievementShareCard.share',
        blob: new Blob(['x'], { type: 'image/png' }),
        filename: 'a.png',
        download,
      })
    ).resolves.toBe('saved');
    await settle();
    expect(download).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('SHARE_OUTCOME', {
      source: 'AchievementShareCard.share',
      outcome: 'saved',
    });
  });

  it('the door imports nothing from the logger; the logger registers itself on start', () => {
    const door = readFileSync(join(__dirname, '../../src/lib/share.ts'), 'utf8');
    expect(door).not.toMatch(/from ['"][^'"]*BusEventLogger['"]|import\(['"][^'"]*BusEventLogger['"]\)/);
    const logger = readFileSync(join(__dirname, '../../src/services/BusEventLogger.ts'), 'utf8');
    expect(logger).toMatch(
      /setShareOutcomeSink\(\(source, outcome\) => this\.record\('SHARE_OUTCOME', \{ source, outcome \}\)\)/
    );
    expect(logger).toMatch(/stop\(\): void \{\s*setShareOutcomeSink\(null\);/);
  });

  it('a logger that throws never changes what the player was told', async () => {
    record.mockImplementationOnce(() => {
      throw new Error('logger down');
    });
    vi.stubGlobal('navigator', { share: vi.fn().mockResolvedValue(undefined) });
    await expect(shareLink({ source: 's', url: URL_ })).resolves.toBe('shared');
    await settle();
  });
});

describe('the stats card carries the player link', () => {
  it('builds the public profile address', () => {
    expect(profileShareUrl('u-1', 'https://smarter.poker')).toBe(
      'https://smarter.poker/hub/club-arena/profile/u-1'
    );
  });
});
