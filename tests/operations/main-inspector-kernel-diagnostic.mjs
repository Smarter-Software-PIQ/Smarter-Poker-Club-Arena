// Isolated native fixture only. Never imported by a production retirement entry.
const fixtureScenarios = new Set([
  'direct-success',
  'direct-deferred-close-timeout',
  'host-success',
  'host-deferred-close-timeout',
]);
const clientRefusal = "if (clients.length) throw inspectorSocketRefusal('clients_before_grant');";
const tcpDiagnosticPattern =
  /^tcp-state-(established|syn_sent|syn_recv|fin_wait_1|fin_wait_2|time_wait|close|close_wait|last_ack|listen|closing|new_syn_recv|unknown)-discovery-(yes|no|unknown)$/;
const refusalFactory = "const inspectorSocketRefusal = (reason = 'input_unproved') => {";
function reasonCodes(source) {
  const match = source.match(/const inspectorKernelReasons = new Set\(\[([\s\S]*?)\]\);/);
  if (!match) throw new Error('The isolated kernel diagnostic source shape changed');
  const codes = [...match[1].matchAll(/'([a-z_]{1,40})'/g)].map((value) => value[1]);
  if (
    !codes.length ||
    codes.length > 64 ||
    new Set(codes).size !== codes.length ||
    match[1].replace(/'[a-z_]{1,40}'|[\s,]/g, '') !== ''
  )
    throw new Error('The isolated kernel diagnostic source shape changed');
  return new Set(codes);
}
export function observeFixtureKernelRefusals(source, scenario) {
  if (!fixtureScenarios.has(scenario))
    throw new Error('Unknown isolated kernel diagnostic scenario');
  reasonCodes(source);
  if (
    source.split(refusalFactory).length !== 2 ||
    source.split(clientRefusal).length !== 2 ||
    !source.includes('export function mainInspectorKernelFailureReason(error) {')
  )
    throw new Error('The isolated kernel diagnostic source shape changed');
  // Observe the maintained closed refusal factory, without rewriting any
  // predicate, thrown error, ownership check or native exception handling.
  return (
    `function fixtureDiscoveryRows(rows) {
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
  }\n` +
    source
      .replace(
        refusalFactory,
        refusalFactory +
          `
  fixtureKernelDiagnostic('reason-' + (inspectorKernelReasons.has(reason) ? reason : 'kernel_io_unproved'));`
      )
      .replace(
        clientRefusal,
        "if (clients.length) { fixtureDiscoveryRows(clients); throw inspectorSocketRefusal('clients_before_grant'); }"
      )
  );
}
export function readFixtureKernelRefusals(source, stderr, scenario) {
  if (!fixtureScenarios.has(scenario))
    throw new Error('Unknown isolated kernel diagnostic scenario');
  const codes = reasonCodes(source);
  const prefix = 'fixture-kernel-diagnostic:' + scenario + ':';
  return stderr
    .split('\n')
    .filter((line) => {
      if (!line.startsWith(prefix)) return false;
      const tag = line.slice(prefix.length);
      return (
        (tag.startsWith('reason-') && codes.has(tag.slice(7))) || tcpDiagnosticPattern.test(tag)
      );
    })
    .slice(0, 12)
    .join(';');
}

// Observe only the actual initial discovery socket. Preserve response parsing,
// close resolution, deadlines and every maintained call byte around it.
export function observeFixtureDiscoverySocket(source) {
  const needle = "request.on('socket', (socket) =>\n      socket.once('close', () => {";
  if (source.split(needle).length !== 2)
    throw new Error('The isolated discovery source shape changed');
  return source.replace(
    needle,
    `request.on('socket', (socket) =>
      (socket.once('connect', () => {
        try {
          if (socket.localAddress === '127.0.0.1' && socket.remoteAddress === '127.0.0.1' &&
              Number.isInteger(socket.localPort) && socket.localPort > 0 && socket.localPort <= 65535 && socket.remotePort === 9229) {
            const endpoint = port => '0100007F:' + (0x10000 + port).toString(16).slice(1).toUpperCase();
            globalThis[Symbol.for('fixture.main-inspector.discovery-tuple')] = Object.freeze({local:endpoint(socket.localPort),remote:endpoint(socket.remotePort)});
          }
        } catch { /* Observation never changes discovery. */ }
      }), socket).once('close', () => {`
  );
}
