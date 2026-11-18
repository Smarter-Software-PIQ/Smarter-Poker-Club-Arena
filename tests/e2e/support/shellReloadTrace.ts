import { randomUUID } from 'node:crypto';
import type { Page, TestInfo } from '@playwright/test';

function workerTiming(page: Page, receipt: string, type: 'ARM_SHELL_TRACE' | 'READ_SHELL_TRACE') {
  return page.locator('html').evaluate(
    async (_root, { receipt, type }) => {
      const pathname = location.pathname;
      const entry = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      const nav = entry && {
        workerStart: entry.workerStart,
        requestStart: entry.requestStart,
        responseStart: entry.responseStart,
        responseEnd: entry.responseEnd,
        domContentLoaded: entry.domContentLoadedEventEnd,
      };
      const worker = navigator.serviceWorker?.controller;
      if (!worker) return { controller: null, pathname, nav };
      const controller = new URL(worker.scriptURL).pathname;
      const channel = new MessageChannel();
      try {
        return await new Promise<{
          controller: string;
          armed?: boolean;
          events?: { phase: string; ms: number }[];
          timedOut?: boolean;
        }>((resolve) => {
          const timer = setTimeout(() => resolve({ controller, timedOut: true }), 2000);
          channel.port1.onmessage = (event) => {
            clearTimeout(timer);
            resolve({ controller, pathname, nav, ...event.data });
          };
          worker.postMessage({ type, receipt, pathname }, [channel.port2]);
        });
      } finally {
        channel.port1.close();
      }
    },
    { receipt, type },
    { timeout: 3000 }
  );
}

export async function reloadWithWorkerTiming(page: Page, testInfo: TestInfo) {
  const receipt = randomUUID();
  const before = await workerTiming(page, receipt, 'ARM_SHELL_TRACE');
  const started = Date.now();
  let crashed = false;
  const onCrash = () => {
    crashed = true;
  };
  page.once('crash', onCrash);
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  } finally {
    const elapsedMs = Date.now() - started;
    page.off('crash', onCrash);
    const after = await workerTiming(page, receipt, 'READ_SHELL_TRACE').catch(() => null);
    const trace = { viewport: page.viewportSize(), before, after, elapsedMs, crashed };
    console.log('[cash-reload-worker]', JSON.stringify(trace));
    await testInfo.attach('cash-reload-worker', {
      contentType: 'application/json',
      body: JSON.stringify(trace),
    });
  }
}
