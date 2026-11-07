/**
 * Observe deployed-shell freshness without replacing an open document.
 *
 * Owner direction 2026-11-07: entering a page must not trigger a second,
 * automatic page refresh. The service worker reads the current shell BEFORE
 * a document navigation commits. An open SPA keeps its coherent immutable
 * bundle, table views and drafts until the player next opens or reloads it.
 * Legacy SHELL_UPDATED messages, focus and route observations are telemetry
 * only. They never activate a waiting worker or reload a rendered page.
 */
import { useEffect } from 'react';
import { masterBus } from '../core/MasterBus';
import { readDeployedShell } from '../lib/readDeployedShell';

/** How often the resume-path staleness probe may touch the network. */
export const STALE_CHECK_MIN_INTERVAL_MS = 60 * 1000;

/** Preserve the existing idle freshness telemetry without forced adoption. */
export const STALE_CHECK_IDLE_MS = 15 * 60 * 1000;

/** Should the 5 s poll ask the server for the deployed shell now? */
export function staleCheckDue(opts: {
  pathname: string;
  lastPathname: string;
  visible: boolean;
  lastCheckAt: number;
  now: number;
}): boolean {
  if (opts.pathname !== opts.lastPathname) return true;
  return opts.visible && opts.now - opts.lastCheckAt >= STALE_CHECK_IDLE_MS;
}

export function extractEntryScript(html: string): string | null {
  const m = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  return m ? m[0] : null;
}

export function useShellUpdateGate(): void {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    let armed = true;

    let verifying = false;
    const verifyShell = (source: 'shell-updated' | 'controllerchange') => {
      if (!armed || verifying) return;
      const running = extractEntryScript(document.documentElement.outerHTML);
      if (!running) return; // dev server or unknown shell shape: stand down
      const base =
        import.meta.env.BASE_URL && import.meta.env.BASE_URL !== '/'
          ? import.meta.env.BASE_URL
          : '/';
      verifying = true;
      readDeployedShell(`${base}index.html`)
        .then((html) => {
          if (!armed) return;
          const deployed = html ? extractEntryScript(html) : null;
          const stale = !!deployed && deployed !== running;
          // Record both outcomes; neither changes the document.
          if (deployed) {
            masterBus.emit('SHELL_STALENESS_CHECKED', { stale, source, running, deployed });
          }
        })
        .catch(() => {
          /* offline or blocked: nothing to adopt, nothing to do */
        })
        .finally(() => {
          verifying = false;
        });
    };

    const onMessage = (event: MessageEvent) => {
      const type = (event.data as { type?: string } | null)?.type;
      if (type !== 'SHELL_UPDATED') return;
      verifyShell('shell-updated');
    };

    // Legacy workers can report updates. Observe them without replacing this document.
    const onControllerChange = () => {
      verifyShell('controllerchange');
    };

    /* The resume-path probe. See the block comment above the hook. */
    let lastStaleCheckAt = 0;
    /** Returns whether the probe ran (false: unmounted or inside the throttle). */
    const checkStaleness = (): boolean => {
      if (!armed) return false;
      const now = Date.now();
      if (now - lastStaleCheckAt < STALE_CHECK_MIN_INTERVAL_MS) return false;
      lastStaleCheckAt = now;

      // 1. Let the browser discover a rotated sw-bus.js without a navigation.
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => reg?.update())
        .catch(() => {});

      // 2. Compare the deployed shell's entry chunk against the one running.
      const running = extractEntryScript(document.documentElement.outerHTML);
      if (!running) return true; // dev server or a shell shape we do not recognise
      const base =
        import.meta.env.BASE_URL && import.meta.env.BASE_URL !== '/'
          ? import.meta.env.BASE_URL
          : '/';
      readDeployedShell(`${base}index.html`)
        .then((html) => {
          if (!armed) return;
          if (!html) return;
          const deployed = extractEntryScript(html);
          const stale = !!deployed && deployed !== running;
          if (deployed) {
            masterBus.emit('SHELL_STALENESS_CHECKED', {
              stale,
              source: 'resume-probe',
              running,
              deployed,
            });
          }
        })
        .catch(() => {
          /* offline or blocked: nothing to adopt, nothing to do */
        });
      return true;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkStaleness();
    };
    /* pageshow fires when a PWA or bfcache page resumes without a real
       navigation — the exact case the probe exists for. */
    const onPageShow = () => checkStaleness();
    /* Focus returns without a visibility change on a desktop window that was
       merely behind another one. */
    const onFocus = () => checkStaleness();
    let lastPathname = window.location.pathname;
    // Preserve the existing observation cadence; route changes never reload the page.
    const poll = window.setInterval(() => {
      /* A route change is consumed only by a probe that actually ran: one
         that lands inside the throttle (say, a minute after a focus check)
         stays due and is retried on the next tick, rather than being
         forgotten until the 15-minute idle check. */
      if (
        staleCheckDue({
          pathname: window.location.pathname,
          lastPathname,
          visible: document.visibilityState === 'visible',
          lastCheckAt: lastStaleCheckAt,
          now: Date.now(),
        }) &&
        checkStaleness()
      ) {
        lastPathname = window.location.pathname;
      }
    }, 5000);

    navigator.serviceWorker.addEventListener('message', onMessage);
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);

    // Home Screen startup can finish pageshow before React mounts this hook.
    // Check once now as well as on later resumes, with the existing throttle.
    checkStaleness();

    return () => {
      armed = false; // Ignore observations completing after unmount.
      navigator.serviceWorker.removeEventListener('message', onMessage);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      window.clearInterval(poll);
    };
  }, []);
}
