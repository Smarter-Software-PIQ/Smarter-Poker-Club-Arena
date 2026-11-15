/*
 * EVERY SHARE GOES THROUGH ONE DOOR (2026-11-14).
 *
 * Dan: "THE SHARE LINKS ISN'T WORKING FOR THE TOURNAMENTS OR OTHER 'SHARE
 * STATS' OR SHARE TOURNAMENT ON BREAK."
 *
 * The cause was not one broken button. Every share surface carried its own
 * copy of the same three steps (system sheet, clipboard, give up), and each
 * copy got a different subset right:
 *
 *   - a system sheet that REFUSED (NotAllowedError in an embedded browser, an
 *     in-app webview, a desktop with no share targets) ended the tap. Only a
 *     browser with no navigator.share at all ever reached the clipboard.
 *   - the clipboard step called navigator.clipboard.writeText bare. Where the
 *     Clipboard API is present but refused ("Document is not focused", a
 *     webview policy) the tap did nothing. src/lib/copyToClipboard.ts fixed
 *     that on 2026-11-06 for the two hand-link buttons only.
 *   - most surfaces swallowed the failure, so nothing reached telemetry and
 *     nobody could see that the tournament and session shares were inert.
 *
 * This module is the only place in src/ that may call navigator.share or
 * navigator.clipboard.writeText (tests/every-share-goes-through-one-door.law.test.ts).
 * The ladder is the same for every caller:
 *
 *   1. the app's system share sheet (native build), else the Web Share sheet;
 *   2. a refusal that is not the player closing the sheet falls THROUGH;
 *   3. the clipboard, with the selection copy behind it;
 *   4. only then "failed", which the caller shows together with the link so
 *      it can still be copied by hand.
 *
 * The answer is a word, never a boolean, so "the player closed the sheet" is
 * not confused with "nothing could be shared".
 */
import { IS_NATIVE_BUILD, isNativePlatform, publicOrigin } from './appBase';
import { copyToClipboard } from './copyToClipboard';
import { reportError } from '../utils/errorReporter';

export type ShareOutcome = 'shared' | 'copied' | 'saved' | 'cancelled' | 'failed';

export interface ShareLinkInput {
  /** Telemetry source, e.g. 'TournamentBreakScreen.share'. */
  source: string;
  /** Omit only for a sentence with nowhere to point (a request to paste back). */
  url?: string;
  title?: string;
  text?: string;
  /** Exact clipboard form, when a surface lays the sentence and link out its own way. */
  clipboardText?: string;
}

type ShareNavigator = Navigator & {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};

function nav(): ShareNavigator | null {
  return typeof navigator === 'undefined' ? null : (navigator as ShareNavigator);
}

function isCancel(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'AbortError' || /cancel/i.test(String((error as Error)?.message || ''));
}

/*
 * The native sheet, in functions of their own on purpose: Rollup keeps
 * everything written inside a `try` block whatever a constant says
 * (treeshake.tryCatchDeoptimization), so an import() inside the handlers' try
 * would ship the Capacitor share plugins to web players. Here IS_NATIVE_BUILD
 * removes them.
 */
async function nativeText(title: string, text: string, url: string): Promise<boolean> {
  if (!IS_NATIVE_BUILD) return false;
  const { nativeShareText } = await import('./native/share');
  return nativeShareText(title, text, url);
}
async function nativeBlob(blob: Blob, filename: string, title: string): Promise<void> {
  if (!IS_NATIVE_BUILD) return;
  const { nativeShareBlob } = await import('./native/share');
  await nativeShareBlob(blob, filename, title);
}

/** What lands on the clipboard: the sentence, then the link. */
export function shareClipboardText(text: string | undefined, url: string): string {
  const t = (text || '').trim();
  return t ? `${t} ${url}` : url;
}

/** Copy only. False when neither the Clipboard API nor a selection copy worked. */
export async function copyText(text: string, source: string): Promise<boolean> {
  const ok = await copyToClipboard(text);
  if (!ok)
    reportError(new Error('Clipboard refused and selection copy failed'), `${source}.copy_failed`);
  return ok;
}

/** True where a system share sheet exists, so a surface can word its button. */
export function hasShareSheet(): boolean {
  if (IS_NATIVE_BUILD && isNativePlatform()) return true;
  return typeof nav()?.share === 'function';
}

/*
 * THE BUTTON SAYS WHAT THE TAP WILL DO (2026-11-15).
 *
 * A desktop browser has no share sheet, so "Share" there copies the link (or
 * saves the picture) and nothing visible opens. Players read that as "the
 * button did nothing". Where there is no sheet the button is worded for what
 * actually happens: Copy Link for a link, Save Image for a picture.
 */
export type ShareKind = 'link' | 'image';

export function shareButtonLabel(kind: ShareKind = 'link', sheet: boolean = hasShareSheet()): string {
  if (sheet) return 'Share';
  return kind === 'image' ? 'Save Image' : 'Copy Link';
}

/*
 * WHICH SHARE BUTTONS GET USED (2026-11-15).
 *
 * Every outcome, success included, is one SHARE_OUTCOME row in the existing
 * bus_event_log: the button (source) and what happened (outcome). Never the
 * link, the text or the file. The row goes through this tab's own logger
 * batch, not the MasterBus, because the bus repeats events to every other open
 * tab and each tab's logger would write the same tap again.
 *
 * The logger REGISTERS itself here when the app starts it
 * (BusEventLogger.start). This file imports nothing from it: every surface
 * that shares imports this door, and the logger's stores have no business in
 * their bundles (a fixture-built e2e bundle refused the import on 2026-11-15).
 */
export type ShareOutcomeSink = (source: string, outcome: ShareOutcome) => void;
let outcomeSink: ShareOutcomeSink | null = null;

export function setShareOutcomeSink(sink: ShareOutcomeSink | null): void {
  outcomeSink = sink;
}

function recordOutcome(source: string, outcome: ShareOutcome): ShareOutcome {
  try {
    outcomeSink?.(source, outcome);
  } catch {
    /* counting is a measurement; it never changes what the player was told */
  }
  return outcome;
}

export async function shareLink(input: ShareLinkInput): Promise<ShareOutcome> {
  return recordOutcome(input.source, await shareLinkOnce(input));
}

async function shareLinkOnce(input: ShareLinkInput): Promise<ShareOutcome> {
  const { source } = input;
  const url = input.url || '';
  const title = input.title || 'Smarter.Poker';
  const text = (input.text || '').trim();

  if (IS_NATIVE_BUILD && isNativePlatform()) {
    try {
      return (await nativeText(title, text, url)) ? 'shared' : 'cancelled';
    } catch (error) {
      reportError(error, `${source}.native_share_refused`);
    }
  } else {
    const n = nav();
    if (n && typeof n.share === 'function') {
      const data: ShareData = { title, ...(text ? { text } : {}), ...(url ? { url } : {}) };
      let allowed = true;
      try {
        if (typeof n.canShare === 'function') allowed = n.canShare(data);
      } catch {
        allowed = true;
      }
      if (allowed) {
        try {
          await n.share(data);
          return 'shared';
        } catch (error) {
          if (isCancel(error)) return 'cancelled';
          reportError(error, `${source}.share_refused`);
        }
      }
    }
  }

  const clip = input.clipboardText || (url ? shareClipboardText(text, url) : text);
  if (!clip) return 'failed';
  return (await copyText(clip, source)) ? 'copied' : 'failed';
}

export interface ShareFileInput extends Omit<ShareLinkInput, 'url'> {
  blob: Blob;
  filename: string;
  /** Rides in the text with a file: most targets drop `url` once files attach. */
  url?: string;
  /** Web fallback when no sheet can carry the file. */
  download: (filename: string, blob: Blob) => void | Promise<void>;
}

/**
 * A picture (result card, stats card, achievement). The sheet with the file,
 * then the native file sheet, then a download with the sentence copied
 * beside it. A sheet that refuses the file falls through like any other.
 */
export async function shareFile(input: ShareFileInput): Promise<ShareOutcome> {
  return recordOutcome(input.source, await shareFileOnce(input));
}

async function shareFileOnce(input: ShareFileInput): Promise<ShareOutcome> {
  const { source, blob, filename } = input;
  const title = input.title || 'Smarter.Poker';
  const text = (input.text || '').trim();
  const sentence = input.url ? shareClipboardText(text, input.url) : text;

  if (IS_NATIVE_BUILD && isNativePlatform()) {
    try {
      await nativeBlob(blob, filename, title);
      return 'shared';
    } catch (error) {
      if (isCancel(error)) return 'cancelled';
      reportError(error, `${source}.native_share_refused`);
    }
  } else {
    const n = nav();
    if (n && typeof n.share === 'function' && typeof n.canShare === 'function') {
      try {
        const file = new File([blob], filename, { type: blob.type || 'image/png' });
        const data: ShareData = sentence
          ? { files: [file], title, text: sentence }
          : { files: [file], title };
        if (n.canShare(data)) {
          await n.share(data);
          return 'shared';
        }
      } catch (error) {
        if (isCancel(error)) return 'cancelled';
        reportError(error, `${source}.share_refused`);
      }
    }
  }

  try {
    await input.download(filename, blob);
  } catch (error) {
    reportError(error, `${source}.download_failed`);
    if (input.url) return shareLinkOnce({ source, url: input.url, title, text });
    return 'failed';
  }
  if (sentence) await copyToClipboard(sentence);
  return 'saved';
}

/** A player's public profile, the address the stats card carries. */
export function profileShareUrl(userId: string, origin?: string): string {
  return `${origin ?? publicOrigin()}/hub/club-arena/profile/${encodeURIComponent(userId)}`;
}

/**
 * The address a tournament is shared as. One builder, so every surface sends
 * the same link.
 *
 * smarter.poker/t/<id> (2026-11-15), not the Club Arena page itself: the World
 * Hub serves it with the event's own preview card (name, buy-in, guarantee,
 * start time) through fn_ca_tournament_share_preview, sends a signed-in
 * player straight on to /hub/club-arena/tournaments/<id>, and shows a
 * signed-out friend what they were invited to with one Register button
 * instead of a bare sign-in page. Private, VIP-only and non-public-club events
 * get the plain card there, exactly like a missing one.
 */
export function tournamentShareUrl(tournamentId: string, origin?: string): string {
  return `${origin ?? publicOrigin()}/t/${encodeURIComponent(tournamentId)}`;
}

/**
 * For a caller that already has its own try/catch around a copy: resolves
 * when the text was copied (Clipboard API or the selection copy), rejects
 * when neither worked. Drop-in for a bare navigator.clipboard.writeText.
 */
export async function writeClipboard(text: string): Promise<void> {
  if (!(await copyToClipboard(text))) throw new Error('Copy Is Unavailable Here');
}
