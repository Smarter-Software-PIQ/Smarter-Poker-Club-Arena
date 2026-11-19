/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SHARE AS VIDEO — the clip panel in the share sheet (Phase 9.1, 2026-09-30)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Rendered by ShareHand when the sheet was opened for a hand that has a
 * `hand_history` id (the archive and the Previous Hand detail have one; the
 * live snapshot taken at the end of a hand does not, so it shows no panel).
 *
 *   Share As Video  ->  fn_hand_clip_request  ->  Your Clip Is In The Queue
 *                                             ->  Rendering Your Clip
 *                                             ->  a preview and Post To Your Feed
 *                                                 -> publish_user_video_reel -> Posted
 *                                             ->  the reason and Try Again
 *
 * The person presses to request and presses again to post; nothing posts by
 * itself. While the sheet is open and the job is queued or rendering the
 * panel reads its own row every 5 s for at most 6 minutes, then stops and
 * offers one Check Again. A failed job is final until Try Again.
 *
 * A RENDERED CLIP CAN LEAVE THE APP (2026-11-18). Dan: "SHARE AS A VIDEO NEEDS
 * TO BE FULLY FIXED AND ENHANCED AND IT SHOULDN'T HAVE THIS LONG LINK, IT
 * SHOULD BE CLIPPED LIKE THE LINK COPY AND PASTE." Until then a clip could
 * only be posted to the feed. A clip that is ready, and one already posted,
 * now also offers:
 *
 *   Share Video   where the device's sheet takes a file: the mp4 itself, with
 *                 the caption, and the hand's SHORT link riding in the text.
 *                 Where it does not: the short link alone (Share Link with a
 *                 sheet, Copy Link without one). Never the long /replay?h=
 *                 link: while the short link is being made the button waits
 *                 for it, and when there is none the panel says so.
 *   Download      the mp4 as hand-clip-<hand number or short id>.mp4.
 *
 * Preparing Video, Shared, Saved and Link Copied are said when they happen. A
 * sheet the player closed is neither: the buttons simply come back. A failure
 * is one plain line and the button that failed reads Try Again.
 *
 * Title Case on every label, no emoji, no em dash.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './ShareHand.css';
import {
  HAND_CLIP_POLL_LIMIT_MS,
  HAND_CLIP_POLL_MS,
  fetchHandClipFile,
  handClipDownloadUrl,
  handClipFailureReason,
  handClipFileName,
  handClipInProgress,
  handClipReelUrl,
  publishHandClipToFeed,
  readHandClipJob,
  requestHandClip,
  type HandClipJob,
} from '../../services/HandClipService';
import { openInBrowser } from '../../lib/openExternal';
import { canShareFile, hasShareSheet, shareFile, shareLink } from '../../lib/share';
import { downloadBlob } from '../../utils/downloadCsv';
import { ShareLinkFallback } from '../common/ShareLinkFallback';
import { reportError } from '../../utils/errorReporter';

export interface ShareAsVideoPanelProps {
  /** The `hand_history` id the sheet was opened for. */
  handId: string;
  /** The caption the post starts with; the person can edit it. */
  caption?: string;
  /** The hand's number, for the file name; the hand id's first 8 otherwise. */
  handNumber?: number | string | null;
  /**
   * The hand's SHORT link (smarter.poker/h/<token>) and whether it is still
   * being made. ShareHand owns it; the panel only ever sends this one, never
   * a long /replay?h= link.
   */
  shortUrl?: string | null;
  shortPending?: boolean;
  /** The sheet's own sentence, sent when the caption is left empty. */
  shareText?: string;
  shareTitle?: string;
  /** Called when the hand's link actually went out (shared or copied). */
  onShared?: () => void;
  /** Poll interval and ceiling, overridable for tests. */
  pollMs?: number;
  pollLimitMs?: number;
}

type Phase =
  /** Reading the player's own row for this hand, once, on open. */
  | 'loading'
  /** No job yet: the button. */
  | 'idle'
  /** fn_hand_clip_request in flight. */
  | 'requesting'
  /** A job row is on screen; what it shows depends on `job.state`. */
  | 'job'
  /** publish_user_video_reel in flight. */
  | 'publishing'
  /** Posted from this sheet; the reel link. */
  | 'posted'
  /** The poll ceiling passed while the job was still queued or rendering. */
  | 'stale'
  /** A request or a read failed outright (not a failed JOB). */
  | 'error';

/** What the two leave-the-app buttons are doing; apart from the job's phase. */
type Leave =
  | { kind: 'idle' }
  | { kind: 'working'; action: 'share' | 'download' }
  /* The file is in hand but the tap that asked for it has expired (a browser
     opens a share sheet only from a fresh tap): one more tap sends it. */
  | { kind: 'armed' }
  | { kind: 'done'; label: string }
  | { kind: 'failed'; action: 'share' | 'download'; label: string; link?: string };

const IDLE: Leave = { kind: 'idle' };

export default function ShareAsVideoPanel({
  handId,
  handNumber = null,
  shortUrl = null,
  shortPending = false,
  shareText = '',
  shareTitle = 'Hand Replay',
  onShared,
  caption: initialCaption = '',
  pollMs = HAND_CLIP_POLL_MS,
  pollLimitMs = HAND_CLIP_POLL_LIMIT_MS,
}: ShareAsVideoPanelProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [job, setJob] = useState<HandClipJob | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reelId, setReelId] = useState<string | null>(null);
  const [caption, setCaption] = useState(initialCaption);
  const [leave, setLeave] = useState<Leave>(IDLE);
  /* The clip's bytes, read once per video and used by both buttons. */
  const clipFile = useRef<{ url: string; blob: Blob } | null>(null);
  /* Asked once: whether this device's sheet takes a video file. */
  const fileShare = useMemo(() => canShareFile('video/mp4', 'hand-clip.mp4'), []);
  const alive = useRef(true);
  /* When the current stretch of polling began; reset by every request. */
  const pollStartedAt = useRef<number | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* On open: the player's own row, if there is one, so a clip already
     rendered shows as ready and one still rendering keeps being watched. A
     read that fails (the table not reachable, a network blip) is the button:
     the request itself will say if something is wrong. */
  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setJob(null);
    setMessage(null);
    setReelId(null);
    setLeave(IDLE);
    clipFile.current = null;
    pollStartedAt.current = null;
    (async () => {
      try {
        const existing = await readHandClipJob(handId);
        if (cancelled) return;
        if (existing) {
          setJob(existing);
          setPhase('job');
        } else {
          setPhase('idle');
        }
      } catch (e) {
        if (cancelled) return;
        reportError(e, 'ShareAsVideoPanel.Failed_to_read_job');
        setPhase('idle');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handId]);

  /* The poll: only while a job is queued or rendering, only while the sheet
     is open, every `pollMs`, for at most `pollLimitMs` from when watching
     began. The timer is the schedule, not a retry: it reads, it never writes. */
  /* A ready row with no video yet is the renderer mid-write: watched too. */
  const watching =
    phase === 'job' && (handClipInProgress(job) || (job?.state === 'ready' && !job.video_url));
  useEffect(() => {
    if (!watching) return;
    if (pollStartedAt.current === null) pollStartedAt.current = Date.now();
    const t = setTimeout(async () => {
      if (Date.now() - (pollStartedAt.current ?? Date.now()) >= pollLimitMs) {
        if (alive.current) setPhase('stale');
        return;
      }
      try {
        const next = await readHandClipJob(handId);
        if (!alive.current) return;
        /* A new object either way: the effect re-arms off its identity. */
        setJob((j) => (next ? { ...next } : j ? { ...j } : j));
      } catch (e) {
        reportError(e, 'ShareAsVideoPanel.Failed_to_poll_job');
        /* A missed read is a missed read; the next tick reads again until
           the ceiling, and the ceiling is what ends it. */
        if (alive.current) setJob((j) => (j ? { ...j } : j));
      }
    }, pollMs);
    return () => clearTimeout(t);
  }, [watching, job, handId, pollMs, pollLimitMs]);

  const request = useCallback(async () => {
    setPhase('requesting');
    setMessage(null);
    setReelId(null);
    pollStartedAt.current = null;
    try {
      const next = await requestHandClip(handId);
      if (!alive.current) return;
      setJob(next);
      setPhase('job');
    } catch (e) {
      reportError(e, 'ShareAsVideoPanel.Failed_to_request_clip');
      if (!alive.current) return;
      setMessage('Could Not Request A Clip Of This Hand');
      setPhase('error');
    }
  }, [handId]);

  const checkAgain = useCallback(async () => {
    setPhase('loading');
    try {
      const next = await readHandClipJob(handId);
      if (!alive.current) return;
      pollStartedAt.current = null;
      if (next) setJob(next);
      setPhase(next ? 'job' : 'idle');
    } catch (e) {
      reportError(e, 'ShareAsVideoPanel.Failed_to_check_job');
      if (!alive.current) return;
      setPhase(job ? 'stale' : 'idle');
    }
  }, [handId, job]);

  const publish = useCallback(async () => {
    if (!job) return;
    setPhase('publishing');
    setMessage(null);
    try {
      const posted = await publishHandClipToFeed(job, caption.trim());
      if (!alive.current) return;
      setReelId(posted.reelId);
      setPhase('posted');
    } catch (e) {
      reportError(e, 'ShareAsVideoPanel.Failed_to_publish_clip');
      if (!alive.current) return;
      setMessage('Could Not Post Your Clip. Try Again.');
      setPhase('job');
    }
  }, [job, caption]);

  const readClipFile = useCallback(async (videoUrl: string): Promise<Blob> => {
    if (clipFile.current?.url === videoUrl) return clipFile.current.blob;
    const blob = await fetchHandClipFile(videoUrl);
    clipFile.current = { url: videoUrl, blob };
    return blob;
  }, []);

  const videoUrl = job?.video_url ?? null;
  const fileName = handClipFileName(handNumber, handId);

  const shareVideo = useCallback(async () => {
    if (!videoUrl) return;
    const text = caption.trim() || shareText.trim();

    /* No sheet for a file here: the hand's short link, and only that one. */
    if (!fileShare) {
      if (!shortUrl) return;
      setLeave({ kind: 'working', action: 'share' });
      const outcome = await shareLink({
        source: 'ShareAsVideoPanel.share_link',
        title: shareTitle,
        text,
        url: shortUrl,
      });
      if (outcome === 'shared' || outcome === 'copied') onShared?.();
      if (!alive.current) return;
      if (outcome === 'shared') setLeave({ kind: 'done', label: 'Shared' });
      else if (outcome === 'copied') setLeave({ kind: 'done', label: 'Link Copied' });
      else if (outcome === 'failed')
        setLeave({
          kind: 'failed',
          action: 'share',
          label: 'Could Not Share The Link',
          link: shortUrl,
        });
      else setLeave(IDLE);
      return;
    }

    if (shortPending && !shortUrl) return;
    const secondTap = leave.kind === 'armed';
    setLeave({ kind: 'working', action: 'share' });
    let blob: Blob;
    try {
      blob = await readClipFile(videoUrl);
    } catch (e) {
      reportError(e, 'ShareAsVideoPanel.Failed_to_load_clip_for_share');
      if (alive.current)
        setLeave({ kind: 'failed', action: 'share', label: 'Could Not Load The Video' });
      return;
    }
    if (!alive.current) return;
    /* A sheet opens only from a fresh tap. If loading outlasted this one,
       say the video is ready and let the next tap send it at once. */
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
      .userActivation;
    if (!secondTap && activation && activation.isActive === false) {
      setLeave({ kind: 'armed' });
      return;
    }
    const outcome = await shareFile({
      source: 'ShareAsVideoPanel.share_video',
      blob,
      filename: fileName,
      title: shareTitle,
      text,
      url: shortUrl || undefined,
      download: (name, file) => {
        if (downloadBlob(name, file) !== true) throw new Error('the file could not be handed over');
      },
    });
    if (shortUrl && (outcome === 'shared' || outcome === 'copied' || outcome === 'saved')) {
      onShared?.();
    }
    if (!alive.current) return;
    if (outcome === 'shared') setLeave({ kind: 'done', label: 'Shared' });
    else if (outcome === 'saved') setLeave({ kind: 'done', label: 'Saved' });
    else if (outcome === 'copied') setLeave({ kind: 'done', label: 'Link Copied' });
    else if (outcome === 'failed')
      setLeave({ kind: 'failed', action: 'share', label: 'Could Not Share The Video' });
    else setLeave(IDLE);
  }, [
    videoUrl,
    caption,
    shareText,
    shareTitle,
    fileShare,
    shortUrl,
    shortPending,
    onShared,
    leave.kind,
    readClipFile,
    fileName,
  ]);

  const download = useCallback(async () => {
    if (!videoUrl) return;
    setLeave({ kind: 'working', action: 'download' });
    try {
      const blob = await readClipFile(videoUrl);
      if (downloadBlob(fileName, blob) !== true)
        throw new Error('the file could not be handed over');
      if (alive.current) setLeave({ kind: 'done', label: 'Saved' });
    } catch (e) {
      reportError(e, 'ShareAsVideoPanel.Failed_to_download_clip');
      /* The bytes could not be saved from here. The clip's own address still
         can be opened, so it is offered as a link the player taps. */
      if (alive.current)
        setLeave({
          kind: 'failed',
          action: 'download',
          label: 'Could Not Save The Video Here',
          link: handClipDownloadUrl(videoUrl, fileName),
        });
    }
  }, [videoUrl, fileName, readClipFile]);

  const leaveBusy = leave.kind === 'working';
  /* Wait while the short link is still being reserved so neither a file share
     nor a link-only share goes out without it. */
  const waitingForShortLink = Boolean(shortPending && !shortUrl);
  const linkOnly = !fileShare;
  const noShortLink = linkOnly && !shortUrl && !shortPending;
  const shareLabel =
    leave.kind === 'failed' && leave.action === 'share'
      ? 'Try Again'
      : waitingForShortLink
        ? 'Preparing Link'
        : fileShare
          ? 'Share Video'
          : hasShareSheet()
            ? 'Share Link'
            : 'Copy Link';
  const downloadLabel =
    leave.kind === 'failed' && leave.action === 'download' ? 'Try Again' : 'Download';

  /* Share Video and Download: under a ready clip and under a posted one. */
  const leaveActions = videoUrl ? (
    <>
      <div className="share-hand__video-actions" data-clip-leave={leave.kind}>
        <button
          type="button"
          className="share-hand__video-btn share-hand__video-btn--plate"
          data-clip-action="share"
          disabled={leaveBusy || waitingForShortLink || (linkOnly && !shortUrl)}
          onClick={shareVideo}
        >
          {shareLabel}
        </button>
        <button
          type="button"
          className="share-hand__video-btn share-hand__video-btn--plate"
          data-clip-action="download"
          disabled={leaveBusy}
          onClick={download}
        >
          {downloadLabel}
        </button>
      </div>
      <div className="share-hand__video-leave" role="status" aria-live="polite">
        {leave.kind === 'working' && (leave.action === 'download' || fileShare) && (
          <p className="share-hand__video-status">Preparing Video</p>
        )}
        {leave.kind === 'armed' && (
          <p className="share-hand__video-status">
            Your Video Is Ready. Tap Share Video To Send It.
          </p>
        )}
        {leave.kind === 'done' && (
          <p className="share-hand__video-status share-hand__video-status--done">{leave.label}</p>
        )}
        {leave.kind === 'failed' && (
          <p className="share-hand__video-status share-hand__video-status--failed">{leave.label}</p>
        )}
        {leave.kind === 'failed' && leave.action === 'share' && leave.link && (
          <ShareLinkFallback url={leave.link} />
        )}
        {leave.kind === 'failed' && leave.action === 'download' && leave.link && (
          <a
            className="share-hand__video-link"
            href={leave.link}
            onClick={(e) => {
              e.preventDefault();
              openInBrowser(leave.link!);
            }}
          >
            Open Video In Your Browser
          </a>
        )}
        {noShortLink && leave.kind === 'idle' && (
          <p className="share-hand__video-hint">
            The Short Link Is Not Available Right Now. Use Download To Send The Video.
          </p>
        )}
      </div>
    </>
  ) : null;

  const reelLink = (id: string) => {
    const url = handClipReelUrl(id);
    return (
      <a
        className="share-hand__video-link"
        href={url}
        onClick={(e) => {
          e.preventDefault();
          openInBrowser(url);
        }}
      >
        View On Your Feed
      </a>
    );
  };

  let body: React.ReactNode;
  if (phase === 'loading') {
    body = <p className="share-hand__video-status">Checking For A Clip</p>;
  } else if (phase === 'idle') {
    body = (
      <>
        <button
          type="button"
          className="share-hand__video-btn share-hand__video-btn--plate"
          onClick={request}
        >
          Share As Video
        </button>
        <p className="share-hand__video-hint">
          A Short Clip Of This Hand, Rendered For You To Post To Your Feed
        </p>
      </>
    );
  } else if (phase === 'requesting') {
    body = <p className="share-hand__video-status">Requesting Your Clip</p>;
  } else if (phase === 'error') {
    body = (
      <>
        <p className="share-hand__video-status share-hand__video-status--failed">{message}</p>
        <button
          type="button"
          className="share-hand__video-btn share-hand__video-btn--plate"
          onClick={request}
        >
          Try Again
        </button>
      </>
    );
  } else if (phase === 'stale') {
    body = (
      <>
        <p className="share-hand__video-status">
          Still Working On Your Clip. Check Again In A Moment.
        </p>
        <button
          type="button"
          className="share-hand__video-btn share-hand__video-btn--plate"
          onClick={checkAgain}
        >
          Check Again
        </button>
      </>
    );
  } else if (phase === 'publishing') {
    body = <p className="share-hand__video-status">Posting Your Clip</p>;
  } else if (phase === 'posted') {
    body = (
      <>
        <p className="share-hand__video-status share-hand__video-status--done">Posted</p>
        {reelId && reelLink(reelId)}
        {leaveActions}
      </>
    );
  } else if (job?.state === 'queued') {
    body = (
      <>
        <p className="share-hand__video-status">Your Clip Is In The Queue</p>
        <p className="share-hand__video-hint">This Usually Takes A Minute Or Two</p>
      </>
    );
  } else if (job?.state === 'rendering') {
    body = <p className="share-hand__video-status">Rendering Your Clip</p>;
  } else if (job?.state === 'ready' && job.video_url) {
    body = (
      <>
        <video
          className="share-hand__video-preview"
          src={job.video_url}
          poster={job.poster_url ?? undefined}
          controls
          playsInline
          preload="metadata"
          aria-label="Clip Preview"
        />
        <input
          type="text"
          className="share-hand__video-caption"
          value={caption}
          maxLength={280}
          placeholder="Add A Caption (Optional)"
          aria-label="Clip Caption"
          onChange={(e) => setCaption(e.target.value)}
        />
        {message && (
          <p className="share-hand__video-status share-hand__video-status--failed">{message}</p>
        )}
        <button
          type="button"
          className="share-hand__video-btn share-hand__video-btn--plate"
          disabled={leaveBusy}
          onClick={publish}
        >
          Post To Your Feed
        </button>
        {leaveActions}
      </>
    );
  } else if (job?.state === 'published') {
    body = (
      <>
        <p className="share-hand__video-status share-hand__video-status--done">Posted</p>
        {job.social_reel_id && reelLink(job.social_reel_id)}
        {leaveActions}
      </>
    );
  } else if (job?.state === 'failed') {
    body = (
      <>
        <p className="share-hand__video-status share-hand__video-status--failed">
          Your Clip Could Not Be Rendered
        </p>
        <p className="share-hand__video-hint">{handClipFailureReason(job.error)}</p>
        <button
          type="button"
          className="share-hand__video-btn share-hand__video-btn--plate"
          onClick={request}
        >
          Try Again
        </button>
      </>
    );
  } else {
    /* A ready job with no video is a row the renderer has not finished
       writing; it reads like rendering until the next poll says otherwise. */
    body = <p className="share-hand__video-status">Rendering Your Clip</p>;
  }

  return (
    <div className="share-hand__video" data-clip-phase={phase} data-clip-job-state={job?.state}>
      {body}
    </div>
  );
}
