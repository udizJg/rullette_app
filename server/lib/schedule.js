import { DateTime } from 'luxon';

/**
 * dayIndex 1-based respecto al primer día de campaña (CAMPAIGN_START en TZ).
 */
export function campaignDayIndex(nowUtc, campaignStartStr, tz, daysTotal) {
  const now = DateTime.fromJSDate(nowUtc, { zone: 'utc' }).setZone(tz);
  const start = DateTime.fromISO(campaignStartStr, { zone: tz }).startOf('day');
  if (!start.isValid) return { ok: false, reason: 'invalid_campaign_start' };

  const today = now.startOf('day');
  if (today < start) {
    return { ok: false, reason: 'before_campaign', dayIndex: null, dayKey: null };
  }
  const diffDays = Math.floor(today.diff(start, 'days').days);
  if (diffDays >= daysTotal) {
    return { ok: false, reason: 'after_campaign', dayIndex: null, dayKey: null };
  }
  const dayIndex = diffDays + 1;
  const dayKey = today.toISODate();
  return { ok: true, dayIndex, dayKey, now };
}

/**
 * Ventana del día dayIndex (1-based) usando dailyWindows[dayIndex - 1].
 */
export function windowForDay(dayIndex, dailyWindows, tz, dayKey) {
  const w = dailyWindows[dayIndex - 1];
  if (!w) {
    return {
      startDt: null,
      endDt: null,
      label: null,
      reason: 'no_window_config',
    };
  }

  const base = DateTime.fromISO(dayKey, { zone: tz });
  const [sh, sm] = w.start.split(':').map(Number);
  const [eh, em] = w.end.split(':').map(Number);
  const startDt = base.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
  // Fin exclusivo: [inicio, fin). 23:59 se interpreta como “hasta medianoche” del mismo día calendario.
  let endExclusive = base.set({ hour: eh, minute: em, second: 0, millisecond: 0 });
  if (eh === 23 && em === 59) {
    endExclusive = base.plus({ days: 1 }).startOf('day');
  }
  if (endExclusive <= startDt) {
    endExclusive = endExclusive.plus({ days: 1 });
  }
  return {
    startDt,
    endExclusive,
    label: `${w.start}-${w.end}`,
    reason: null,
  };
}

export function isWithinWindow(nowInTz, dayIndex, dailyWindows, tz, dayKey) {
  const { startDt, endExclusive, label, reason } = windowForDay(
    dayIndex,
    dailyWindows,
    tz,
    dayKey,
  );
  if (reason) {
    return {
      active: false,
      reason,
      label: null,
      startDt: null,
      endExclusive: null,
    };
  }
  const activeNow = nowInTz >= startDt && nowInTz < endExclusive;
  return {
    active: activeNow,
    reason: activeNow ? null : 'outside_window',
    label,
    startDt,
    endExclusive,
  };
}
