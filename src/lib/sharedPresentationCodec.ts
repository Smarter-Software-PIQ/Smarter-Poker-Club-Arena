import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';

// The decoder always allocates a caller-sized output buffer. One extra byte
// detects overlong streams without letting public input select an allocation.
const MAX_BYTES = 1536 * 1024;
export function encodePresentation(value: object): string {
  const plain = strToU8(JSON.stringify(value));
  if (plain.length > MAX_BYTES)
    throw new RangeError('Recorded table exceeds the replay size limit');
  const compressed = deflateSync(plain, { level: 6 });
  let binary = '';
  for (let i = 0; i < compressed.length; i += 8192)
    binary += String.fromCharCode(...compressed.subarray(i, i + 8192));
  return plain.length.toString(36) + '.' + btoa(binary).replace(/=+$/, '');
}
export function decodePresentation(wire: string): Record<string, unknown> | undefined {
  if (wire.length > MAX_BYTES || !/^[0-9a-z]{1,4}\.[A-Za-z0-9+/]+$/.test(wire)) return;
  const [size, body] = wire.split('.');
  const length = parseInt(size, 36);
  if (length <= 0 || length > MAX_BYTES) return;
  try {
    const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
    const plain = inflateSync(bytes, { out: new Uint8Array(length + 1) });
    if (plain.length !== length) return;
    const value = JSON.parse(strFromU8(plain));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    return;
  }
}
