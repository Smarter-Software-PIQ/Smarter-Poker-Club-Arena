// Isolated native fixture only. Never imported by a production retirement entry.
export function observeFixtureKernelRefusals(source, scenario) {
  if (!['direct-success', 'direct-deferred-close-timeout', 'host-success', 'host-deferred-close-timeout'].includes(scenario))
    throw new Error('Unknown isolated kernel diagnostic scenario');
  let predicate = 0;
  const observed = source.replaceAll('throw inspectorSocketRefusal();', () => {
    const current = ++predicate;
    return `{ ${current === 22 ? 'fixtureDiscoveryRows(clients);' : ''} fixtureKernelDiagnostic('predicate-${current}'); throw inspectorSocketRefusal(); }`;
  }).replace('throw refusal;', () =>
    `{ fixtureKernelDiagnostic('predicate-${++predicate}'); throw refusal; }`
  ).replace('} catch {', `} catch (fixtureKernelError) {
    fixtureKernelDiagnostic(['ENOENT', 'EACCES', 'EPERM', 'EBADF', 'EIO', 'EINTR'].includes(fixtureKernelError?.code)
      ? 'syscall-' + fixtureKernelError.code : 'syscall-unknown');`);
  if (predicate !== 29 || observed === source || !source.includes('} catch {'))
    throw new Error('The isolated kernel diagnostic source shape changed');
  return `function fixtureDiscoveryRows(rows) {
    try {
      const tuple = globalThis[Symbol.for('fixture.main-inspector.discovery-tuple')];
      const states = {'01':'established','02':'syn_sent','03':'syn_recv','04':'fin_wait_1','05':'fin_wait_2','06':'time_wait','07':'close','08':'close_wait','09':'last_ack','0A':'listen','0B':'closing','0C':'new_syn_recv'};
      for (const row of rows.slice(0, 8)) {
        const matches = !tuple ? 'unknown' : row.family === 'tcp' &&
          ((row.local === tuple.local && row.remote === tuple.remote) ||
           (row.local === tuple.remote && row.remote === tuple.local)) ? 'yes' : 'no';
        fixtureKernelDiagnostic('tcp-state-' + (states[row.state] || 'unknown') + '-discovery-' + matches);
      }
    } catch { /* Diagnostic failure never changes the maintained refusal. */ }
  }
  function fixtureKernelDiagnostic(tag) {
    try { inspectorFs.writeSync(2, 'fixture-kernel-diagnostic:${scenario}:' + tag + '\\n'); }
    catch { /* Observation never changes the maintained refusal. */ }
  }\n` + observed;
}

// Observe only the actual initial discovery socket. Preserve response parsing,
// peer/local close resolution, deadlines and every maintained call byte around it.
export function observeFixtureDiscoverySocket(source) {
  const needle = "socket.once('connect', () => {";
  if (source.split(needle).length !== 2)
    throw new Error('The isolated discovery source shape changed');
  return source.replace(
    needle,
    `socket.once('connect', () => {
        try {
          if (socket.localAddress === '127.0.0.1' && socket.remoteAddress === '127.0.0.1' &&
              Number.isInteger(socket.localPort) && socket.localPort > 0 && socket.localPort <= 65535 && socket.remotePort === 9229) {
            const endpoint = port => '0100007F:' + (0x10000 + port).toString(16).slice(1).toUpperCase();
            globalThis[Symbol.for('fixture.main-inspector.discovery-tuple')] = Object.freeze({local:endpoint(socket.localPort),remote:endpoint(socket.remotePort)});
          }
        } catch { /* Observation never changes discovery. */ }`
  );
}
