// Native kernel metadata only. This is a predicate for the owning release,
// never authority to attach, close a listener, or modify the engine.
import * as inspectorFs from 'node:fs';

// Failure detail is a closed diagnostic, never additional admission authority.
const inspectorKernelReasons = new Set([
  'input_unproved',
  'deadline_exhausted',
  'read_budget_unproved',
  'process_stat_unproved',
  'namespace_unproved',
  'members_bound',
  'socket_metadata_shape',
  'socket_rows_bound',
  'required_process_missing',
  'namespace_mismatch',
  'listener_count',
  'listener_binding',
  'descriptor_census_unproved',
  'descriptor_target_bound',
  'listener_owner',
  'clients_before_grant',
  'owned_client_count',
  'owned_client_binding',
  'process_identity_changed',
  'members_changed',
  'socket_rows_changed',
  'snapshots_changed',
  'expected_binding_changed',
  'metadata_disappeared',
  'metadata_denied',
  'kernel_io_unproved',
]);
const inspectorKernelFailures = new WeakMap();
const inspectorSocketRefusal = (reason = 'input_unproved') => {
  const error = new Error('main_inspector_socket_unproved');
  inspectorKernelFailures.set(
    error,
    inspectorKernelReasons.has(reason) ? reason : 'kernel_io_unproved'
  );
  return error;
};
export function mainInspectorKernelFailureReason(error) {
  return inspectorKernelFailures.get(error) ?? null;
}
function inspectorKernelNativeFailure(error) {
  const code =
    error && typeof error === 'object'
      ? Object.getOwnPropertyDescriptor(error, 'code')?.value
      : undefined;
  return ['ENOENT', 'ESRCH'].includes(code)
    ? 'metadata_disappeared'
    : ['EACCES', 'EPERM'].includes(code)
      ? 'metadata_denied'
      : 'kernel_io_unproved';
}
const inspectorNumericPid = /^[1-9][0-9]{0,9}$/;

function inspectorKernelRead(path, limit, deadlineMs) {
  if (Date.now() >= deadlineMs) throw inspectorSocketRefusal('deadline_exhausted');
  const fd = inspectorFs.openSync(
    path,
    inspectorFs.constants.O_RDONLY | inspectorFs.constants.O_NOFOLLOW
  );
  try {
    const bytes = Buffer.alloc(limit + 1);
    let size = 0;
    for (;;) {
      if (Date.now() >= deadlineMs || size > limit)
        throw inspectorSocketRefusal('read_budget_unproved');
      const n = inspectorFs.readSync(fd, bytes, size, bytes.length - size, null);
      if (!n) return bytes.subarray(0, size);
      size += n;
    }
  } finally {
    inspectorFs.closeSync(fd);
  }
}

function inspectorKernelStart(root, pid, deadlineMs) {
  // comm is opaque bytes and can contain spaces, parentheses and non-UTF8.
  // Decode only the ASCII suffix after its final closing parenthesis.
  const bytes = inspectorKernelRead(`${root}/${pid}/stat`, 4096, deadlineMs);
  const end = bytes.lastIndexOf(0x29);
  const prefix = Buffer.from(`${pid} (`);
  const tail = bytes.subarray(end + 1);
  if (
    end < prefix.length ||
    !bytes.subarray(0, prefix.length).equals(prefix) ||
    [...tail].some((byte) => byte > 0x7f)
  )
    throw inspectorSocketRefusal('process_stat_unproved');
  const fields = tail.toString('ascii').trim().split(/\s+/);
  if (fields.length < 20 || !/^[A-Za-z]$/.test(fields[0]) || !/^[0-9]{1,20}$/.test(fields[19]))
    throw inspectorSocketRefusal('process_stat_unproved');
  return fields[19];
}

function inspectorKernelNamespace(root, pid, deadlineMs) {
  if (Date.now() >= deadlineMs) throw inspectorSocketRefusal('deadline_exhausted');
  const value = inspectorFs.readlinkSync(`${root}/${pid}/ns/net`);
  if (!/^net:\[[1-9][0-9]{0,19}\]$/.test(value)) throw inspectorSocketRefusal('namespace_unproved');
  return value;
}

function inspectorKernelMembers(root, deadlineMs) {
  if (Date.now() >= deadlineMs) throw inspectorSocketRefusal('deadline_exhausted');
  const entries = inspectorFs.readdirSync(root).filter((value) => inspectorNumericPid.test(value));
  if (!entries.length || entries.length > 256) throw inspectorSocketRefusal('members_bound');
  return entries.sort((a, b) => Number(a) - Number(b));
}

function inspectorKernelSockets(root, pid, port, deadlineMs) {
  const rows = [];
  for (const family of ['tcp', 'tcp6']) {
    const bytes = inspectorKernelRead(`${root}/${pid}/net/${family}`, 131072, deadlineMs);
    if ([...bytes].some((byte) => byte > 0x7f))
      throw inspectorSocketRefusal('socket_metadata_shape');
    const lines = bytes.toString('ascii').trim().split('\n');
    if (!lines[0]?.includes('inode')) throw inspectorSocketRefusal('socket_metadata_shape');
    const width = family === 'tcp' ? 8 : 32;
    const endpointPattern = new RegExp(`^[0-9A-Fa-f]{${width}}:[0-9A-Fa-f]{4}$`);
    for (const line of lines.slice(1)) {
      if (Date.now() >= deadlineMs) throw inspectorSocketRefusal('deadline_exhausted');
      const fields = line.trim().split(/\s+/);
      if (
        fields.length < 10 ||
        !endpointPattern.test(fields[1]) ||
        !endpointPattern.test(fields[2]) ||
        !/^[0-9A-Fa-f]{2}$/.test(fields[3]) ||
        !/^[0-9]{1,20}$/.test(fields[9])
      )
        throw inspectorSocketRefusal('socket_metadata_shape');
      const local = fields[1].toUpperCase(),
        remote = fields[2].toUpperCase();
      if (parseInt(local.slice(-4), 16) !== port && parseInt(remote.slice(-4), 16) !== port)
        continue;
      const state = fields[3].toUpperCase();
      // A completed HTTP discovery can leave ownerless TIME_WAIT. It cannot
      // accept debugger commands and is never treated as a live client.
      if (state === '06' && fields[9] === '0') continue;
      rows.push({ family, local, remote, state, inode: fields[9] });
      if (rows.length > 8) throw inspectorSocketRefusal('socket_rows_bound');
    }
  }
  return rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function inspectorKernelSnapshot({ root, pid, port, deadlineMs, allowOwnClient, budget }) {
  const members = inspectorKernelMembers(root, deadlineMs);
  if (!members.includes(String(pid)) || !members.includes(String(process.pid)))
    throw inspectorSocketRefusal('required_process_missing');
  const identities = members.map((member) => ({
    pid: member,
    startTicks: inspectorKernelStart(root, member, deadlineMs),
    namespace: inspectorKernelNamespace(root, member, deadlineMs),
  }));
  const main = identities.find((value) => value.pid === String(pid));
  // A complete, single-network-namespace census is required. An unknown or
  // hidden member is not an empty descriptor set.
  if (identities.some((value) => value.namespace !== main.namespace))
    throw inspectorSocketRefusal('namespace_mismatch');
  const rows = inspectorKernelSockets(root, pid, port, deadlineMs);
  const listeners = rows.filter((row) => row.state === '0A');
  if (listeners.length !== 1) throw inspectorSocketRefusal('listener_count');
  const listener = listeners[0];
  const loopback = listener.family === 'tcp' ? '0100007F' : '00000000000000000000000001000000';
  const zero = '0'.repeat(loopback.length) + ':0000';
  if (
    listener.local !== `${loopback}:${(0x10000 + port).toString(16).slice(1).toUpperCase()}` ||
    listener.remote !== zero ||
    listener.inode === '0'
  )
    throw inspectorSocketRefusal('listener_binding');
  const owners = new Map(rows.map((row) => [row.inode, new Set()]));
  for (const member of members) {
    if (Date.now() >= deadlineMs) throw inspectorSocketRefusal('deadline_exhausted');
    // Keep the directory handle open during the census. Enumerating our own
    // /proc/<pid>/fd with readdirSync would list its already-closed transient
    // directory descriptor and incorrectly turn every own-client proof unknown.
    const directory = inspectorFs.opendirSync(`${root}/${member}/fd`);
    try {
      for (let entry; (entry = directory.readSync()) !== null; ) {
        const fd = entry.name;
        if (Date.now() >= deadlineMs || ++budget.fds > 16384 || !/^[0-9]{1,10}$/.test(fd))
          throw inspectorSocketRefusal('descriptor_census_unproved');
        const value = inspectorFs.readlinkSync(`${root}/${member}/fd/${fd}`);
        if (value.length > 4096) throw inspectorSocketRefusal('descriptor_target_bound');
        const socket = /^socket:\[([0-9]{1,20})\]$/.exec(value);
        if (socket && owners.has(socket[1])) owners.get(socket[1]).add(member);
      }
    } finally {
      directory.closeSync();
    }
  }
  const solely = (inode, owner) => {
    const values = owners.get(inode);
    return values?.size === 1 && values.has(String(owner));
  };
  if (!solely(listener.inode, pid)) throw inspectorSocketRefusal('listener_owner');
  const clients = rows.filter((row) => row !== listener);
  if (!allowOwnClient) {
    if (clients.length) throw inspectorSocketRefusal('clients_before_grant');
  } else {
    if (clients.length !== 2) throw inspectorSocketRefusal('owned_client_count');
    const server = clients.find(
      (row) => row.family === listener.family && row.local === listener.local
    );
    const client = clients.find((row) => row !== server);
    if (
      !server ||
      !client ||
      server.state !== '01' ||
      client.state !== '01' ||
      server.family !== client.family ||
      server.remote !== client.local ||
      server.local !== client.remote ||
      !server.remote.startsWith(`${loopback}:`) ||
      server.inode === client.inode ||
      !solely(server.inode, pid) ||
      !solely(client.inode, process.pid)
    )
      throw inspectorSocketRefusal('owned_client_binding');
  }
  for (const identity of identities) {
    if (
      inspectorKernelStart(root, identity.pid, deadlineMs) !== identity.startTicks ||
      inspectorKernelNamespace(root, identity.pid, deadlineMs) !== identity.namespace
    )
      throw inspectorSocketRefusal('process_identity_changed');
  }
  if (JSON.stringify(inspectorKernelMembers(root, deadlineMs)) !== JSON.stringify(members))
    throw inspectorSocketRefusal('members_changed');
  if (JSON.stringify(inspectorKernelSockets(root, pid, port, deadlineMs)) !== JSON.stringify(rows))
    throw inspectorSocketRefusal('socket_rows_changed');
  return {
    identities,
    rows,
    binding: {
      schema: 'main-inspector-socket-binding/v1',
      pid,
      startTicks: main.startTicks,
      namespace: main.namespace,
      listener: { family: listener.family, local: listener.local, inode: listener.inode },
    },
  };
}

export function captureMainInspectorBinding({
  pid = 1,
  port = 9229,
  deadlineMs,
  allowOwnClient = false,
  expectedBinding = null,
  procRoot = '/proc',
} = {}) {
  if (
    !Number.isSafeInteger(pid) ||
    pid < 1 ||
    pid === process.pid ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs <= Date.now() ||
    typeof allowOwnClient !== 'boolean' ||
    typeof procRoot !== 'string' ||
    !procRoot.startsWith('/')
  )
    throw inspectorSocketRefusal();
  try {
    const options = { root: procRoot, pid, port, deadlineMs, allowOwnClient, budget: { fds: 0 } };
    const before = inspectorKernelSnapshot(options);
    const after = inspectorKernelSnapshot(options);
    if (Date.now() >= deadlineMs) throw inspectorSocketRefusal('deadline_exhausted');
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw inspectorSocketRefusal('snapshots_changed');
    if (
      expectedBinding !== null &&
      JSON.stringify(before.binding) !== JSON.stringify(expectedBinding)
    )
      throw inspectorSocketRefusal('expected_binding_changed');
    return Object.freeze({ ...before.binding, listener: Object.freeze(before.binding.listener) });
  } catch (error) {
    // Do not export paths, descriptor contents, process names or native errors.
    throw inspectorSocketRefusal(
      mainInspectorKernelFailureReason(error) ?? inspectorKernelNativeFailure(error)
    );
  }
}
