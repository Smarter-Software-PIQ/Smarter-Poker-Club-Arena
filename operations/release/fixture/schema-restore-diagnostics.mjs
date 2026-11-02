// Only bounded PG17 psql SQLSTATE-only stderr may cross the restore boundary.
// The wrapper retains no child output, SQL, file path, cause or original error.
const owned = new WeakMap();
const MAX_STDERR_BYTES = 1024 * 1024;
const MAX_SCHEMA_LINE = 128 * 1024 * 1024;
const location =
  /^psql:\/run\/club-arena-qualification\/private\/schema\/schema\.sql:([1-9][0-9]{0,8}): (ERROR|NOTICE|WARNING|INFO|LOG|DEBUG):  ([0-9A-Z]{5})$/;
function diagnostic(error) {
  if (!(error instanceof Error)) return null;
  const stderr = Object.getOwnPropertyDescriptor(error, 'stderr');
  const code = Object.getOwnPropertyDescriptor(error, 'code');
  if (
    !stderr ||
    !Object.hasOwn(stderr, 'value') ||
    typeof stderr.value !== 'string' ||
    !code ||
    !Object.hasOwn(code, 'value') ||
    !Number.isInteger(code.value) ||
    code.value < 1 ||
    code.value > 255 ||
    stderr.value.length === 0 ||
    Buffer.byteLength(stderr.value) > MAX_STDERR_BYTES ||
    !stderr.value.endsWith('\n')
  )
    return null;
  const lines = stderr.value.slice(0, -1).split('\n');
  if (lines.length > 512) return null;
  let result = null;
  for (let i = 0; i < lines.length; i++) {
    const match = location.exec(lines[i]);
    if (!match) return null;
    const line = Number(match[1]);
    if (!Number.isSafeInteger(line) || line < 1 || line > MAX_SCHEMA_LINE) return null;
    if (match[2] === 'ERROR') {
      if (result || i !== lines.length - 1 || match[3] === '00000') return null;
      result = { sqlstate: match[3], line, exit_code: code.value };
    }
  }
  return result && Object.freeze(result);
}
export function schemaRestoreFailure(error) {
  const wrapped = new Error('FIXTURE_APPLICATION_SCHEMA_RESTORE_FAILED');
  wrapped.name = 'SchemaRestoreError';
  let detail = null;
  try {
    detail = diagnostic(error);
  } catch {
    /* Untrusted descriptors fail closed. */
  }
  if (detail) owned.set(wrapped, detail);
  return wrapped;
}
export function schemaRestoreFailureDiagnostic(error) {
  return owned.get(error) ?? null;
}
