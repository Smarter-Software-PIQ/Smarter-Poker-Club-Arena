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
import { normalizeInviteCode, normalizeInviteToken, normalizeUuid } from './inviteCode';
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

async function copyTextOnce(text: string, source: string): Promise<boolean> {
  const ok = await copyToClipboard(text);
  if (!ok)
    reportError(new Error('Clipboard refused and selection copy failed'), `${source}.copy_failed`);
  return ok;
}

/**
 * Copy only. False when neither the Clipboard API nor a selection copy worked.
 * Counted like a share (copied / failed): a copy button is how most desktop
 * players share.
 */
export async function copyText(text: string, source: string): Promise<boolean> {
  const ok = await copyTextOnce(text, source);
  recordOutcome(source, ok ? 'copied' : 'failed');
  return ok;
}

/** True where a system share sheet exists, so a surface can word its button. */
export function hasShareSheet(): boolean {
  if (IS_NATIVE_BUILD && isNativePlatform()) return true;
  return typeof nav()?.share === 'function';
}

/**
 * True where a tap can hand another app a FILE of this type (the app's own
 * sheet, or a Web Share sheet that says it takes one). A surface asks before
 * it fetches a large file, and words its button for what will happen: a
 * rendered hand clip is several megabytes, and a desktop browser that cannot
 * take it should be offered the link instead of a download nobody asked for.
 */
export function canShareFile(type: string, filename = 'file'): boolean {
  if (IS_NATIVE_BUILD && isNativePlatform()) return true;
  const n = nav();
  if (!n || typeof n.share !== 'function' || typeof n.canShare !== 'function') return false;
  try {
    const probe = new File([new Uint8Array(1)], filename, { type });
    return n.canShare({ files: [probe] }) === true;
  } catch {
    return false;
  }
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

export function shareButtonLabel(
  kind: ShareKind = 'link',
  sheet: boolean = hasShareSheet()
): string {
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
  return (await copyTextOnce(clip, source)) ? 'copied' : 'failed';
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
 *
 * A TOURNAMENT LINK CARRIES THE CLUB (2026-11-22). It carries the sender's
 * club invite code as `?i=`, spelled exactly as a table link spells it
 * (withShareQueryParams), and the World Hub page passes it on to
 * /hub/club-arena/tournaments/<id>. Without it a signed-in friend who was not
 * yet a member of the club opened the link on "Tournament Not Found": the
 * tournament is readable only inside its club, and nothing on the page said
 * which club to join or how. The tournament page now reads `i` and offers the
 * club's own join step (parseTournamentInviteParams), returning to the
 * tournament once joined. `invite` rides the same way for a seat-hold token.
 */
export interface TournamentShareUrlOptions {
  origin?: string;
  inviteCode?: string | null;
  inviteToken?: string | null;
}

export function tournamentShareUrl(
  tournamentId: string,
  originOrOptions?: string | TournamentShareUrlOptions
): string {
  const opts =
    typeof originOrOptions === 'string' ? { origin: originOrOptions } : (originOrOptions ?? {});
  const base = `${opts.origin ?? publicOrigin()}/t/${encodeURIComponent(tournamentId)}`;
  return withShareQueryParams(base, {
    inviteCode: opts.inviteCode,
    inviteToken: opts.inviteToken,
  });
}

export interface TableShareUrlOptions {
  origin?: string;
  inviteCode?: string | null;
  clusterId?: string | null;
  inviteToken?: string | null;
}

export interface LightningShareUrlOptions {
  origin?: string;
  inviteCode?: string | null;
}

function withShareQueryParams(
  base: string,
  params: {
    inviteCode?: string | null;
    clusterId?: string | null;
    inviteToken?: string | null;
  }
): string {
  const q = new URLSearchParams();
  const code = normalizeInviteCode(params.inviteCode);
  const cluster = normalizeUuid(params.clusterId);
  const token = normalizeInviteToken(params.inviteToken);
  if (code) q.set('i', code);
  if (cluster) q.set('cluster', cluster);
  if (token) q.set('invite', token);
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Shareable link to a live table (cash game, or a seated Spin / Heads-Up table).
 *
 * Uses smarter.poker/g/<id> (World Hub SSR preview + 1200x630 OG card via
 * fn_ca_table_share_preview, instant redirect to /hub/club-arena/table/<id>
 * when signed in, rich invite card when signed out) while preserving optional
 * sender club invite code (`i`), Must-Move cluster id (`cluster`), and
 * Heads-Up specific-player hold token (`invite`).
 */
export function tableShareUrl(
  tableId: string,
  originOrOptions?: string | TableShareUrlOptions
): string {
  const opts =
    typeof originOrOptions === 'string' ? { origin: originOrOptions } : (originOrOptions ?? {});
  const base = `${opts.origin ?? publicOrigin()}/g/${encodeURIComponent(tableId)}`;
  return withShareQueryParams(base, opts);
}

/**
 * Shareable link to a Lightning Cash cluster's join door.
 *
 * Uses smarter.poker/l/<clusterId> (World Hub SSR preview + 1200x630 OG card
 * via fn_ca_lightning_share_preview, instant redirect to
 * /hub/club-arena/lightning/<clusterId> when signed in). A Lightning pool
 * session id belongs solely to one player — sharing the cluster door takes any
 * club member straight into the pool while preserving optional `?i=<CODE>`.
 */
export function lightningShareUrl(
  clusterId: string,
  originOrOptions?: string | LightningShareUrlOptions
): string {
  const opts =
    typeof originOrOptions === 'string' ? { origin: originOrOptions } : (originOrOptions ?? {});
  const base = `${opts.origin ?? publicOrigin()}/l/${encodeURIComponent(clusterId)}`;
  return withShareQueryParams(base, { inviteCode: opts.inviteCode });
}

export type GameInviteTarget =
  | {
      kind: 'table';
      id: string;
      inviteCode?: string | null;
      clusterId?: string | null;
      inviteToken?: string | null;
    }
  | { kind: 'tournament'; id: string; inviteCode?: string | null }
  | { kind: 'lightning'; id: string; inviteCode?: string | null };

export interface LobbyInviteTargetOptions {
  inviteCode?: string | null;
  clusterId?: string | null;
}

/**
 * Canonical invite target for any lobby row: Lightning cash games route to
 * their cluster entry door, classic cash games route to the live table (with
 * normalized `clusterId` when belonging to a Must-Move cash game), and
 * tournaments (MTT, Spin, Heads-Up SNG, Satellite) route to the tournament
 * preview link.
 */
export function lobbyEntryInviteTarget(
  entry: {
    id: string;
    kind: string;
    clusterId?: string | null;
    cashGameId?: string | null;
    game?: { id?: string | null; mustMove?: boolean; lightning?: unknown } | null;
    raw?: unknown;
  },
  options?: LobbyInviteTargetOptions
): GameInviteTarget {
  const inviteCode = normalizeInviteCode(options?.inviteCode);
  if (entry.kind === 'cash') {
    if (entry.game?.lightning && entry.game.id) {
      return {
        kind: 'lightning',
        id: entry.game.id,
        ...(inviteCode ? { inviteCode } : {}),
      };
    }
    const rawRow =
      entry.raw && typeof entry.raw === 'object'
        ? (entry.raw as { cluster_id?: unknown; cluster_must_move?: unknown })
        : null;
    const rawClusterId =
      options?.clusterId ??
      entry.clusterId ??
      entry.cashGameId ??
      (entry.game?.id && entry.game.mustMove !== false ? entry.game.id : null) ??
      (rawRow?.cluster_id && rawRow.cluster_must_move !== false ? rawRow.cluster_id : null);
    const clusterId = normalizeUuid(rawClusterId);
    return {
      kind: 'table',
      id: entry.id,
      ...(inviteCode ? { inviteCode } : {}),
      ...(clusterId ? { clusterId } : {}),
    };
  }
  return {
    kind: 'tournament',
    id: entry.id,
    ...(inviteCode ? { inviteCode } : {}),
  };
}

export interface TableInviteContext {
  tableId: string;
  /** The Lightning cluster this room belongs to, when it is a Lightning room. */
  lightningClusterId?: string | null;
  isTournament: boolean;
  tournamentId?: string | null;
  /** Must-Move cash game id of a cash table. */
  clusterId?: string | null;
  inviteCode?: string | null;
  /**
   * The Heads Up seat-hold token while the inviter holds the other seat for
   * one named player (wait mode "Specific Player"), else null.
   */
  seatHoldToken?: string | null;
}

/**
 * WHAT AN INVITE SENT FROM A TABLE POINTS AT (2026-11-22). One decision for
 * the link, the system share sheet and the in-app friend invite, so the three
 * can never name different games.
 *
 * A tournament table is NOT the game's address. A Spin, a Sit & Go and a
 * satellite recycle their tables, a running MTT moves the inviter from table
 * to table, and a friend sent to "the table I am at" lands as a spectator at
 * a felt with other people seated, or on "Table Unavailable". The tournament
 * is the address: its page knows whether the game is still open, where its
 * live table is, and which game replaced it once it started.
 *
 * The one exception is a Heads Up seat being held for a named player: the
 * hold's token opens that one seat at that one table, so that link is the
 * table with the token.
 */
export function tableInviteTarget(ctx: TableInviteContext): GameInviteTarget {
  const inviteCode = normalizeInviteCode(ctx.inviteCode);
  const code = inviteCode ? { inviteCode } : {};
  if (ctx.lightningClusterId) {
    return { kind: 'lightning', id: ctx.lightningClusterId, ...code };
  }
  if (ctx.isTournament) {
    const seatHoldToken = normalizeInviteToken(ctx.seatHoldToken);
    if (seatHoldToken) {
      return { kind: 'table', id: ctx.tableId, ...code, inviteToken: seatHoldToken };
    }
    if (ctx.tournamentId) return { kind: 'tournament', id: ctx.tournamentId, ...code };
    return { kind: 'table', id: ctx.tableId, ...code };
  }
  const clusterId = normalizeUuid(ctx.clusterId);
  return { kind: 'table', id: ctx.tableId, ...code, ...(clusterId ? { clusterId } : {}) };
}

/**
 * Canonical invite URL for any Club Arena game: Lightning clusters point at
 * their Lightning join route; classic cash tables, and a Heads Up seat held
 * for a named player, point directly at the table; every other tournament
 * (MTT, Sit & Go, Spin, Heads Up, Satellite) points at the tournament preview
 * link, from the lobby and from the table alike (tableInviteTarget).
 */
export function gameInviteUrl(
  target: GameInviteTarget,
  originOrOptions?: string | TableShareUrlOptions
): string {
  const opts =
    typeof originOrOptions === 'string' ? { origin: originOrOptions } : (originOrOptions ?? {});
  const inviteCode = opts.inviteCode ?? target.inviteCode;
  if (target.kind === 'tournament') {
    return tournamentShareUrl(target.id, { origin: opts.origin, inviteCode });
  }
  if (target.kind === 'lightning') {
    return lightningShareUrl(target.id, { origin: opts.origin, inviteCode });
  }
  return tableShareUrl(target.id, {
    origin: opts.origin,
    inviteCode,
    clusterId: opts.clusterId ?? target.clusterId,
    inviteToken: opts.inviteToken ?? target.inviteToken,
  });
}

/** Consistent invite sentence paired with a game invite link. */
export function gameInviteText(gameName: string | null | undefined): string {
  const clean = (gameName || '').trim();
  return clean ? `Join Me In ${clean} On Smarter.Poker` : 'Join My Poker Game On Smarter.Poker';
}

/**
 * For a caller that already has its own try/catch around a copy: resolves
 * when the text was copied (Clipboard API or the selection copy), rejects
 * when neither worked. Drop-in for a bare navigator.clipboard.writeText.
 */
export async function writeClipboard(text: string): Promise<void> {
  if (!(await copyToClipboard(text))) throw new Error('Copy Is Unavailable Here');
}
