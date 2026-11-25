/** The report is an expandable section of Club Data. Normalize historical mode links. */
export function clubDataReportPath(club: string, source: URLSearchParams, hash = ''): string {
  const query = new URLSearchParams(source);
  query.delete('view');
  query.set('report', 'open');
  return `/clubs/${encodeURIComponent(club)}/data?${query}${hash}`;
}
