// A loopback origin runs the real worker. Only this origin delays HTML.
// The observer stays outside the worker scope so its receipt survives a reload.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { devices, webkit } from 'playwright';

const scope = '/hub/club-arena/';
const table = scope + 'table/8aea2cc5-e05a-4aa2-9404-ffa34a9fb33e';
const archived = process.argv.includes('--archived');
// This is the worker source served in production job 133706789784, before
// deployment stamping. Use its immutable source only for an explicit replay.
const source = archived
  ? execFileSync('git', ['show', 'a95c33b906f73f8aaa8b7fdf87b3462ceeddde12:public/sw-bus.js'], {
      encoding: 'utf8',
    })
  : readFileSync('public/sw-bus.js', 'utf8');
const observer = `
const stages = [];
const nativeFetch = self.fetch.bind(self);
self.fetch = async (request, init) => {
  if (!(request instanceof Request) || new URL(request.url).pathname !== ${JSON.stringify(table)})
    return nativeFetch(request, init);
  stages.push('inner-fetch');
  init?.signal?.addEventListener('abort', () => stages.push('inner-abort'), { once: true });
  const response = await nativeFetch(request, init);
  stages.push('inner-headers');
  return response;
};
self.addEventListener('message', event => {
  if (event.data === 'read-loopback-stages') event.ports[0].postMessage(stages);
});
`;

const browser = await webkit.launch();
try {
  for (const hold of ['headers', 'first-byte', 'body']) {
    let delayed = false,
      requests = 0,
      disconnected = false;
    let closeTransfer;
    const closed = new Promise((resolve) => {
      closeTransfer = resolve;
    });
    const server = createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (req.url === scope + 'sw-bus.js') {
        res.setHeader('Content-Type', 'application/javascript');
        return res.end(observer + source);
      }
      res.setHeader('Content-Type', 'text/html');
      if (req.url === table && delayed) {
        requests++;
        res.once('close', () => {
          disconnected = true;
          closeTransfer();
        });
        if (hold === 'first-byte') res.flushHeaders();
        if (hold === 'body') res.write('<!doctype html><head>');
        return;
      }
      res.end('<!doctype html><title>complete shell</title>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const context = await browser.newContext({
      ...devices['iPhone 13'],
      viewport: { width: 390, height: 664 },
    });
    try {
      const monitor = await context.newPage();
      await monitor.goto(origin + '/observer');
      const page = await context.newPage();
      await page.goto(origin + scope + 'clubs/lobby');
      await page.evaluate(async (scope) => {
        await navigator.serviceWorker.register(scope + 'sw-bus.js');
        await navigator.serviceWorker.ready;
      }, scope);
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await page.evaluate((path) => history.pushState(null, '', path), table);
      const receipt = randomUUID();
      const timing = (type) =>
        page.evaluate(
          ({ type, receipt }) => {
            const channel = new MessageChannel();
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('Missing shell trace')), 2000);
              channel.port1.onmessage = ({ data }) => {
                clearTimeout(timer);
                channel.port1.close();
                resolve(data);
              };
              navigator.serviceWorker.controller.postMessage(
                { type, receipt, pathname: location.pathname },
                [channel.port2]
              );
            });
          },
          { type, receipt }
        );
      await context.setOffline(true);
      await context.setOffline(false);
      if (!archived) assert.equal((await timing('ARM_SHELL_TRACE')).armed, true);
      delayed = true;
      let outerResponse = false;
      page.on('response', (response) => {
        if (response.url() === origin + table && response.request().isNavigationRequest())
          outerResponse = true;
      });
      let committed = false,
        crashed = false,
        timedOut = false;
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) committed = true;
      });
      page.on('crash', () => {
        crashed = true;
      });
      const start = Date.now();
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (error) {
        if (error.name !== 'TimeoutError') throw error;
        timedOut = true;
      }
      const elapsedMs = Date.now() - start;
      const stages = await monitor.evaluate(async (scope) => {
        const worker = (await navigator.serviceWorker.getRegistration(scope)).active;
        const channel = new MessageChannel();
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Missing worker timing receipt')), 3000);
          channel.port1.onmessage = (e) => {
            clearTimeout(timer);
            channel.port1.close();
            resolve(e.data);
          };
          worker.postMessage('read-loopback-stages', [channel.port2]);
        });
      }, scope);
      console.log(
        JSON.stringify({
          archived,
          hold,
          requests,
          elapsedMs,
          outerResponse,
          committed,
          timedOut,
          crashed,
          stages,
          disconnected,
        })
      );
      assert.equal(requests, 1);
      assert.equal(crashed, false);
      assert.equal(timedOut, archived && stages.includes('inner-headers'));
      assert.ok(stages.includes('inner-fetch'));
      if (hold !== 'first-byte') assert.equal(stages.includes('inner-headers'), hold === 'body');
      if (!timedOut) assert.equal(await page.title(), 'complete shell');
      if (!archived) {
        const { events } = await timing('READ_SHELL_TRACE');
        console.log(JSON.stringify({ hold, workerTiming: events }));
        const phases = events.map((e) => e.phase);
        assert.ok(phases.includes('network-start'));
        assert.equal(phases.includes('network-headers'), stages.includes('inner-headers'));
        assert.ok(phases.includes('network-deadline'));
        assert.ok(phases.includes('serve-cached-shell'));
        assert.ok(stages.includes('inner-abort'));
        // The worker's signal is synchronous; the server socket closes asynchronously.
        let timer;
        try {
          await Promise.race([
            closed,
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('Timed-out HTML transfer remained open')),
                2000
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
    } finally {
      await context.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
} finally {
  await browser.close();
}
