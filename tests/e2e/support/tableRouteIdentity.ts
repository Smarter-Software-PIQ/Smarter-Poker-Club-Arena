/** tableQuery adds these display hints when a parked table becomes active. */
export function tableRouteIdentity(raw: string): string {
  const url = new URL(raw);
  for (const key of ['name', 'stakes', 'code']) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
