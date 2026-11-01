// Isolated native fixture only. Never imported by a production retirement entry.
export function observeFixtureKernelRefusals(source, scenario) {
  if (!['direct-success', 'direct-deferred-close-timeout', 'host-success', 'host-deferred-close-timeout'].includes(scenario))
    throw new Error('Unknown isolated kernel diagnostic scenario');
  let predicate = 0;
  const observed = source.replaceAll('throw inspectorSocketRefusal();', () =>
    `{ fixtureKernelDiagnostic('predicate-${++predicate}'); throw inspectorSocketRefusal(); }`
  ).replace('throw refusal;', () =>
    `{ fixtureKernelDiagnostic('predicate-${++predicate}'); throw refusal; }`
  ).replace('} catch {', `} catch (fixtureKernelError) {
    fixtureKernelDiagnostic(['ENOENT', 'EACCES', 'EPERM', 'EBADF', 'EIO', 'EINTR'].includes(fixtureKernelError?.code)
      ? 'syscall-' + fixtureKernelError.code : 'syscall-unknown');`);
  if (predicate !== 29 || observed === source || !source.includes('} catch {'))
    throw new Error('The isolated kernel diagnostic source shape changed');
  return `function fixtureKernelDiagnostic(tag) {
    try { inspectorFs.writeSync(2, 'fixture-kernel-diagnostic:${scenario}:' + tag + '\\n'); }
    catch { /* Observation never changes the maintained refusal. */ }
  }\n` + observed;
}
