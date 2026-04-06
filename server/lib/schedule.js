import { DateTime } from 'luxon'

/**
 * Ventana horaria para un dayKey concreto (misma semántica que antes).
 */
export function windowFromSpec(dayKey, w, tz) {
  if (!w) {
    return {
      startDt: null,
      endExclusive: null,
      label: null,
      reason: 'no_window_config'
    }
  }

  const base = DateTime.fromISO(dayKey, { zone: tz })
  const [sh, sm] = w.start.split(':').map(Number)
  const [eh, em] = w.end.split(':').map(Number)
  const startDt = base.set({ hour: sh, minute: sm, second: 0, millisecond: 0 })
  let endExclusive = base.set({ hour: eh, minute: em, second: 0, millisecond: 0 })
  if (eh === 23 && em === 59) {
    endExclusive = base.plus({ days: 1 }).startOf('day')
  }
  if (endExclusive <= startDt) {
    endExclusive = endExclusive.plus({ days: 1 })
  }
  return {
    startDt,
    endExclusive,
    label: `${w.start}-${w.end}`,
    reason: null
  }
}

/**
 * Resuelve día de campaña cuando hay fechas explícitas (huecos sin activación).
 */
export function resolveScheduleDay(nowUtc, entries, tz) {
  const now = DateTime.fromJSDate(nowUtc, { zone: 'utc' }).setZone(tz)
  const today = now.startOf('day')
  const dayKey = today.toISODate()
  const first = DateTime.fromISO(entries[0].dayKey, { zone: tz }).startOf('day')
  const last = DateTime.fromISO(entries[entries.length - 1].dayKey, {
    zone: tz
  }).startOf('day')

  if (today < first) {
    return {
      ok: false,
      reason: 'before_campaign',
      dayIndex: null,
      dayKey: null,
      now: null
    }
  }
  if (today > last) {
    return {
      ok: false,
      reason: 'after_campaign',
      dayIndex: null,
      dayKey: null,
      now: null
    }
  }

  const idx = entries.findIndex(e => e.dayKey === dayKey)
  if (idx === -1) {
    return {
      ok: false,
      reason: 'not_activation_day',
      dayIndex: null,
      dayKey: null,
      now: null
    }
  }

  const entry = entries[idx]
  const dayIndex = idx + 1
  const { startDt, endExclusive, label, reason } = windowFromSpec(dayKey, entry.window, tz)
  if (reason) {
    return {
      ok: true,
      dayIndex,
      dayKey,
      now,
      toteEligible: entry.toteEligible,
      win: {
        active: false,
        reason,
        label: null,
        startDt: null,
        endExclusive: null
      }
    }
  }
  const activeNow = now >= startDt && now < endExclusive
  return {
    ok: true,
    dayIndex,
    dayKey,
    now,
    toteEligible: entry.toteEligible,
    win: {
      active: activeNow,
      reason: activeNow ? null : 'outside_window',
      label,
      startDt,
      endExclusive
    }
  }
}

/**
 * dayIndex 1-based respecto al primer día de campaña (CAMPAIGN_START en TZ).
 */
export function campaignDayIndex(nowUtc, campaignStartStr, tz, daysTotal) {
  const now = DateTime.fromJSDate(nowUtc, { zone: 'utc' }).setZone(tz)
  const start = DateTime.fromISO(campaignStartStr, { zone: tz }).startOf('day')
  if (!start.isValid) return { ok: false, reason: 'invalid_campaign_start' }

  const today = now.startOf('day')
  if (today < start) {
    return { ok: false, reason: 'before_campaign', dayIndex: null, dayKey: null }
  }
  const diffDays = Math.floor(today.diff(start, 'days').days)
  if (diffDays >= daysTotal) {
    return { ok: false, reason: 'after_campaign', dayIndex: null, dayKey: null }
  }
  const dayIndex = diffDays + 1
  const dayKey = today.toISODate()
  return { ok: true, dayIndex, dayKey, now }
}

/**
 * Ventana del día dayIndex (1-based) usando dailyWindows[dayIndex - 1].
 */
export function windowForDay(dayIndex, dailyWindows, tz, dayKey) {
  const w = dailyWindows[dayIndex - 1]
  if (!w) {
    return {
      startDt: null,
      endExclusive: null,
      label: null,
      reason: 'no_window_config'
    }
  }
  return windowFromSpec(dayKey, w, tz)
}

export function isWithinWindow(nowInTz, dayIndex, dailyWindows, tz, dayKey) {
  const { startDt, endExclusive, label, reason } = windowForDay(dayIndex, dailyWindows, tz, dayKey)
  if (reason) {
    return {
      active: false,
      reason,
      label: null,
      startDt: null,
      endExclusive: null
    }
  }
  const activeNow = nowInTz >= startDt && nowInTz < endExclusive
  return {
    active: activeNow,
    reason: activeNow ? null : 'outside_window',
    label,
    startDt,
    endExclusive
  }
}
