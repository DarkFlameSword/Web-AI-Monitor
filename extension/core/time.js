const pad = n => String(n).padStart(2, '0');

export function splitDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

/** Live countdown: "2:13:45", or "3天 04:12:09" once a day or more is left. */
export function formatCountdown(ms, t) {
  const { d, h, m, s } = splitDuration(ms);
  if (d > 0) return `${d}${t('unit.day')} ${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${h}:${pad(m)}:${pad(s)}`;
}

/** Narrow countdown for the page HUD: "2:13:45", or "3天4时" once a day or more is left. */
export function formatCountdownShort(ms, t) {
  const { d, h, m, s } = splitDuration(ms);
  if (d > 0) return `${d}${t('unit.day')}${h}${t('unit.hour')}`;
  return `${h}:${pad(m)}:${pad(s)}`;
}

/** At most four characters for the toolbar badge: "45m", "2h", "3d". */
export function formatBadgeDuration(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Wall-clock time of a reset, with the date when it is not today. */
export function formatClock(ms, tag, now = Date.now()) {
  const date = new Date(ms);
  const today = new Date(now);
  const sameDay = date.toDateString() === today.toDateString();
  const options = sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat(tag, options).format(date);
}

/** "Updated 20s ago", in ten-second steps so the line does not flicker. */
export function formatAgo(ms, t) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 10) return t('updated.justNow');
  if (seconds < 60) return t('updated.seconds', { n: Math.floor(seconds / 10) * 10 });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('updated.minutes', { n: minutes });
  return t('updated.hours', { n: Math.floor(minutes / 60) });
}
