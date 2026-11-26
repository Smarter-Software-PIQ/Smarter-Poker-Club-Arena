import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, X, Maximize2, Send, ImagePlus, Reply, Smile, ThumbsUp } from './DockIcons';
import { dockFailureText, dockName } from './messengerDock.mjs';
import { visibleMessageBoundary, isMessageId, CONTINUITY_PREFIX } from './messengerContinuity.mjs';
import {
  createMessengerSendOperation,
  restoreMessengerSendOperations,
  performMessengerSend,
  mergeMessengerPendingMessages,
  reconcileMessengerMessage,
  messengerOperationMessage,
  acknowledgeMessengerSend,
} from './messengerSendOperation.mjs';
import { persistReadWithRetry, readFailureMessage } from './messengerReadRetry.mjs';
import DockMediaViewer from './DockMediaViewer';

const MESSAGE_ROUTES = {
  'get-messages': '/api/messenger/get-messages',
  'mark-read': '/api/messenger/mark-read',
};
const STORAGE_OBJECT =
  /^(https:\/\/[a-z0-9-]+\.supabase\.co)\/storage\/v1\/object\/public\/([^?#]+)$/i;
const HEIC_MIME_RE = /^image\/hei[cf]$/i;
const HEIC_EXT_RE = /\.hei[cf]$/i;
const UPLOAD_EXT_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  hevc: 'video/hevc',
  mkv: 'video/x-matroska',
};
function isVisualMediaKind(kind) {
  return kind === 'image' || kind === 'video' || kind === 'gif';
}
function resolveUploadMedia(file) {
  if (!file) return null;
  let mimeType = String(file.type || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!mimeType || mimeType === 'application/octet-stream') {
    const ext = String(file.name || '')
      .split('.')
      .pop()
      .toLowerCase();
    mimeType = UPLOAD_EXT_MIME[ext] || '';
  }
  if (!mimeType || mimeType === 'image/svg+xml') return null;
  if (mimeType.startsWith('image/')) return { kind: 'image', mimeType };
  if (mimeType.startsWith('video/')) return { kind: 'video', mimeType };
  return null;
}
function isSafeMediaUrl(value) {
  if (typeof value !== 'string') return false;
  const url = value.trim();
  if (!url || url.length > 2048 || /[\s<>"'`\\]/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
function encodeMessageMedia({ kind, url, caption } = {}) {
  const markers = { image: 'Image', video: 'Video', gif: 'GIF', audio: 'Audio' };
  const marker = markers[kind];
  if (!marker || !isSafeMediaUrl(url)) return null;
  const base = `[${marker}](${url.trim()})`;
  const cleanCaption = typeof caption === 'string' ? caption.replace(/\r\n?/g, '\n').trim() : '';
  return cleanCaption ? `${base} ${cleanCaption}` : base;
}
function mediaThumbnailUrl(url, { kind = 'image', width = 800, quality = 72 } = {}) {
  if (!isSafeMediaUrl(url)) return null;
  if (kind !== 'image') return url;
  const match = STORAGE_OBJECT.exec(url.trim());
  if (!match) return url;
  return `${match[1]}/storage/v1/render/image/public/${match[2]}?width=${width}&quality=${quality}`;
}
function extractMediaDimensions(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const width = Math.round(Number(meta.media_width ?? meta.width));
  const height = Math.round(Number(meta.media_height ?? meta.height));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width < 16 || height < 16 || width > 16384 || height > 16384) return null;
  const ratio = width / height;
  if (!Number.isFinite(ratio) || ratio < 0.25 || ratio > 4) return null;
  return { width, height, aspectRatio: `${width} / ${height}` };
}
function videoPreviewUrl(url) {
  if (!isSafeMediaUrl(url)) return url;
  const trimmed = url.trim();
  return trimmed.includes('#') ? trimmed : `${trimmed}#t=0.001`;
}
async function prepareDockUploadFile(rawFile) {
  const resolved = resolveUploadMedia(rawFile);
  if (!resolved) return null;
  const isVideo = resolved.kind === 'video';
  const fileName = rawFile.name || `media_${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`;
  if (isVideo) {
    return {
      file: rawFile,
      kind: 'video',
      mimeType: resolved.mimeType,
      fileName,
      width: null,
      height: null,
    };
  }
  const heic = HEIC_MIME_RE.test(resolved.mimeType) || HEIC_EXT_RE.test(fileName);
  let width = null;
  let height = null;
  if (typeof window !== 'undefined' && typeof createImageBitmap === 'function') {
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(rawFile, { imageOrientation: 'from-image' });
    } catch {
      try {
        bitmap = await createImageBitmap(rawFile);
      } catch {
        bitmap = null;
      }
    }
    if (bitmap) {
      try {
        width = bitmap.width || null;
        height = bitmap.height || null;
        if (heic && width > 0 && height > 0) {
          const longest = Math.max(width, height);
          const scale = longest > 3000 ? 3000 / longest : 1;
          const w = Math.max(1, Math.round(width * scale));
          const h = Math.max(1, Math.round(height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0, w, h);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
            canvas.width = 0;
            canvas.height = 0;
            if (blob) {
              const base = fileName.replace(/\.[^.]+$/, '');
              const converted =
                typeof File === 'function'
                  ? new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
                  : blob;
              return {
                file: converted,
                kind: 'image',
                mimeType: 'image/jpeg',
                fileName: `${base}.jpg`,
                width: w,
                height: h,
              };
            }
          }
        }
      } finally {
        if (typeof bitmap.close === 'function') bitmap.close();
      }
    }
  }
  return {
    file: rawFile,
    kind: 'image',
    mimeType: resolved.mimeType,
    fileName,
    width: width > 0 ? Math.round(width) : null,
    height: height > 0 ? Math.round(height) : null,
  };
}
function uploadDockFileWithProgress(file, signedUrl, mimeType, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const createAbort = () => Object.assign(new Error('Upload Cancelled'), { name: 'AbortError' });
    if (signal?.aborted) {
      reject(createAbort());
      return;
    }
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', handleAbort);
      fn(value);
    };
    const handleAbort = () => {
      try {
        xhr.abort();
      } catch {
        /* ignore */
      }
      finish(reject, createAbort());
    };
    const timer = setTimeout(() => {
      try {
        xhr.abort();
      } catch {
        /* ignore */
      }
      finish(reject, new Error('Upload Timed Out'));
    }, 300000);
    signal?.addEventListener('abort', handleAbort, { once: true });
    xhr.open('PUT', signedUrl, true);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.max(0, Math.min(99, Math.round((event.loaded / event.total) * 100))));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        finish(resolve, null);
      } else {
        finish(reject, new Error('Upload Did Not Complete'));
      }
    };
    xhr.onerror = () => finish(reject, new Error('Upload Did Not Complete'));
    xhr.onabort = () => finish(reject, createAbort());
    xhr.send(file);
  });
}
function extractReplyPrefix(content) {
  if (typeof content !== 'string') return { replyQuote: null, body: '' };
  const match = /^\[REPLY:([^\]]+)\]\s*/.exec(content);
  if (!match) return { replyQuote: null, body: content };
  return { replyQuote: match[1].trim(), body: content.slice(match[0].length) };
}
function stripForwardPrefix(content) {
  if (typeof content !== 'string') return '';
  let text = content.trim();
  while (text.startsWith('[Forwarded] ')) {
    text = text.slice('[Forwarded] '.length).trim();
  }
  return text;
}
function safeMedia(content) {
  if (typeof content !== 'string') return null;
  let text = extractReplyPrefix(content).body.trim();
  let forwarded = false;
  while (text.startsWith('[Forwarded] ')) {
    forwarded = true;
    text = text.slice('[Forwarded] '.length).trim();
  }
  text = text.replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u, '');
  const match =
    /^\[(Image|Video|GIF|Audio)\]\((https:\/\/[^\s)]+)\)(?:\|dur:(\d+(?:\.\d+)?))?/i.exec(text);
  if (!match) return null;
  return {
    kind: match[1].toLowerCase(),
    url: match[2],
    caption: text.slice(match[0].length).trim(),
    forwarded,
  };
}
function formatReplyQuote(content, maxLength = 80) {
  const raw = extractReplyPrefix(String(content || '')).body.trim();
  if (!raw) return 'Attachment';
  const media = safeMedia(raw);
  const labels = { image: 'Photo', video: 'Video', gif: 'GIF', audio: 'Voice Message' };
  const summary = media
    ? media.caption
      ? `${labels[media.kind] || 'Attachment'}: ${media.caption}`
      : labels[media.kind] || 'Attachment'
    : stripForwardPrefix(raw);
  const safe = summary
    .replace(/[\r\n]+/g, ' ')
    .replace(/\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!safe) return 'Attachment';
  return maxLength > 0 && safe.length > maxLength ? safe.slice(0, maxLength).trimEnd() : safe;
}
function DockMedia({ media, dimensions = null, replyQuote }) {
  const [failed, setFailed] = useState(false);
  const [fitted, setFitted] = useState(true);
  const [viewing, setViewing] = useState(false);
  useEffect(() => {
    setFailed(false);
    setFitted(true);
    setViewing(false);
  }, [media?.url]);
  if (!media) return null;
  const replyEl = replyQuote ? <div className="dock-reply-quote">{replyQuote}</div> : null;
  const forwardedEl = media.forwarded ? (
    <div className="dock-media-forwarded">Forwarded</div>
  ) : null;
  const captionEl = media.caption ? (
    <div className="dock-media-caption">{media.caption}</div>
  ) : null;
  const hasChrome = Boolean(replyQuote || media.forwarded || media.caption);
  if (failed) {
    return (
      <>
        {replyEl}
        {forwardedEl}
        <a
          className="dock-media-fallback"
          href={media.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span aria-hidden="true">📎</span>
          <span>{media.kind === 'video' ? 'Video' : 'Photo'} · Tap To Open</span>
        </a>
        {captionEl}
      </>
    );
  }
  if (media.kind === 'video') {
    return (
      <>
        {replyEl}
        {forwardedEl}
        <div className="dock-media-stage dock-media-stage-video">
          <video
            src={videoPreviewUrl(media.url) || media.url}
            width={dimensions?.width}
            height={dimensions?.height}
            style={dimensions?.aspectRatio ? { aspectRatio: dimensions.aspectRatio } : undefined}
            controls
            playsInline
            preload="metadata"
            onError={() => setFailed(true)}
          />
        </div>
        {captionEl}
      </>
    );
  }
  const label = media.kind === 'gif' ? 'GIF' : 'Photo Attachment';
  const src = fitted ? mediaThumbnailUrl(media.url, { kind: media.kind }) || media.url : media.url;
  return (
    <>
      {replyEl}
      {forwardedEl}
      <div className={`dock-media-stage ${hasChrome ? 'dock-media-stage-framed' : ''}`}>
        <img
          src={src}
          alt={label}
          width={dimensions?.width}
          height={dimensions?.height}
          style={dimensions?.aspectRatio ? { aspectRatio: dimensions.aspectRatio } : undefined}
          loading="lazy"
          decoding="async"
          onError={() => {
            if (src !== media.url) setFitted(false);
            else setFailed(true);
          }}
          onClick={(event) => {
            event.stopPropagation();
            setViewing(true);
          }}
        />
      </div>
      {captionEl}
      {viewing && (
        <DockMediaViewer url={media.url} label={label} onClose={() => setViewing(false)} />
      )}
    </>
  );
}
export default function MessengerChat({
  actorId,
  identity,
  conversation,
  services,
  continuityOwner,
  onMinimize,
  onClose,
  onRead,
}) {
  const id = conversation.id;
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typing, setTyping] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [older, setOlder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [pendingMedia, setPendingMedia] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [newAvailable, setNewAvailable] = useState(false);
  const [emojis, setEmojis] = useState(false);
  const uploadAbort = useRef(null);
  const pendingPreviewUrl = useRef(null);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const scroll = useRef(null);
  const composer = useRef(null);
  const file = useRef(null);
  const nearBottom = useRef(true);
  const channel = useRef(null);
  const typingTimer = useRef(null);
  const typingSent = useRef(0);
  const readThrough = useRef(null);
  const reading = useRef(false);
  const positionTimer = useRef(null);
  const hasLoaded = useRef(false);
  const ops = useRef(new Map());
  const request = async (path, body) => {
    const response = await services.request(MESSAGE_ROUTES[path], {
      method: 'POST',
      body: JSON.stringify(body),
      actorId,
      currentActor: () => identity.current,
    });
    const data = await response.json();
    if (!response.ok || data.success !== true)
      throw Object.assign(new Error(data.error || 'Messages Are Unavailable'), {
        status: response.status,
      });
    return data;
  };
  const current = () => mounted.current && identity.current === actorId;
  const continuity = useMemo(() => {
    let storage = null;
    try {
      storage = window.localStorage;
    } catch {
      /* Controller reports the failure. */
    }
    return continuityOwner.get(actorId, conversation.dockWorkspace || { workspace: 'social' }, {
      storage,
      committed: (conversationId, receipt) =>
        services.broadcastSync('smarter_poker_continuity_sync', {
          actorId,
          conversationId,
          workspace: conversation.dockWorkspace || { workspace: 'social' },
          receipt: { field: receipt.field, revision: receipt.revision },
        }),
      request: async (body) => {
        const response = await services.request('/api/messenger/continuity', {
          method: 'POST',
          body: JSON.stringify(body),
          actorId,
          currentActor: () => identity.current,
        });
        return { ok: response.ok, status: response.status, body: await response.json() };
      },
    });
  }, [actorId, id, services, continuityOwner]);
  const draftTimer = useRef(null);
  const draft = continuity.state(id).draft;
  const editDraft = (text) => {
    continuity.edit(id, 'draft', { text, replyToId: continuity.state(id).draft.replyToId });
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => void continuity.write(id, 'draft'), 600);
  };
  const load = useCallback(
    async (before = null, anchor = null) => {
      const requestSequence = ++sequence.current;
      const previousHeight = scroll.current?.scrollHeight || 0;
      const position = continuity.state(id).position;
      const boundary = visibleMessageBoundary(scroll.current);
      const anchorId =
        anchor ||
        (!hasLoaded.current && isMessageId(position.messageId) ? position.messageId : null);
      const offset =
        boundary?.first === anchorId
          ? boundary.offset
          : position.messageId === anchorId
            ? position.offset
            : 0;
      try {
        const data = await request('get-messages', {
          conversationId: id,
          limit: 50,
          ...(before
            ? { before: before.created_at, beforeId: before.id }
            : anchorId
              ? { anchorMessageId: anchorId }
              : {}),
        });
        if (!current() || sequence.current !== requestSequence || !Array.isArray(data.messages))
          return;
        setMessages((previous) => {
          let next = before ? previous : [];
          for (const message of data.messages) next = reconcileMessengerMessage(next, message);
          for (const operation of ops.current.values()) {
            const receipt = data.messages.find(
              (message) =>
                message.request_id === operation.requestId && message.sender_id === actorId
            );
            if (receipt) acknowledgeMessengerSend(operation, receipt, window.localStorage);
          }
          next = mergeMessengerPendingMessages(next, [...ops.current.values()], actorId, id);
          return next.sort(
            (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
          );
        });
        hasLoaded.current = true;
        setOlder(data.hasOlder === true || data.messages.length === 50);
        setError('');
        requestAnimationFrame(() => {
          if (!current() || !scroll.current) return;
          if (anchorId) {
            const row = scroll.current.querySelector(`[data-message-id="${anchorId}"]`);
            if (row)
              scroll.current.scrollTop +=
                row.getBoundingClientRect().top -
                scroll.current.getBoundingClientRect().top -
                offset;
          } else if (before)
            scroll.current.scrollTop += scroll.current.scrollHeight - previousHeight;
          else if (nearBottom.current) scroll.current.scrollTop = scroll.current.scrollHeight;
        });
      } catch (failure) {
        if (current() && sequence.current === requestSequence) {
          if ([401, 403, 404].includes(failure.status)) setMessages([]);
          setError(dockFailureText(failure));
        }
      } finally {
        if (current() && sequence.current === requestSequence) setLoading(false);
      }
    },
    [actorId, id, services]
  );

  useEffect(() => {
    mounted.current = true;
    try {
      const pending = restoreMessengerSendOperations(window.localStorage, actorId).filter(
        (operation) => operation.conversationId === id
      );
      ops.current = new Map(pending.map((operation) => [operation.requestId, operation]));
    } catch {
      /* A new send will explicitly report missing durable storage. */
    }
    void continuity.read(id).then(() => {
      if (current()) void load();
    });
    let refreshTimer = null;
    const refresh = (payload) => {
      if (!current()) return;
      clearTimeout(refreshTimer);
      if (payload?.eventType === 'INSERT' && !nearBottom.current) {
        setNewAvailable(true);
        return;
      }
      const anchor = !nearBottom.current ? visibleMessageBoundary(scroll.current)?.first : null;
      refreshTimer = setTimeout(() => void load(null, anchor), 50);
    };
    const instanceSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const realtime = services.supabase
      .channel(`dock-conversation:${actorId}:${id}:${instanceSuffix}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'social_messages',
          filter: `conversation_id=eq.${id}`,
        },
        refresh
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && current()) void load();
      });
    const rawLive = services.supabase.channel(`typing:${id}`);
    const liveWasJoined = rawLive?.state === 'joined' || rawLive?.state === 'joining';
    const live = rawLive
      .on('broadcast', { event: 'typing' }, (event) => {
        if (!current() || event.payload?.userId === actorId) return;
        setTyping(true);
        clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => {
          if (current()) setTyping(false);
        }, 3000);
      })
      .on('broadcast', { event: 'read_receipt' }, (event) => {
        const payload = event.payload;
        if (
          !current() ||
          payload?.readerId === actorId ||
          payload?.conversationId !== id ||
          !Number.isFinite(Date.parse(payload.readThrough))
        )
          return;
        setMessages((previous) =>
          previous.map((message) =>
            message.sender_id === actorId &&
            Date.parse(message.created_at) <= Date.parse(payload.readThrough)
              ? { ...message, is_read: true, status: 'read' }
              : message
          )
        );
      });
    if (!liveWasJoined) live.subscribe();
    channel.current = live;
    const returned = () => {
      if (document.visibilityState === 'visible') {
        void load(null, !nearBottom.current ? visibleMessageBoundary(scroll.current)?.first : null);
        void continuity.read(id);
      }
    };
    const stored = (event) => {
      if (event.key === `${CONTINUITY_PREFIX}${actorId}:${id}`) continuity.acceptLocal(id);
    };
    const stop = services.listenBroadcast('smarter_poker_continuity_sync', (event) => {
      if (event?.actorId === actorId && event.conversationId === id)
        continuity.acceptCommit(id, event.receipt, event.workspace);
    });
    document.addEventListener('visibilitychange', returned);
    window.addEventListener('online', returned);
    window.addEventListener('focus', returned);
    window.addEventListener('storage', stored);
    return () => {
      clearTimeout(draftTimer.current);
      clearTimeout(positionTimer.current);
      void continuity.write(id, 'draft');
      void continuity.write(id, 'position');
      mounted.current = false;
      ++sequence.current;
      if (uploadAbort.current) {
        try {
          uploadAbort.current.abort();
        } catch {
          /* unmounting */
        }
      }
      if (pendingPreviewUrl.current) {
        URL.revokeObjectURL(pendingPreviewUrl.current);
        pendingPreviewUrl.current = null;
      }
      clearTimeout(refreshTimer);
      clearTimeout(typingTimer.current);
      stop();
      services.supabase.removeChannel(realtime);
      if (!liveWasJoined) services.supabase.removeChannel(live);
      channel.current = null;
      document.removeEventListener('visibilitychange', returned);
      window.removeEventListener('online', returned);
      window.removeEventListener('focus', returned);
      window.removeEventListener('storage', stored);
    };
  }, [actorId, id, services, continuity, load]);

  const markVisible = useCallback(async () => {
    if (!engaged || !current() || reading.current || document.visibilityState !== 'visible') return;
    const boundary = visibleMessageBoundary(scroll.current);
    if (!boundary || boundary.last === readThrough.current) return;
    reading.current = true;
    let confirmed = false;
    try {
      const saved = await persistReadWithRetry(
        () =>
          request('mark-read', {
            conversationId: id,
            throughMessageId: boundary.last,
          }),
        { stillWanted: () => current() && document.visibilityState === 'visible' }
      );
      if (!saved.ok) {
        if (!saved.abandoned && current()) setError(readFailureMessage(saved.error));
        return;
      }
      const result = saved.value;
      if (identity.current !== actorId) return;
      // The acknowledged read still refreshes badges if this panel was
      // minimized while the request was in flight. No unmounted UI write.
      services.broadcastSync('smarter_poker_unread_sync', 'refresh_unread');
      if (!mounted.current) return;
      readThrough.current = boundary.last;
      confirmed = true;
      const prefs = await services.getPreferences(actorId);
      if (current() && prefs.readReceipts !== false)
        void channel.current?.send({
          type: 'broadcast',
          event: 'read_receipt',
          payload: { readerId: actorId, conversationId: id, readThrough: result.readThrough },
        });
      if (current()) onRead();
    } catch (failure) {
      if (current()) setError(dockFailureText(failure));
    } finally {
      reading.current = false;
      const latest = visibleMessageBoundary(scroll.current);
      if (confirmed && current() && latest && latest.last !== readThrough.current)
        void markVisible();
    }
  }, [engaged, actorId, id, services]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => void markVisible());
    return () => cancelAnimationFrame(frame);
  }, [messages, engaged, markVisible]);

  const attempt = async (operation, capturedDraft) => {
    try {
      await performMessengerSend(operation, {
        storage: window.localStorage,
        currentActor: () => identity.current,
        send: (body) =>
          services.request('/api/messenger/send-message', {
            method: 'POST',
            body,
            actorId,
            currentActor: () => identity.current,
          }),
        changed: (changed) => {
          if (!current()) return;
          setMessages((previous) =>
            reconcileMessengerMessage(
              previous,
              changed.receipt || messengerOperationMessage(changed)
            )
          );
        },
      });
      if (current() && operation.receipt) {
        if (capturedDraft) {
          continuity.clearDraftIfUnchanged(id, capturedDraft);
          void continuity.write(id, 'draft');
        }
        nearBottom.current = true;
        void load();
      }
    } catch (failure) {
      if (current()) setError(dockFailureText(failure));
    }
  };
  const send = (content = draft.text, consume = true, metadata = null) => {
    if (!current() || !content.trim() || content.length > 2000) return;
    const captured = continuity.state(id).draft;
    const quoted =
      consume && captured.replyToId
        ? messages.find((message) => message.id === captured.replyToId)
        : null;
    const wireContent = quoted
      ? `[REPLY:${formatReplyQuote(quoted.content || '', 80)}] ${content}`
      : content;
    if (wireContent.length > 2000) {
      setError('Reply Is Too Long. Shorten The Message');
      return;
    }
    // Repeated Enter/clicks while a send is ambiguous retain its request ID.
    const pending = [...ops.current.values()].find(
      (operation) => !operation.receipt && JSON.parse(operation.body).content === wireContent
    );
    if (pending) {
      void attempt(pending, consume ? captured : null);
      return;
    }
    const operation = createMessengerSendOperation({
      actorId,
      conversationId: id,
      content: wireContent,
      metadata,
    });
    ops.current.set(operation.requestId, operation);
    void attempt(operation, consume ? captured : null);
  };
  const clearPendingMedia = () => {
    if (pendingPreviewUrl.current) {
      URL.revokeObjectURL(pendingPreviewUrl.current);
      pendingPreviewUrl.current = null;
    }
    setPendingMedia(null);
  };
  const stageMedia = (media) => {
    if (!media || !current()) return;
    const resolved = resolveUploadMedia(media);
    if (!resolved || media.size > (resolved.kind === 'video' ? 50 : 10) * 1024 * 1024) {
      setError('Choose An Image Under 10MB Or Video Under 50MB');
      return;
    }
    if (pendingPreviewUrl.current) {
      URL.revokeObjectURL(pendingPreviewUrl.current);
      pendingPreviewUrl.current = null;
    }
    const previewUrl = URL.createObjectURL(media);
    pendingPreviewUrl.current = previewUrl;
    setError('');
    setPendingMedia({
      file: media,
      kind: resolved.kind,
      mimeType: resolved.mimeType,
      name: media.name || (resolved.kind === 'video' ? 'Video' : 'Photo'),
      previewUrl,
    });
    composer.current?.focus();
  };
  const sendPendingMedia = async () => {
    if (!pendingMedia || !current() || uploading) return;
    const mediaToSend = pendingMedia;
    const caption = draft.text.trim();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    uploadAbort.current = controller;
    clearPendingMedia();
    setUploading(true);
    setUploadProgress(0);
    try {
      const prepared = await prepareDockUploadFile(mediaToSend.file);
      if (!prepared || prepared.file.size > (prepared.kind === 'video' ? 50 : 10) * 1024 * 1024) {
        throw new Error('Choose An Image Under 10MB Or Video Under 50MB');
      }
      const response = await services.request('/api/social/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          fileName: prepared.fileName,
          fileSize: prepared.file.size,
          mimeType: prepared.mimeType,
          folder: 'messages',
          prefix: actorId,
        }),
        actorId,
        currentActor: () => identity.current,
        signal: controller?.signal,
      });
      const result = await response.json();
      if (!response.ok || !result.success || !result.signedUrl || !result.publicUrl)
        throw new Error('Upload Could Not Be Started');
      if (!current()) return;
      await uploadDockFileWithProgress(prepared.file, result.signedUrl, prepared.mimeType, {
        onProgress: (pct) => {
          if (current()) setUploadProgress(pct);
        },
        signal: controller?.signal,
      });
      const encoded = encodeMessageMedia({
        kind: prepared.kind,
        url: result.publicUrl,
        caption,
      });
      if (!encoded) throw new Error('Upload Produced An Unusable Address');
      const meta =
        prepared.width && prepared.height
          ? { media_width: prepared.width, media_height: prepared.height }
          : null;
      if (current()) send(encoded, Boolean(caption), meta);
    } catch (failure) {
      if (current() && failure?.name !== 'AbortError') setError(dockFailureText(failure));
    } finally {
      if (uploadAbort.current === controller) uploadAbort.current = null;
      if (current()) {
        setUploading(false);
        setUploadProgress(null);
      }
    }
  };
  const upload = (event) => {
    const media = event.target.files?.[0];
    event.target.value = '';
    stageMedia(media);
  };
  const handlePaste = (event) => {
    if (uploading) return;
    const items = Array.from(event.clipboardData?.items || []);
    for (const item of items) {
      if (item.kind === 'file') {
        const pasted = item.getAsFile?.();
        if (pasted && resolveUploadMedia(pasted)) {
          event.preventDefault();
          stageMedia(pasted);
          return;
        }
      }
    }
    const pasted = Array.from(event.clipboardData?.files || []).find((f) => resolveUploadMedia(f));
    if (pasted) {
      event.preventDefault();
      stageMedia(pasted);
    }
  };
  const handleSubmit = () => {
    if (pendingMedia) {
      void sendPendingMedia();
      return;
    }
    send();
  };
  const openFull = () => {
    onMinimize();
    services.openMessenger(id);
  };
  const name = dockName(conversation);
  return (
    <div
      className={`dock-chat ${dragOver ? 'dock-chat-dragover' : ''}`}
      data-dock-conversation={id}
      onFocusCapture={() => setEngaged(true)}
      onPointerDown={() => setEngaged(true)}
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer?.types || []).includes('Files')) {
          event.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const dropped = Array.from(event.dataTransfer?.files || []).find((f) =>
          resolveUploadMedia(f)
        );
        if (dropped) stageMedia(dropped);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onMinimize();
        }
      }}
    >
      <header className="dock-chat-header">
        {conversation.otherUser?.avatar_url ? (
          <img className="dock-chat-avatar" src={conversation.otherUser.avatar_url} alt="" />
        ) : (
          <span className="dock-chat-avatar dock-initial">{name.slice(0, 1)}</span>
        )}
        <button type="button" className="dock-chat-person" onClick={openFull}>
          <strong>{name}</strong>
          <small>{typing ? 'Typing...' : 'Messenger'}</small>
        </button>
        <button
          type="button"
          aria-label="Expand Conversation"
          title="Open In Messenger"
          onClick={openFull}
        >
          <Maximize2 size={17} />
        </button>
        <button type="button" aria-label="Minimize Conversation" onClick={onMinimize}>
          <Minus size={20} />
        </button>
        <button type="button" aria-label="Close Conversation" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {conversation.relationshipTags?.length > 0 && (
        <div className="dock-chat-relationships" aria-label="Club Relationships">
          {conversation.relationshipTags.map((tag) => (
            <p key={tag.clubId}>{tag.label}</p>
          ))}
        </div>
      )}
      {error && (
        <div className="dock-chat-error" role="alert">
          {error}{' '}
          <button
            type="button"
            onClick={() => {
              void load();
              void markVisible();
            }}
          >
            Retry
          </button>
        </div>
      )}
      {draft.conflict && (
        <div className="dock-chat-error" role="alert">
          Draft Changed In Another Window{' '}
          <button type="button" onClick={() => continuity.resolve(id, 'draft', true)}>
            Keep This Draft
          </button>{' '}
          <button type="button" onClick={() => continuity.resolve(id, 'draft', false)}>
            Use Synced Draft
          </button>
        </div>
      )}
      {!draft.conflict && [...continuity.errors.values()].length > 0 && (
        <div className="dock-chat-error" role="status">
          Conversation Sync Needs Attention{' '}
          <button
            type="button"
            onClick={() => {
              void continuity.read(id);
              void continuity.write(id, 'draft');
              void continuity.write(id, 'position');
            }}
          >
            Retry
          </button>
        </div>
      )}
      <div
        className="dock-chat-messages"
        ref={scroll}
        role="log"
        aria-label={`Messages With ${name}`}
        aria-live="polite"
        onScroll={() => {
          if (scroll.current)
            nearBottom.current =
              scroll.current.scrollHeight - scroll.current.clientHeight - scroll.current.scrollTop <
              64;
          if (engaged) {
            const boundary = visibleMessageBoundary(scroll.current);
            if (boundary) {
              continuity.edit(id, 'position', {
                messageId: boundary.first,
                offset: boundary.offset,
              });
              clearTimeout(positionTimer.current);
              positionTimer.current = setTimeout(() => void continuity.write(id, 'position'), 400);
            }
          }
          void markVisible();
        }}
      >
        {loading && <p role="status">Loading Messages...</p>}
        {older && (
          <button
            className="dock-history"
            type="button"
            onClick={() => void load(messages.find((message) => isMessageId(message.id)))}
          >
            Load Earlier Messages
          </button>
        )}
        {!loading && !messages.length && !error && (
          <p className="dock-empty">Start A Conversation With {name}</p>
        )}
        {messages.map((message) => {
          const own = message.sender_id === actorId;
          const { replyQuote, body } = extractReplyPrefix(message.content || '');
          const media =
            !message.is_deleted && message.message_type !== 'invoice' && safeMedia(message.content);
          const visualMedia = Boolean(media && isVisualMediaKind(media.kind));
          return (
            <div
              key={message.id}
              data-message-id={message.id}
              className={`dock-message ${own ? 'dock-own' : ''}`}
            >
              <div
                className={`dock-message-bubble ${visualMedia ? 'dock-media-bubble' : ''}`}
                data-media-frame={visualMedia ? media.kind : undefined}
                title={new Date(message.created_at).toLocaleString()}
              >
                {message.is_deleted ? (
                  <em>Message Removed</em>
                ) : message.message_type === 'invoice' ? (
                  <button type="button" onClick={openFull}>
                    Open Invoice In Messenger
                  </button>
                ) : visualMedia ? (
                  <DockMedia
                    media={media}
                    dimensions={extractMediaDimensions(message.media_metadata || message.metadata)}
                    replyQuote={replyQuote}
                  />
                ) : media?.kind === 'audio' ? (
                  <>
                    {replyQuote && <div className="dock-reply-quote">{replyQuote}</div>}
                    <audio src={media.url} controls />
                  </>
                ) : (
                  <>
                    {replyQuote && <div className="dock-reply-quote">{replyQuote}</div>}
                    {body}
                  </>
                )}
              </div>
              {own && (
                <small className="dock-message-status">
                  {message.status === 'sending' ? (
                    'Sending...'
                  ) : message.status === 'failed' ? (
                    <button
                      type="button"
                      onClick={() => {
                        const operation = ops.current.get(message.request_id);
                        if (operation) void attempt(operation);
                      }}
                    >
                      Not Sent. Retry
                    </button>
                  ) : message.is_read || message.status === 'read' ? (
                    'Seen'
                  ) : (
                    'Sent'
                  )}
                </small>
              )}
              {!message.is_deleted && isMessageId(message.id) && (
                <button
                  type="button"
                  className="dock-reply"
                  aria-label="Reply To Message"
                  onClick={() => {
                    continuity.edit(id, 'draft', { text: draft.text, replyToId: message.id });
                    composer.current?.focus();
                  }}
                >
                  <Reply size={14} />
                </button>
              )}
            </div>
          );
        })}
        {typing && (
          <div className="dock-typing" role="status">
            {name} Is Typing...
          </div>
        )}
      </div>
      {newAvailable && (
        <button
          type="button"
          className="dock-new-messages"
          onClick={() => {
            setNewAvailable(false);
            nearBottom.current = true;
            void load();
          }}
        >
          New Messages
        </button>
      )}
      {draft.replyToId && (
        <div className="dock-reply-banner">
          Replying To Message{' '}
          <button
            type="button"
            aria-label="Cancel Reply"
            onClick={() => {
              continuity.edit(id, 'draft', { text: draft.text, replyToId: null });
              void continuity.write(id, 'draft');
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {emojis && (
        <div className="dock-emojis">
          {[
            '\u{1f600}',
            '\u{1f602}',
            '\u{2764}\u{fe0f}',
            '\u{1f44d}',
            '\u{1f389}',
            '\u{1f60e}',
          ].map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`Insert ${emoji}`}
              onClick={() => {
                editDraft((draft.text + emoji).slice(0, 2000));
                setEmojis(false);
                composer.current?.focus();
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      {uploading && (
        <div className="dock-upload-progress" role="status">
          <span>{uploadProgress != null ? `Uploading ${uploadProgress}%` : 'Uploading...'}</span>
          <div className="dock-upload-bar">
            <div style={{ width: `${Math.max(5, uploadProgress ?? 15)}%` }} />
          </div>
          <button
            type="button"
            aria-label="Cancel Upload"
            onClick={() => {
              try {
                uploadAbort.current?.abort();
              } catch {
                /* ignore */
              }
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {pendingMedia && !uploading && (
        <div className="dock-media-preview" data-attachment-preview>
          {pendingMedia.kind === 'video' ? (
            <video src={pendingMedia.previewUrl} muted playsInline preload="metadata" />
          ) : (
            <img src={pendingMedia.previewUrl} alt="Attachment Preview" />
          )}
          <span>
            <strong>{pendingMedia.kind === 'video' ? 'Video Ready' : 'Photo Ready'}</strong>
            <small>{pendingMedia.name}</small>
          </span>
          <button type="button" aria-label="Remove Attachment" onClick={clearPendingMedia}>
            <X size={14} />
          </button>
        </div>
      )}
      <form
        className="dock-composer"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <input ref={file} type="file" accept="image/*,video/*" hidden onChange={upload} />
        <button
          type="button"
          aria-label="Attach Photo Or Video"
          disabled={uploading}
          onClick={() => file.current?.click()}
        >
          <ImagePlus size={21} />
        </button>
        <textarea
          ref={composer}
          aria-label={`Message ${name}`}
          placeholder={uploading ? 'Uploading...' : pendingMedia ? 'Add A Caption...' : 'Aa'}
          rows={1}
          maxLength={2000}
          value={draft.text}
          onPaste={handlePaste}
          onChange={(event) => {
            editDraft(event.target.value);
            if (Date.now() - typingSent.current > 1500) {
              typingSent.current = Date.now();
              void channel.current?.send({
                type: 'broadcast',
                event: 'typing',
                payload: { userId: actorId },
              });
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              handleSubmit();
            }
          }}
        />
        <button
          type="button"
          aria-label="Choose Emoji"
          aria-expanded={emojis}
          onClick={() => setEmojis((value) => !value)}
        >
          <Smile size={21} />
        </button>
        {draft.text.trim() || pendingMedia ? (
          <button
            type="submit"
            disabled={uploading}
            aria-label={pendingMedia ? 'Send Attachment' : 'Send Message'}
          >
            <Send size={21} />
          </button>
        ) : (
          <button type="button" aria-label="Send Like" onClick={() => send('\u{1f44d}', false)}>
            <ThumbsUp size={21} />
          </button>
        )}
      </form>
    </div>
  );
}
