/** Separate socket/auth readiness from the SDK's channel join deadline.
 * A live cold socket took 15.164s to open while subscribe() spent its 10s
 * join budget in the send buffer. Admission has its own finite 20s budget;
 * callers own their channel join budget. No retry or refresher here.
 */
interface RealtimeOwner {
  setAuth(): Promise<void>;
  connect(): void;
  isConnected(): boolean;
}

function createRefusedSocket(url: string | URL, error: Error): WebSocket {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const emit = (type: string, event: Event) => {
    const handler = (facade as Record<string, unknown>)[`on${type}`];
    if (typeof handler === 'function') {
      try {
        (handler as (e: Event) => void).call(facade, event);
      } catch {
        /* ignore degraded handler errors */
      }
    }
    const set = listeners.get(type);
    if (set) {
      for (const fn of [...set]) {
        try {
          fn.call(facade, event);
        } catch {
          /* ignore degraded listener errors */
        }
      }
    }
  };
  const facade: Record<string, unknown> = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
    readyState: 3,
    url: String(url),
    protocol: '',
    extensions: '',
    bufferedAmount: 0,
    binaryType: 'blob',
    timeout: 0,
    onopen: null,
    onerror: null,
    onmessage: null,
    onclose: null,
    addEventListener(type: string, fn: (event: Event) => void) {
      if (typeof fn !== 'function') return;
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener(type: string, fn: (event: Event) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event: Event) {
      emit(event.type, event);
      return true;
    },
    send() {},
    close() {},
  };
  queueMicrotask(() => {
    emit('error', {
      type: 'error',
      message: error.message,
      error,
      target: facade,
    } as unknown as Event);
    emit('close', {
      type: 'close',
      code: 1000,
      reason: 'WebSocket unavailable',
      wasClean: true,
      target: facade,
    } as unknown as Event);
  });
  return facade as unknown as WebSocket;
}

export class RealtimeAdmission {
  readonly transport: typeof WebSocket;
  private socket: WebSocket | null = null;
  private observers = new Set<(error?: Error) => void>();
  private readinessObservers = new Set<() => void>();
  private refusalObservers = new Set<(error: Error) => void>();
  private warnedRefusal = false;
  private refusedError: Error | null = null;

  constructor(NativeSocket?: typeof WebSocket) {
    // The supported custom transport returns the native socket. Event listeners
    // observe it; the SDK still owns onopen/onclose and reconnect/heartbeat.
    // If the browser refuses `new WebSocket(...)` synchronously (restricted
    // environments, SecurityError, invalid URL), degrade to a closed facade
    // rather than crashing the calling React effect.
    const handleRefusal = (url: string | URL, err: Error): WebSocket => {
      this.refusedError = err;
      if (!this.warnedRefusal) {
        this.warnedRefusal = true;
        console.warn('[Realtime] WebSocket unavailable; degrading cleanly:', err.message);
      }
      for (const listener of [...this.refusalObservers]) {
        try {
          listener(err);
        } catch {
          /* ignore refusal observer errors */
        }
      }
      const socket = createRefusedSocket(url, err);
      this.socket = socket;
      queueMicrotask(() => {
        if (this.socket === socket) this.notify(err);
      });
      return socket;
    };

    const createSocket = (url: string | URL, protocols?: string | string[]) => {
      // Once the runtime has deterministically refused WebSocket construction,
      // do not loop invoking the broken constructor again.
      if (this.refusedError) {
        return handleRefusal(url, this.refusedError);
      }
      const Socket = NativeSocket ?? globalThis.WebSocket;
      let socket: WebSocket;
      if (typeof Socket !== 'function') {
        return handleRefusal(
          url,
          new Error('WebSocket constructor is not available in this runtime')
        );
      }
      try {
        socket = protocols === undefined ? new Socket(url) : new Socket(url, protocols);
      } catch (thrown) {
        const err = thrown instanceof Error ? thrown : new Error('WebSocket unavailable');
        return handleRefusal(url, err);
      }
      this.socket = socket;
      socket.addEventListener('open', () => {
        if (this.socket !== socket) return;
        this.notify();
        // Native open listeners run before the SDK's onopen property. Resume
        // owners after that dispatch, without replacing SDK lifecycle handlers.
        this.notifyReadinessChange();
      });
      const failed = () => {
        if (this.socket === socket)
          this.notify(new Error('Realtime transport closed before admission'));
      };
      socket.addEventListener('error', failed);
      socket.addEventListener('close', failed);
      return socket;
    };
    this.transport = function (url: string | URL, protocols?: string | string[]) {
      return createSocket(url, protocols);
    } as unknown as typeof WebSocket;
  }

  /** Observe actual transport open or a late existing authentication result.
   * This does not reconnect, authenticate, join, or change any deadline.
   */
  onReadinessChange(listener: () => void, signal: AbortSignal): () => void {
    let active = true;
    const observe = () => {
      if (active && !signal.aborted) listener();
    };
    const remove = () => {
      active = false;
      this.readinessObservers.delete(observe);
      signal.removeEventListener('abort', remove);
    };
    if (!signal.aborted) {
      this.readinessObservers.add(observe);
      signal.addEventListener('abort', remove, { once: true });
    }
    return remove;
  }

  /** Observe deterministic synchronous WebSocket constructor refusal so the
   * owning client can stop reconnect storms and short-circuit future connects.
   */
  onRefusal(listener: (error: Error) => void): () => void {
    this.refusalObservers.add(listener);
    if (this.refusedError) {
      try {
        listener(this.refusedError);
      } catch {
        /* ignore refusal observer errors */
      }
    }
    return () => {
      this.refusalObservers.delete(listener);
    };
  }

  getRefusedError(): Error | null {
    return this.refusedError;
  }

  private notifyReadinessChange(): void {
    for (const observer of [...this.readinessObservers]) queueMicrotask(observer);
  }

  private notify(error?: Error): void {
    for (const observer of [...this.observers]) observer(error);
  }

  ready(client: RealtimeOwner, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let authenticated = false;
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.observers.delete(observe);
        signal.removeEventListener('abort', aborted);
        if (error) reject(error);
        else resolve();
      };
      const observe = (error?: Error) => {
        if (error) return finish(error);
        // Resume after dispatch so the native SDK onopen runs first.
        queueMicrotask(() => {
          if (authenticated && client.isConnected()) finish();
        });
      };
      const aborted = () => finish(new DOMException('Realtime admission cancelled', 'AbortError'));
      const timer = setTimeout(
        () =>
          finish(new DOMException('Realtime transport/auth admission timed out', 'TimeoutError')),
        20_000
      );
      this.observers.add(observe);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) return aborted();
      try {
        client.connect();
        void client.setAuth().then(
          () => {
            authenticated = true;
            // The finite waiter may have already reported a timeout, while its
            // original auth operation still legitimately completes later.
            // Preserve that event for active owners without starting a refresh.
            if (finished && !signal.aborted && client.isConnected()) this.notifyReadinessChange();
            observe();
          },
          (error: unknown) =>
            finish(error instanceof Error ? error : new Error('Realtime authentication failed'))
        );
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Realtime connection failed'));
      }
    });
  }
}

export const realtimeAdmission = new RealtimeAdmission();
