/**
 * src/lib/share.ts: the ladder every share button climbs. Each case is a
 * dead end one of the hand-rolled handlers had before 2026-11-14.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { reportError } from '../../src/utils/errorReporter';
import { shareFile, shareLink, tournamentShareUrl, writeClipboard } from '../../src/lib/share';

const URL_ = 'https://smarter.poker/hub/club-arena/tournaments/abc';

function stubNavigator(value: Record<string, unknown>) {
  vi.stubGlobal('navigator', value);
}

describe('shareLink', () => {
  beforeEach(() => vi.mocked(reportError).mockClear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the system sheet when it takes the link', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    await expect(shareLink({ source: 't', title: 'T', url: URL_ })).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'T', url: URL_ });
  });

  it('treats a closed sheet as the player changing their mind: nothing is copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({
      share: vi.fn().mockRejectedValue(new DOMException('x', 'AbortError')),
      clipboard: { writeText },
    });
    await expect(shareLink({ source: 't', url: URL_ })).resolves.toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('a sheet that REFUSES falls through to the clipboard and is reported', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({
      share: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')),
      clipboard: { writeText },
    });
    await expect(shareLink({ source: 'Break.share', text: 'Come play', url: URL_ })).resolves.toBe(
      'copied'
    );
    expect(writeText).toHaveBeenCalledWith(`Come play ${URL_}`);
    expect(reportError).toHaveBeenCalledWith(expect.anything(), 'Break.share.share_refused');
  });

  it('a sheet that cannot carry the data is skipped, not thrown at the player', async () => {
    const share = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share, canShare: () => false, clipboard: { writeText } });
    await expect(shareLink({ source: 't', url: URL_ })).resolves.toBe('copied');
    expect(share).not.toHaveBeenCalled();
  });

  it('a denied Clipboard API falls back to the selection copy', async () => {
    stubNavigator({
      clipboard: { writeText: vi.fn().mockRejectedValue(new DOMException('x', 'NotAllowedError')) },
    });
    const exec = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    await expect(shareLink({ source: 't', url: URL_ })).resolves.toBe('copied');
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('says failed, and reports it, only when nothing at all could take the link', async () => {
    stubNavigator({
      clipboard: { writeText: vi.fn().mockRejectedValue(new DOMException('x', 'NotAllowedError')) },
    });
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn().mockReturnValue(false);
    await expect(shareLink({ source: 'Break.share', url: URL_ })).resolves.toBe('failed');
    expect(reportError).toHaveBeenCalledWith(expect.anything(), 'Break.share.copy_failed');
    await expect(writeClipboard('x')).rejects.toThrow();
  });
});

describe('shareFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const blob = new Blob(['x'], { type: 'image/png' });

  it('a sheet that refuses the picture falls through to the download', async () => {
    const download = vi.fn();
    stubNavigator({
      share: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')),
      canShare: () => true,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await expect(
      shareFile({ source: 't', blob, filename: 'a.png', text: 'Hi', url: URL_, download })
    ).resolves.toBe('saved');
    expect(download).toHaveBeenCalledWith('a.png', blob);
  });

  it('no sheet at all: the picture is saved and the sentence copied beside it', async () => {
    const download = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ clipboard: { writeText } });
    await expect(
      shareFile({ source: 't', blob, filename: 'a.png', text: 'Hi', url: URL_, download })
    ).resolves.toBe('saved');
    expect(writeText).toHaveBeenCalledWith(`Hi ${URL_}`);
  });
});

describe('tournamentShareUrl', () => {
  it('is the routed tournament page on the public origin', () => {
    expect(tournamentShareUrl('a b', 'https://smarter.poker')).toBe(
      'https://smarter.poker/hub/club-arena/tournaments/a%20b'
    );
  });
});
