import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { ConsoleMessage, Frame, Page, Response } from '@playwright/test';

// The Linux trace uses kernel uptime and PIDs. Keep observations in the test
// worker so a dying page cannot erase the last milestone or its process tree.
function linuxRenderers() {
  if (process.platform !== 'linux') return;
  const uptime = Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf8' });
  const parents = new Map<number, number>();
  const renderers: number[] = [];
  for (const line of rows.trim().split('\n')) {
    const [pid, parent, name] = line.trim().split(/\s+/, 3);
    parents.set(Number(pid), Number(parent));
    if (name === 'WPEWebProcess' || name === 'WebKitWebProces') renderers.push(Number(pid));
  }
  const pids = renderers.filter((pid) => {
    let parent = parents.get(pid);
    while (parent && parent !== process.pid) parent = parents.get(parent);
    return parent === process.pid;
  });
  const processes = pids.map((pid) => {
    try {
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      // Fields after the final ')' start at field 3. Start ticks distinguish PID reuse.
      return {
        pid,
        startTicks: Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]),
        rssKiB: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0),
      };
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      return { pid, disappearedDuringRead: true };
    }
  });
  return { uptime, worker: process.pid, processes };
}

export function traceTableNavigation(page: Page, tableId: string, entry: 'document' | 'click') {
  const start = Date.now();
  const events: { phase: string; elapsedMs: number; linux?: ReturnType<typeof linuxRenderers> }[] =
    [];
  function mark(phase: string) {
    const elapsedMs = Date.now() - start;
    const event = { phase, elapsedMs, linux: linuxRenderers() };
    events.push(event);
    // The console receipt survives a renderer loss or an interrupted attachment.
    console.log('[393px-navigation]', JSON.stringify({ tableId, entry, start, ...event }));
  }
  const path = '/table/' + tableId;
  const response = (res: Response) => {
    const req = res.request();
    if (
      req.isNavigationRequest() &&
      req.frame() === page.mainFrame() &&
      new URL(res.url()).pathname.replace(/\/$/, '').endsWith(path)
    )
      mark('document-response');
  };
  const crash = () => mark('page-crashed');
  const close = () => mark('page-closed');
  const route = (frame: Frame) => {
    if (
      frame === page.mainFrame() &&
      frame.url().split(/[?#]/, 1)[0].replace(/\/$/, '').endsWith(path)
    )
      mark('route-committed');
  };
  const click = (message: ConsoleMessage) => {
    const prefix = 'spectator-click-' + tableId + ':';
    if (message.type() !== 'debug' || !message.text().startsWith(prefix)) return;
    const at = Number(message.text().slice(prefix.length));
    if (Number.isSafeInteger(at) && at >= start)
      events.push({ phase: 'trusted-lobby-click', elapsedMs: at - start });
  };
  page.on('response', response);
  page.on('framenavigated', route);
  page.on('console', click);
  page.on('crash', crash);
  page.on('close', close);
  mark(entry === 'document' ? 'start-document-navigation' : 'start-lobby-action');
  return {
    start,
    mark,
    events,
    stop() {
      page.off('response', response);
      page.off('framenavigated', route);
      page.off('console', click);
      page.off('crash', crash);
      page.off('close', close);
    },
  };
}
