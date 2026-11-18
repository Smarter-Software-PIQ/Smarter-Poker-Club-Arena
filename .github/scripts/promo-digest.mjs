/** Format the original funding-owner aggregates without guessing today's hierarchy. */
export function promoDigestLines(report) {
  if (
    !report ||
    typeof report.day !== 'string' ||
    !Array.isArray(report.funding_owners) ||
    !Array.isArray(report.clubs) ||
    !Array.isArray(report.club_flags)
  )
    throw Error('Promo digest returned an invalid report');
  const amount = (value) => {
    if (
      value === null ||
      value === '' ||
      !['number', 'string'].includes(typeof value) ||
      !Number.isFinite(Number(value)) ||
      Number(value) < 0
    )
      throw Error('Promo digest returned an invalid count');
    return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
  };
  const result = [
    `${report.day} (Chicago). Locked figures are current; other figures cover that day.`,
  ];
  for (const row of report.clubs) {
    if (typeof row.club_id !== 'string') throw Error('Promo digest has no club identity');
    result.push(
      `Club ${row.club_id} Total: ${amount(row.given)} given; ${amount(row.locked_now)} locked; ${amount(row.unlocked)} unlocked; ${amount(row.expired)} expired; ${amount(row.flagged)} flagged cases.`
    );
  }
  for (const row of report.funding_owners) {
    if (typeof row.club_id !== 'string') throw Error('Promo digest has no club identity');
    const ownerIdentity =
      row.funded_from_type && row.funded_from_id
        ? `${row.funded_from_type}:${row.funded_from_id}`
        : 'original funding owner unavailable';
    const owner =
      typeof row.funding_label === 'string' && row.funding_label.trim()
        ? `${row.funding_label} (${ownerIdentity})`
        : ownerIdentity;
    result.push(
      `Club ${row.club_id}, ${owner}: ${amount(row.given)} given; ${amount(row.locked_now)} locked; ${amount(row.unlocked)} unlocked; ${amount(row.expired)} expired; ${amount(row.flagged)} source-linked flags.`
    );
  }
  for (const row of report.club_flags) {
    if (typeof row.club_id !== 'string') throw Error('Promo flag has no source club identity');
    result.push(
      `Club ${row.club_id}: ${amount(row.flagged)} distinct flagged cases. Cases without an exact source-grant link are included here.`
    );
  }
  if (report.funding_owners.length === 0 && report.club_flags.length === 0)
    result.push('No promo grants or flagged cases.');
  return result;
}
