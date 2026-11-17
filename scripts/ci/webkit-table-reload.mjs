// A loopback origin runs the real worker. Only this origin delays HTML or an animated table image.
// The observer stays outside the worker scope so its receipt survives a reload.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { devices, webkit } from 'playwright';

const scope = '/hub/club-arena/';
const table = scope + 'table/8aea2cc5-e05a-4aa2-9404-ffa34a9fb33e';
const asset = scope + 'images/throwables/animated/chicken.webp';
const image = readFileSync('public/images/throwables/animated/chicken.webp');
const archived = process.argv.includes('--archived');
// This is the worker source served in production job 133706789784, before
// deployment stamping. Use its immutable source only for an explicit replay.
const source = archived
  ? execFileSync('git', ['show', 'a95c33b906f73f8aaa8b7fdf87b3462ceeddde12:public/sw-bus.js'], {
      encoding: 'utf8',
    })
  : readFileSync('public/sw-bus.js', 'utf8');
const observer = `
let observerPort;
function stage(name) { observerPort?.postMessage(name); }
self.addEventListener('fetch', event => {
  if (new URL(event.request.url).pathname === ${JSON.stringify(table)}) stage('fetch-event');
});
const nativeFetch = self.fetch.bind(self);
self.fetch = async (request, init) => {
  if (!(request instanceof Request) || new URL(request.url).pathname !== ${JSON.stringify(table)})
    return nativeFetch(request, init);
  stage('inner-fetch');
  init?.signal?.addEventListener('abort', () => stage('inner-abort'), { once: true });
  const response = await nativeFetch(request, init);
  stage('inner-headers');
  return response;
};
self.addEventListener('message', event => {
  if (event.data === 'observe-loopback') {
    observerPort = event.ports[0];
    stage('armed');
  }
});
`;

const browser = await webkit.launch();
try {
  for (const hold of ['asset', 'headers', 'first-byte', 'body']) {
    let delayed = false,
      requests = 0,
      disconnected = false;
    let imageResponse;
    let firstBytes;
    const imageStarted = new Promise((resolve) => {
      firstBytes = resolve;
    });
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
      if (req.url === asset) {
        res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': image.length });
        res.write(image.subarray(0, 16384));
        imageResponse = res;
        firstBytes();
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      if (req.url === table && delayed) {
        requests++;
        if (hold === 'asset') return res.end('<!doctype html><title>complete shell</title>');
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
      await monitor.evaluate(async (scope) => {
        window.workerStages = [];
        const worker = (await navigator.serviceWorker.getRegistration(scope)).active;
        const channel = new MessageChannel();
        await new Promise((resolve) => {
          channel.port1.onmessage = ({ data }) => {
            window.workerStages.push(data);
            if (data === 'armed') resolve();
          };
          worker.postMessage('observe-loopback', [channel.port2]);
        });
      }, scope);
      await page.evaluate((path) => {
        history.pushState(null, '', path);
        window.originalTable = true;
      }, table);
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
      if (hold === 'asset') {
        await page.evaluate((path) => {
          const img = new Image();
          img.src = path;
          document.body.append(img);
        }, asset);
        await imageStarted;
        // Original trace: image headers arrived 77ms before reload.
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
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
      const stages = await monitor.evaluate(() => window.workerStages);
      const originalDocument = await page.evaluate(() => window.originalTable === true);
      console.log(
        JSON.stringify({
          originalDocument,
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
      if (hold === 'asset') {
        assert.equal(crashed, false);
        assert.equal(originalDocument, archived);
        assert.equal(timedOut, archived);
        assert.equal(committed, !archived);
        assert.equal(outerResponse, !archived);
        assert.equal(requests, archived ? 0 : 1);
        if (!archived) {
          assert.ok(stages.includes('inner-headers'));
          assert.equal(await page.title(), 'complete shell');
          console.log(
            JSON.stringify({ hold, workerTiming: (await timing('READ_SHELL_TRACE')).events })
          );
        }
        continue;
      }
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
      imageResponse?.end(image.subarray(16384));
      await context.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
} finally {
  await browser.close();
}
