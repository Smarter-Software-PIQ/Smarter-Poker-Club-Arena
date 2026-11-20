/**
 * A RENDERED CLIP CAN LEAVE THE APP (2026-11-18).
 *
 * Dan: "SHARE AS A VIDEO NEEDS TO BE FULLY FIXED AND ENHANCED AND IT SHOULDN'T
 * HAVE THIS LONG LINK, IT SHOULD BE CLIPPED LIKE THE LINK COPY AND PASTE."
 *
 * A ready clip, and a posted one, offer Share Video and Download:
 *
 * - where the sheet takes a file, Share Video sends the mp4 itself, named
 *   hand-clip-<hand number>.mp4, with the caption and the SHORT link;
 * - where it does not, the button sends the short link alone (Share Link with
 *   a sheet, Copy Link without one), waits while that link is being made, and
 *   says so when there is none. A /replay?h= link is never sent from here;
 * - Download saves the mp4 under that name;
 * - Preparing Video, Shared, Saved and Link Copied are said when they happen;
 *   a sheet the player closed is neither; a failure is one line and Try Again.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

const rpc = vi.fn();
let row: Record<string, unknown> | null = null;
const chain = {
  select: vi.fn(() => chain),
  eq: vi.fn(() => chain),
  order: vi.fn(() => chain),
  limit: vi.fn(() => chain),
  maybeSingle: vi.fn(async () => ({ data: row, error: null })),
};
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, from: vi.fn(() => chain) } }));
vi.mock('@/services/SoundService', () => ({
  soundService: new Proxy({}, { get: () => vi.fn() }),
  haptic: new Proxy({}, { get: () => vi.fn() }),
}));
const openInBrowser = vi.fn();
vi.mock('@/lib/openExternal', () => ({ openInBrowser, leaveForHub: vi.fn() }));

const HAND = '0cce336e-0829-46da-a5f5-ab4511cd8316';
const SHORT = 'https://smarter.poker/h/AbCd2345';
const VIDEO =
  'https://kuklfnapbkmacvwxktbh.supabase.co/storage/v1/object/public/social-media/videos/me/hand-clip-x-felt-720p.mp4';
const job = (state: string, extra: Record<string, unknown> = {}) => ({
  id: 'job-uuid',
  hand_id: HAND,
  author_id: 'me',
  kind: 'user',
  style: 'felt-720p',
  state,
  video_url: VIDEO,
  poster_url: null,
  social_post_id: null,
  social_reel_id: null,
  error: null,
  created_at: '2026-11-18T12:00:00.000Z',
  updated_at: '2026-11-18T12:00:00.000Z',
  ...extra,
});

type Props = Record<string, unknown>;
async function panel(props: Props = {}) {
  const { default: ShareAsVideoPanel } = await import('@/components/table/ShareAsVideoPanel');
  const base = { handId: HAND, handNumber: 56019216, shortUrl: SHORT, shareText: 'Big pot' };
  const view = render(<ShareAsVideoPanel {...base} {...props} />);
  await screen.findByRole('button', { name: 'Download' });
  return {
    again: (next: Props) => view.rerender(<ShareAsVideoPanel {...base} {...props} {...next} />),
  };
}

/* The device: what its share sheet takes, its clipboard, the clip's bytes. */
const share = vi.fn<(data: ShareData) => Promise<void>>();
const writeText = vi.fn<(text: string) => Promise<void>>();
const fetchClip = vi.fn();
const clicked: Array<{ download: string; href: string }> = [];
function device(kind: 'files' | 'sheet' | 'none') {
  const nav = navigator as unknown as Record<string, unknown>;
  if (kind === 'none') {
    delete nav.share;
    delete nav.canShare;
  } else {
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    Object.defineProperty(navigator, 'canShare', {
      value: (data: ShareData) => (data.files ? kind === 'files' : true),
      configurable: true,
    });
  }
}
const mp4 = () => new Blob([new Uint8Array(16)], { type: 'video/mp4' });
const sent = () => share.mock.calls.map((c) => JSON.stringify([c[0].text, c[0].url])).join(' ');

beforeEach(() => {
  row = job('ready');
  rpc.mockReset();
  share.mockReset().mockResolvedValue(undefined);
  writeText.mockReset().mockResolvedValue(undefined);
  fetchClip.mockReset().mockResolvedValue({ ok: true, status: 200, blob: async () => mp4() });
  openInBrowser.mockClear();
  clicked.length = 0;
  vi.stubGlobal('fetch', fetchClip);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:clip');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clicked.push({ download: this.download, href: this.href });
  });
});
afterEach(() => {
  cleanup();
  device('none');
  delete (navigator as unknown as Record<string, unknown>).userActivation;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Share Video', () => {
  it('sends the file itself, named for the hand, with the caption and the short link', async () => {
    device('files');
    let release!: (v: unknown) => void;
    fetchClip.mockReturnValueOnce(new Promise((r) => (release = r)));
    await panel();
    fireEvent.change(screen.getByLabelText('Clip Caption'), { target: { value: 'River bluff' } });
    const button = screen.getByRole('button', { name: 'Share Video' }) as HTMLButtonElement;
    fireEvent.click(button);

    /* Honest while it works: said, and nothing else can be pressed. */
    expect(await screen.findByText('Preparing Video')).toBeTruthy();
    expect(button.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(
      (screen.getByRole('button', { name: 'Post To Your Feed' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(share).not.toHaveBeenCalled();
    expect(fetchClip.mock.calls[0][0]).toBe(VIDEO);

    release({ ok: true, status: 200, blob: async () => mp4() });
    expect(await screen.findByText('Shared')).toBeTruthy();
    expect(share).toHaveBeenCalledTimes(1);
    const data = share.mock.calls[0][0];
    expect(data.files).toHaveLength(1);
    expect(data.files![0].name).toBe('hand-clip-56019216.mp4');
    expect(data.files![0].type).toBe('video/mp4');
    expect(data.text).toBe(`River bluff ${SHORT}`);
    expect(button.disabled).toBe(false);
  });

  it('an empty caption sends the sheet sentence; no short link sends no link at all', async () => {
    device('files');
    await panel({ shortUrl: null });
    fireEvent.click(screen.getByRole('button', { name: 'Share Video' }));
    expect(await screen.findByText('Shared')).toBeTruthy();
    expect(share.mock.calls[0][0].text).toBe('Big pot');
    expect(sent()).not.toMatch(/replay\?h=|https?:/);
  });

  it('a sheet the player closed is neither Shared nor a failure', async () => {
    device('files');
    share.mockRejectedValueOnce(Object.assign(new Error('Share canceled'), { name: 'AbortError' }));
    await panel();
    const button = screen.getByRole('button', { name: 'Share Video' }) as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(screen.queryByText('Shared')).toBeNull();
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.queryByText(/Could Not/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull();
    expect(clicked).toHaveLength(0);
    expect(document.querySelector('[data-clip-leave]')?.getAttribute('data-clip-leave')).toBe(
      'idle'
    );
  });

  it('a video that will not load is one plain line and Try Again, which works', async () => {
    device('files');
    fetchClip.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await panel();
    fireEvent.click(screen.getByRole('button', { name: 'Share Video' }));
    expect(await screen.findByText('Could Not Load The Video')).toBeTruthy();
    expect(share).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Share Video' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByText('Shared')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share Video' })).toBeTruthy();
    expect(screen.queryByText('Could Not Load The Video')).toBeNull();
  });

  it('when loading outlasts the tap, it says the video is ready and the next tap sends it', async () => {
    device('files');
    Object.defineProperty(navigator, 'userActivation', {
      value: { isActive: false },
      configurable: true,
    });
    await panel();
    fireEvent.click(screen.getByRole('button', { name: 'Share Video' }));
    expect(
      await screen.findByText('Your Video Is Ready. Tap Share Video To Send It.')
    ).toBeTruthy();
    expect(share).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Share Video' }));
    expect(await screen.findByText('Shared')).toBeTruthy();
    /* The bytes were read once and kept. */
    expect(fetchClip).toHaveBeenCalledTimes(1);
  });

  it('waits for a pending short link on a file-capable device so the mp4 is never shared without it', async () => {
    device('files');
    const onShared = vi.fn();
    const view = await panel({ shortUrl: null, shortPending: true, onShared });
    const waiting = screen.getByRole('button', { name: 'Preparing Link' }) as HTMLButtonElement;
    expect(waiting.disabled).toBe(true);
    fireEvent.click(waiting);
    expect(fetchClip).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    /* Download never waits on the link. */
    expect((screen.getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(
      false
    );

    view.again({ shortUrl: SHORT, shortPending: false, onShared });
    const ready = screen.getByRole('button', { name: 'Share Video' }) as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
    fireEvent.click(ready);
    expect(await screen.findByText('Shared')).toBeTruthy();
    expect(share.mock.calls[0][0].text).toBe(`Big pot ${SHORT}`);
    expect(onShared).toHaveBeenCalledTimes(1);
  });

  it('calls onShared when file share falls back to saved or copied with a short link', async () => {
    device('files');
    share.mockRejectedValueOnce(new DOMException('refused', 'NotAllowedError'));
    const onShared = vi.fn();
    await panel({ onShared });
    fireEvent.click(screen.getByRole('button', { name: 'Share Video' }));
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(onShared).toHaveBeenCalledTimes(1);
  });

  it('every button in the panel carries share-hand__video-btn--plate', async () => {
    device('files');
    await panel();
    const readyButtons = screen.getAllByRole('button');
    expect(readyButtons.length).toBeGreaterThanOrEqual(3);
    for (const btn of readyButtons) {
      expect(btn.classList.contains('share-hand__video-btn--plate')).toBe(true);
    }

    cleanup();
    row = null;
    const { default: ShareAsVideoPanel } = await import('@/components/table/ShareAsVideoPanel');
    render(<ShareAsVideoPanel handId={HAND} handNumber={56019216} shortUrl={SHORT} />);
    const idleBtn = await screen.findByRole('button', { name: 'Share As Video' });
    expect(idleBtn.classList.contains('share-hand__video-btn--plate')).toBe(true);
  });
});

describe('where the sheet cannot take a file', () => {
  it('a sheet without files shares the short link and never fetches the video', async () => {
    device('sheet');
    await panel();
    expect(screen.queryByRole('button', { name: 'Share Video' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Share Link' }));
    expect(await screen.findByText('Shared')).toBeTruthy();
    const data = share.mock.calls[0][0];
    expect(data.url).toBe(SHORT);
    expect(data.files).toBeUndefined();
    expect(data.text).toBe('Big pot');
    expect(fetchClip).not.toHaveBeenCalled();
  });

  it('no sheet at all copies the short link and says Link Copied', async () => {
    device('none');
    const onShared = vi.fn();
    await panel({ onShared });
    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));
    expect(await screen.findByText('Link Copied')).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(`Big pot ${SHORT}`);
    expect(onShared).toHaveBeenCalledTimes(1);
    expect(fetchClip).not.toHaveBeenCalled();
  });

  it('waits for a short link that is still being made', async () => {
    device('none');
    const view = await panel({ shortUrl: null, shortPending: true });
    const waiting = screen.getByRole('button', { name: 'Preparing Link' }) as HTMLButtonElement;
    expect(waiting.disabled).toBe(true);
    fireEvent.click(waiting);
    expect(writeText).not.toHaveBeenCalled();
    /* Download never waits on the link. */
    expect((screen.getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(
      false
    );

    view.again({ shortUrl: SHORT, shortPending: false });
    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));
    expect(await screen.findByText('Link Copied')).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(`Big pot ${SHORT}`);
  });

  it('with no short link it says so and sends nothing, never a long link', async () => {
    device('sheet');
    await panel({ shortUrl: null, shortPending: false });
    const button = screen.getByRole('button', { name: 'Share Link' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      screen.getByText('The Short Link Is Not Available Right Now. Use Download To Send The Video.')
    ).toBeTruthy();
    fireEvent.click(button);
    expect(share).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('a link nothing could send is printed on the page to copy by hand', async () => {
    device('none');
    writeText.mockRejectedValue(new Error('NotAllowedError'));
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn(() => false);
    await panel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));
    expect(await screen.findByText('Could Not Share The Link')).toBeTruthy();
    expect((screen.getByLabelText('Link') as HTMLInputElement).value).toBe(SHORT);
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
  });
});

describe('the sheet never hands the panel a long link', () => {
  const hand = {
    id: HAND,
    handNumber: 56019216,
    tableName: 'Midway',
    variant: 'NLH' as const,
    stakes: '1/2',
    timestamp: 1759233600000,
    buttonSeat: 1,
    players: [
      { seat: 1, name: 'kingfish', stack: 200, isHero: true, isWinner: true },
      { seat: 2, name: 'Emerson', stack: 100 },
    ],
    preflop: [],
    potTotal: 12,
    winners: [{ seat: 1, amount: 12 }],
  };

  it('a failed short link leaves the clip buttons with a file and no /replay?h= link', async () => {
    device('files');
    const { ShareHand } = await import('@/components/table/ShareHand');
    render(
      <ShareHand
        isOpen
        onClose={() => undefined}
        hand={hand as never}
        handId={HAND}
        shortUrl={null}
        shortPending={false}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Share Video' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const data = share.mock.calls[0][0];
    expect(data.files![0].name).toBe('hand-clip-56019216.mp4');
    expect(data.url).toBeUndefined();
    expect(String(data.text)).toMatch(/pot/);
    expect(sent()).not.toMatch(/replay\?h=|https?:/);
  });

  it('the short link the sheet holds is the one the clip carries', async () => {
    device('sheet');
    const { ShareHand } = await import('@/components/table/ShareHand');
    render(
      <ShareHand
        isOpen
        onClose={() => undefined}
        hand={hand as never}
        handId={HAND}
        shortUrl={SHORT}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Share Link' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0][0].url).toBe(SHORT);
    expect(sent()).not.toMatch(/replay\?h=/);
  });
});

describe('Download', () => {
  it('saves the mp4 under the hand number and says Saved', async () => {
    device('none');
    await panel();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(fetchClip.mock.calls[0][0]).toBe(VIDEO);
    expect(clicked).toEqual([{ download: 'hand-clip-56019216.mp4', href: 'blob:clip' }]);
    expect(share).not.toHaveBeenCalled();
  });

  it('a hand with no number is named by its short id', async () => {
    device('none');
    await panel({ handNumber: null });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(clicked[0].download).toBe('hand-clip-0cce336e.mp4');
  });

  it('bytes that cannot be read are a plain line, Try Again, and the clip to open', async () => {
    device('none');
    fetchClip.mockResolvedValueOnce({ ok: false, status: 503, blob: async () => mp4() });
    await panel();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByText('Could Not Save The Video Here')).toBeTruthy();
    expect(clicked).toHaveLength(0);
    const open = screen.getByText('Open Video In Your Browser') as HTMLAnchorElement;
    const address = `${VIDEO}?download=hand-clip-56019216.mp4`;
    expect(open.getAttribute('href')).toBe(address);
    fireEvent.click(open);
    expect(openInBrowser).toHaveBeenCalledWith(address);
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(clicked).toHaveLength(1);
  });
});

describe('a posted clip', () => {
  it('still offers Share Video and Download beside View On Your Feed', async () => {
    device('files');
    row = job('published', { social_reel_id: 'reel-2' });
    await panel();
    expect(screen.getByText('Posted')).toBeTruthy();
    expect(screen.getByText('View On Your Feed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Post To Your Feed' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Share Video' }));
    expect(await screen.findByText('Shared')).toBeTruthy();
    expect(share.mock.calls[0][0].files![0].name).toBe('hand-clip-56019216.mp4');
  });
});

describe('the names', () => {
  it('file name and download address', async () => {
    const { handClipFileName, handClipDownloadUrl } = await import('@/services/HandClipService');
    expect(handClipFileName(56019216, HAND)).toBe('hand-clip-56019216.mp4');
    expect(handClipFileName('#56 019/216', HAND)).toBe('hand-clip-56-019-216.mp4');
    expect(handClipFileName(null, HAND)).toBe('hand-clip-0cce336e.mp4');
    expect(handClipFileName('', '')).toBe('hand-clip-video.mp4');
    expect(handClipDownloadUrl(VIDEO, 'a.mp4')).toBe(`${VIDEO}?download=a.mp4`);
    expect(handClipDownloadUrl('https://cdn.example/x.mp4', 'a.mp4')).toBe(
      'https://cdn.example/x.mp4'
    );
  });
});
