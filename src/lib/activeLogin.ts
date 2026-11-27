/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ONE ACTIVE PHYSICAL DEVICE PER ACCOUNT, WITH APPROVAL-BASED PAIRING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan, 2026-11-01: a login on a different physical device must sign the others
 * out, while every browser on the SAME physical device stays signed in.
 *
 * THE CONSTRAINT. Browsers are sandboxed, so no header (IP, user agent,
 * platform) is an unforgeable per-machine identity, and two browsers on one
 * Mac cannot share anything automatically. "These two browsers are the same
 * device" can only be asserted by the user and proven by a browser already
 * signed in on that device. So each browser carries a stable random token
 * (getDeviceId), the database groups tokens into physical devices, and a new
 * browser joins an existing device only by APPROVAL from one already on it.
 *
 * THE FLOW (server contract in migration 20261102023127):
 *   - claim(token): a bound browser is activated (its device becomes active,
 *     other devices are signed out); the first browser on a new account auto
 *     enrolls; a NEW browser on an account that already has a device gets
 *     back needs_choice and this module asks the user.
 *   - user picks "same device as X"  -> request_pairing(X); a browser on X
 *     shows an Approve prompt (delivered over realtime); on approve this
 *     browser re-claims and coexists.
 *   - user picks "new device"        -> register_new_device (signs others out).
 *   - a dead/resumed session         -> handleEngineAuthRejection, which asks
 *     GoTrue directly and bounces to sign-in, never on a network error.
 *
 * All UI here is plain DOM (like announceSessionEnded): it must work before
 * React mounts and during a reconnect. Title Case, no em dashes (house rule).
 */
import { supabase } from './supabase';
import { getDeviceId } from './deviceSighting';
import { parseJwtPayload } from './authUtils';
import { isRealtimeLive, startRealtimeAwarePoll } from './realtimeAwarePoll';

export const ENROLLED_DEVICE_STORAGE_KEY = 'ca_enrolled_device_id';
export const RESUME_SESSION_GONE_SOURCE = 'resume:session_gone';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let started = false;
let claiming: string | null = null;
let myDeviceId: string | null = null;
let approveListenerUp = false;
let approveListenerEpoch = 0;
let stopApproveListener: (() => void) | null = null;
const approvalPrompts = new Set<string>();
let stopPairingWait: (() => void) | null = null;
const verifiedThisBoot = new Set<string>();
const bounced = new Set<string>();
const choosingFor = new Set<string>();

interface DeviceRow {
  id: string;
  label: string;
}
interface ClaimAnswer {
  ok?: boolean;
  why?: string;
  superseded?: boolean;
  bound?: boolean;
  first?: boolean;
  device_id?: string;
  needs_choice?: boolean;
  devices?: DeviceRow[];
}

export function sessionIdOf(token: string | null | undefined): string | null {
  if (!token) return null;
  const sid = parseJwtPayload(token)?.session_id;
  return typeof sid === 'string' && UUID_RE.test(sid.toLowerCase()) ? sid.toLowerCase() : null;
}

/** A friendly default name for THIS browser. A label only, never identity. */
function defaultLabel(): string {
  try {
    const ua = navigator.userAgent || '';
    const os = /iphone/i.test(ua)
      ? 'iPhone'
      : /ipad/i.test(ua)
        ? 'iPad'
        : /android/i.test(ua)
          ? 'Android'
          : /macintosh|mac os x/i.test(ua)
            ? 'Mac'
            : /windows/i.test(ua)
              ? 'Windows'
              : /cros/i.test(ua)
                ? 'Chromebook'
                : /linux/i.test(ua)
                  ? 'Linux'
                  : 'This Device';
    const br = /edg\//i.test(ua)
      ? 'Edge'
      : /chrome|crios/i.test(ua)
        ? 'Chrome'
        : /firefox|fxios/i.test(ua)
          ? 'Firefox'
          : /safari/i.test(ua)
            ? 'Safari'
            : 'Browser';
    return `${br} on ${os}`;
  } catch {
    return 'This Device';
  }
}

function rememberDevice(id: string | undefined): void {
  if (!id) return;
  myDeviceId = id;
  try {
    localStorage.setItem(ENROLLED_DEVICE_STORAGE_KEY, id);
  } catch {
    /* private mode */
  }
}
function recallDevice(): string | null {
  if (myDeviceId) return myDeviceId;
  try {
    return localStorage.getItem(ENROLLED_DEVICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

async function bounceDeadSession(sid: string, superseded: boolean): Promise<void> {
  if (bounced.has(sid)) return;
  bounced.add(sid);
  try {
    const { handleEngineAuthRejection, ANOTHER_DEVICE_SOURCE } = await import('./sessionRevoked');
    await handleEngineAuthRejection(
      superseded ? ANOTHER_DEVICE_SOURCE : RESUME_SESSION_GONE_SOURCE,
      true
    );
  } catch {
    /* the engine's own 4401 path is the backstop */
  }
}

/** Enroll this browser for the signed-in session. Idempotent per session. */
export async function enrollDevice(
  token: string | null | undefined,
  verify = false
): Promise<void> {
  const sid = sessionIdOf(token);
  if (!sid || claiming === sid || bounced.has(sid) || choosingFor.has(sid)) return;
  // A bound browser re-verifies at most once per boot; a brand new browser
  // always runs so it can prompt.
  if (verify && verifiedThisBoot.has(sid) && recallDevice()) return;
  claiming = sid;
  try {
    const { data, error } = await supabase.rpc('ca_claim_active_login', {
      p_device_id: getDeviceId(),
      p_label: defaultLabel(),
    });
    if (error) return; // transport failure: the next auth event retries
    const a = (data ?? {}) as ClaimAnswer;
    verifiedThisBoot.add(sid);
    if (a.ok === false && a.why === 'session_gone') {
      void bounceDeadSession(sid, a.superseded === true);
      return;
    }
    if (a.bound) {
      rememberDevice(a.device_id);
      startApproveListener();
      return;
    }
    if (a.needs_choice) {
      choosingFor.add(sid);
      void askSameOrNewDevice(sid, a.devices ?? []);
    }
  } catch {
    /* unreachable: the next auth event retries */
  } finally {
    if (claiming === sid) claiming = null;
  }
}

/** The user's choice for a brand new browser. */
async function askSameOrNewDevice(sid: string, devices: DeviceRow[]): Promise<void> {
  const choice = await promptSameOrNew(devices);
  try {
    if (choice.kind === 'new') {
      const { data, error } = await supabase.rpc('ca_register_new_device', {
        p_device_id: getDeviceId(),
        p_label: defaultLabel(),
      });
      const a = (data ?? {}) as ClaimAnswer;
      if (!error && a.ok !== false) {
        rememberDevice(a.device_id);
        startApproveListener();
      }
    } else {
      await requestPairingAndWait(choice.deviceId, choice.label);
    }
  } catch {
    /* leave unbound; a later event or reload retries */
  } finally {
    choosingFor.delete(sid);
  }
}

/** Ask a browser on the chosen device to approve, and wait for the verdict. */
async function requestPairingAndWait(deviceId: string, label: string): Promise<void> {
  const { data, error } = await supabase.rpc('ca_request_pairing', {
    p_device_id: getDeviceId(),
    p_target_device_id: deviceId,
    p_label: defaultLabel(),
  });
  const req = (data ?? {}) as { ok?: boolean; request_id?: string };
  if (error || req.ok === false || !req.request_id) {
    promptNewDeviceFallback();
    return;
  }
  const dialog = showWaitingForApproval(label);
  const verdict = await waitForPairingVerdict(req.request_id);
  dialog.close();
  if (verdict === 'approved') {
    // Bound now: re-claim to pin this session to the device and coexist.
    const { data: d2, error: e2 } = await supabase.rpc('ca_claim_active_login', {
      p_device_id: getDeviceId(),
      p_label: defaultLabel(),
    });
    const a = (d2 ?? {}) as ClaimAnswer;
    if (!e2 && a.bound) {
      rememberDevice(a.device_id);
      startApproveListener();
    }
  } else if (verdict !== 'cancelled') {
    promptNewDeviceFallback();
  }
}

/** Subscribe to this pairing request's row; resolve when it is decided. */
function waitForPairingVerdict(
  requestId: string
): Promise<'approved' | 'denied' | 'timeout' | 'cancelled'> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: 'approved' | 'denied' | 'timeout' | 'cancelled') => {
      if (done) return;
      done = true;
      stopPairingWait = null;
      try {
        void supabase.removeChannel(ch);
      } catch {
        /* */
      }
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('pageshow', onResume);
      poll.stop();
      clearTimeout(timer);
      resolve(v);
    };
    // Realtime can miss the first event; poll as a backstop.
    const readVerdict = async () => {
      if (done) return;
      try {
        const { data, error } = await supabase
          .from('ca_pairing_requests')
          .select('status')
          .eq('id', requestId)
          .maybeSingle();
        if (error) return;
        const st = String((data as { status?: string } | null)?.status ?? '');
        if (st === 'approved') finish('approved');
        else if (st === 'denied' || st === 'expired') finish('denied');
      } catch {
        /* keep waiting */
      }
    };
    const poll = startRealtimeAwarePoll(() => void readVerdict(), { fastMs: 2500 });
    const ch = supabase
      .channel(`pairing-wait:${requestId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'ca_pairing_requests',
          filter: `id=eq.${requestId}`,
        },
        (p) => {
          const s = String((p.new as Record<string, unknown>)?.status ?? '');
          if (s === 'approved') finish('approved');
          else if (s === 'denied' || s === 'expired') finish('denied');
        }
      )
      .subscribe((status) => {
        // The read below is the safety net: every 2.5 s while this channel is
        // not subscribed, every 30 s while it is (src/lib/realtimeAwarePoll.ts).
        // Re-read on SUBSCRIBED so a verdict written before the channel joined
        // is not left to the slow cadence.
        const live = isRealtimeLive(status);
        poll.setLive(live);
        if (live) void readVerdict();
      });
    const onResume = () => {
      if (document.visibilityState !== 'hidden') void readVerdict();
    };
    const timer = setTimeout(() => finish('timeout'), 180_000);
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('pageshow', onResume);
    stopPairingWait = () => finish('cancelled');
    void readVerdict();
  });
}

/**
 * Listen for pairing requests aimed at THIS browser's device and show an
 * Approve prompt. Only a browser already on the target device sees this, and
 * the server refuses a resolve from any other device, so it is unforgeable.
 */
export function startApproveListener(): void {
  if (approveListenerUp) return;
  const mine = recallDevice();
  if (!mine) return;
  approveListenerUp = true;
  const epoch = ++approveListenerEpoch;
  stopApproveListener = () => {
    approveListenerEpoch++;
    approveListenerUp = false;
  };
  try {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (epoch !== approveListenerEpoch) return;
        const uid = data.session?.user?.id;
        if (!uid) {
          approveListenerUp = false;
          return;
        }
        let active = true;
        const controller = new AbortController();
        const readPending = async () => {
          if (!active || document.visibilityState === 'hidden') return;
          try {
            const { data: requests, error } = await supabase
              .from('ca_pairing_requests')
              .select('id,user_id,target_device_id,label,status,created_at')
              .eq('user_id', uid)
              .eq('target_device_id', mine)
              .eq('status', 'pending')
              .gte('created_at', new Date(Date.now() - 180_000).toISOString());
            if (!active || error) return;
            for (const row of requests ?? []) void maybeShowApprove(row, controller.signal);
          } catch {
            /* A later foreground/subscription event can read the durable request. */
          }
        };
        const onResume = () => void readPending();
        const channel = supabase
          .channel(`pairing-approve:${uid}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'ca_pairing_requests',
              filter: `user_id=eq.${uid}`,
            },
            (p) => void maybeShowApprove(p.new as Record<string, unknown>, controller.signal)
          )
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') void readPending();
          });
        document.addEventListener('visibilitychange', onResume);
        window.addEventListener('pageshow', onResume);
        stopApproveListener = () => {
          active = false;
          approveListenerEpoch++;
          controller.abort();
          document.removeEventListener('visibilitychange', onResume);
          window.removeEventListener('pageshow', onResume);
          void supabase.removeChannel(channel);
          approveListenerUp = false;
        };
        void readPending();
      })
      .catch(() => {
        approveListenerUp = false;
      });
  } catch {
    approveListenerUp = false;
  }
}

async function maybeShowApprove(row: Record<string, unknown>, signal: AbortSignal): Promise<void> {
  const mine = recallDevice();
  if (signal.aborted || !mine) return;
  if (String(row.status ?? '') !== 'pending') return;
  if (String(row.target_device_id ?? '') !== mine) return;
  // The requesting browser waits three minutes. Never resurrect an old prompt.
  const created = Date.parse(String(row.created_at ?? ''));
  if (!Number.isFinite(created) || Date.now() - created > 180_000) return;
  const reqId = String(row.id ?? '');
  const label = String(row.label ?? 'A New Browser');
  if (!reqId || approvalPrompts.has(reqId)) return;
  approvalPrompts.add(reqId);
  await promptApprove(
    label,
    async (approve) => {
      if (signal.aborted) return true;
      try {
        const { data, error } = await supabase.rpc('ca_resolve_pairing', {
          p_request_id: reqId,
          p_approve: approve,
          p_caller_device_id: getDeviceId(),
        });
        const result = (data ?? {}) as { ok?: boolean; why?: string };
        return !error && (result.ok === true || result.why === 'not_pending');
      } catch {
        return false;
      }
    },
    signal
  );
}

/** Wire enrollment to sign-in and session restore. Idempotent. */
export function startSingleActiveLogin(): void {
  if (started) return;
  started = true;
  try {
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        stopPairingWait?.();
        stopApproveListener?.();
        stopApproveListener = null;
        approvalPrompts.clear();
        return;
      }
      if (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') return;
      const token = session?.access_token;
      const verify = event === 'INITIAL_SESSION';
      queueMicrotask(() => void enrollDevice(token, verify));
    });
  } catch {
    /* auth unavailable */
  }
}

export function __resetActiveLoginForTests(): void {
  stopPairingWait?.();
  stopApproveListener?.();
  stopApproveListener = null;
  approvalPrompts.clear();
  started = false;
  claiming = null;
  myDeviceId = null;
  approveListenerUp = false;
  verifiedThisBoot.clear();
  bounced.clear();
  choosingFor.clear();
}

// ── DOM UI (self-contained, theme-neutral, Title Case, no em dashes) ────────

function overlay(): HTMLDivElement {
  const w = document.createElement('div');
  w.setAttribute('role', 'alertdialog');
  w.style.cssText =
    'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,.82);padding:24px;font-family:system-ui,-apple-system,sans-serif;';
  return w;
}
function card(): HTMLDivElement {
  const c = document.createElement('div');
  c.style.cssText =
    'max-width:380px;width:100%;background:#15181d;border:1px solid #2b6cb0;border-radius:14px;padding:22px 20px;' +
    'color:#fff;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.6);';
  return c;
}
function heading(text: string): HTMLDivElement {
  const h = document.createElement('div');
  h.textContent = text;
  h.style.cssText = 'font-size:19px;font-weight:700;margin-bottom:10px;';
  return h;
}
function body(text: string): HTMLDivElement {
  const b = document.createElement('div');
  b.textContent = text;
  b.style.cssText = 'font-size:14px;line-height:1.45;opacity:.9;margin-bottom:18px;';
  return b;
}
function button(text: string, primary: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.style.cssText =
    'width:100%;padding:12px;border:0;border-radius:10px;margin-top:8px;font-size:15px;font-weight:700;cursor:pointer;' +
    (primary ? 'background:#2f7fe0;color:#fff;' : 'background:#2a2f37;color:#fff;');
  return b;
}

type Choice = { kind: 'new' } | { kind: 'same'; deviceId: string; label: string };

function promptSameOrNew(devices: DeviceRow[]): Promise<Choice> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve({ kind: 'new' });
      return;
    }
    const w = overlay();
    const c = card();
    c.append(heading('Is This The Same Device?'));
    c.append(
      body(
        'You Are Already Signed In On Another Device. If This Is The Same Computer, Add This Browser To It. Otherwise Sign In As A New Device, Which Signs Out The Others.'
      )
    );
    for (const d of devices.slice(0, 5)) {
      const b = button(`Same As ${d.label}`, true);
      b.addEventListener('click', () => {
        w.remove();
        resolve({ kind: 'same', deviceId: d.id, label: d.label });
      });
      c.append(b);
    }
    const nb = button('This Is A New Device', false);
    nb.addEventListener('click', () => {
      w.remove();
      resolve({ kind: 'new' });
    });
    c.append(nb);
    w.append(c);
    document.body.append(w);
  });
}

function showWaitingForApproval(label: string): { close: () => void } {
  if (typeof document === 'undefined') return { close: () => {} };
  const w = overlay();
  const c = card();
  c.append(heading('Waiting For Approval'));
  c.append(
    body(
      `Open Club Arena On ${label} And Tap Approve To Add This Browser. This Window Updates On Its Own.`
    )
  );
  w.append(c);
  document.body.append(w);
  return { close: () => w.remove() };
}

function promptApprove(
  label: string,
  decide: (approve: boolean) => Promise<boolean>,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve();
      return;
    }
    const w = overlay();
    const c = card();
    const close = () => {
      signal.removeEventListener('abort', close);
      w.remove();
      resolve();
    };
    signal.addEventListener('abort', close, { once: true });
    c.append(heading('Add A New Browser?'));
    c.append(
      body(
        `${label} Is Trying To Sign In On This Device. Approve It Only If You Opened It. If Not, Deny It.`
      )
    );
    const ap = button('Approve', true);
    const dn = button('Deny', false);
    const errorText = body('');
    errorText.setAttribute('role', 'status');
    const submit = async (approve: boolean) => {
      if (ap.disabled || signal.aborted) return;
      ap.disabled = dn.disabled = true;
      errorText.textContent = '';
      const resolved = await decide(approve);
      if (resolved) {
        close();
      } else {
        errorText.textContent = 'Unable To Save Your Choice. Check Your Connection And Try Again.';
        ap.disabled = dn.disabled = false;
      }
    };
    ap.addEventListener('click', () => void submit(true));
    dn.addEventListener('click', () => void submit(false));
    c.append(errorText);
    c.append(ap, dn);
    w.append(c);
    document.body.append(w);
  });
}

function promptNewDeviceFallback(): void {
  if (typeof document === 'undefined') return;
  const w = overlay();
  const c = card();
  c.append(heading('Not Approved'));
  c.append(
    body(
      'This Browser Was Not Added To Your Other Device. You Can Sign In As A New Device, Which Signs Out The Others.'
    )
  );
  const nb = button('Sign In As A New Device', true);
  nb.addEventListener('click', () => {
    w.remove();
    void supabase
      .rpc('ca_register_new_device', { p_device_id: getDeviceId(), p_label: defaultLabel() })
      .then(({ data }) => {
        const a = (data ?? {}) as ClaimAnswer;
        if (a.ok !== false) {
          rememberDevice(a.device_id);
          startApproveListener();
        }
      });
  });
  const cb = button('Not Now', false);
  cb.addEventListener('click', () => w.remove());
  c.append(nb, cb);
  w.append(c);
  document.body.append(w);
}
