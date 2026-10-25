// Native backups retain RFC3339 and legacy space-separated UTC timestamps.
// Match the server's accepted forms explicitly: browser Date parsing treats
// legacy timestamps as local time and rejects some forms accepted by Go.
export function parseStoredTimestamp(value: string): Date {
  const parts = value.match(
    /^(?<day>\d{4}-\d{2}-\d{2})(?<separator>T| +)(?<hour>\d{1,2}):(?<minute>\d{2}):(?<second>\d{2})(?:[.,](?<fraction>\d+))?(?<zone>Z|[+-]\d{2}:\d{2})?$/,
  )?.groups;
  if (!parts || (parts.separator === "T") !== Boolean(parts.zone)) return new Date(NaN);
  const normalized = `${parts.day}T${parts.hour?.padStart(2, "0")}:${parts.minute}:${parts.second}.${(parts.fraction ?? "").padEnd(3, "0").slice(0, 3)}Z`;
  const instant = new Date(normalized);
  // This also rejects calendar/clock overflow rather than silently rolling it
  // into another date. Year 0000 is preserved by the explicit ISO string.
  if (Number.isNaN(instant.getTime()) || instant.toISOString() !== normalized) return new Date(NaN);
  let offset = 0;
  if (parts.zone && parts.zone !== "Z") {
    const hours = Number(parts.zone.slice(1, 3));
    const minutes = Number(parts.zone.slice(4, 6));
    // Go's parser accepts 24:60 as a 25-hour offset in existing backups.
    if (hours > 24 || minutes > 60) return new Date(NaN);
    offset = (hours * 60 + minutes) * 60000 * (parts.zone[0] === "+" ? 1 : -1);
  }
  return new Date(instant.getTime() - offset);
}
