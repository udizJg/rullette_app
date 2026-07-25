import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __configDir = path.dirname(fileURLToPath(import.meta.url))
const __repoRoot = path.join(__configDir, '..', '..')

dotenv.config({ path: path.join(__repoRoot, '.env') })
if ((process.env.NODE_ENV || '').toLowerCase() === 'development') {
  const devFile = path.join(__repoRoot, '.env.development')
  if (fs.existsSync(devFile)) {
    dotenv.config({ path: devFile, override: true })
  }
}

const PRIZE_KEYS = ['pelota_corazon', 'tote', 'llavero', 'botella', 'stickers', 'morral', 'lonchera']

function envInt(name, fallback) {
  const v = process.env[name]
  if (v === undefined || v === '') return fallback
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const WIN_RE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Fechas dispersas: cada segmento es fecha,ventana,tote
 * (separador de días: |). tote 1 = hay cupo tote ese día (PRIZE_TOTE).
 */
export function parseCampaignSchedule(raw) {
  const segments = raw
    .split('|')
    .map(s => s.trim())
    .filter(Boolean)
  if (segments.length === 0) {
    throw new Error('CAMPAIGN_SCHEDULE vacío')
  }
  const entries = segments.map((seg, i) => {
    const parts = seg.split(',').map(p => p.trim())
    if (parts.length !== 3) {
      throw new Error(`CAMPAIGN_SCHEDULE segmento ${i + 1}: usar fecha,HH:mm-HH:mm,0|1`)
    }
    const [dayKey, winStr, toteStr] = parts
    if (!DATE_RE.test(dayKey)) {
      throw new Error(`CAMPAIGN_SCHEDULE fecha inválida: "${dayKey}"`)
    }
    const wm = winStr.match(WIN_RE)
    if (!wm) {
      throw new Error(`CAMPAIGN_SCHEDULE ventana inválida: "${winStr}"`)
    }
    if (toteStr !== '0' && toteStr !== '1') {
      throw new Error(`CAMPAIGN_SCHEDULE tote debe ser 0 o 1 (segmento ${i + 1})`)
    }
    const toteEligible = toteStr === '1'
    return {
      dayKey,
      window: {
        start: `${wm[1]}:${wm[2]}`,
        end: `${wm[3]}:${wm[4]}`
      },
      toteEligible
    }
  })
  entries.sort((a, b) => a.dayKey.localeCompare(b.dayKey))
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].dayKey === entries[i - 1].dayKey) {
      throw new Error(`CAMPAIGN_SCHEDULE fecha duplicada: ${entries[i].dayKey}`)
    }
  }
  return entries
}

/**
 * Activaciones Chicureo: solo fecha y ventana (sin flag tote).
 * Formato: YYYY-MM-DD,HH:mm-HH:mm|... (separador de días: |).
 */
export function parseChicureoSchedule(raw) {
  const segments = raw
    .split('|')
    .map(s => s.trim())
    .filter(Boolean)
  if (segments.length === 0) {
    throw new Error('CHICUREO_SCHEDULE vacío')
  }
  const entries = segments.map((seg, i) => {
    const parts = seg.split(',').map(p => p.trim())
    if (parts.length !== 2) {
      throw new Error(`CHICUREO_SCHEDULE segmento ${i + 1}: usar fecha,HH:mm-HH:mm`)
    }
    const [dayKey, winStr] = parts
    if (!DATE_RE.test(dayKey)) {
      throw new Error(`CHICUREO_SCHEDULE fecha inválida: "${dayKey}"`)
    }
    const wm = winStr.match(WIN_RE)
    if (!wm) {
      throw new Error(`CHICUREO_SCHEDULE ventana inválida: "${winStr}"`)
    }
    return {
      dayKey,
      window: {
        start: `${wm[1]}:${wm[2]}`,
        end: `${wm[3]}:${wm[4]}`
      },
      toteEligible: false
    }
  })
  entries.sort((a, b) => a.dayKey.localeCompare(b.dayKey))
  for (let i = 1; i < entries.length; i += 1) {
    if (entries[i].dayKey === entries[i - 1].dayKey) {
      throw new Error(`CHICUREO_SCHEDULE fecha duplicada: ${entries[i].dayKey}`)
    }
  }
  return entries
}

export function parseDailyWindows(raw, expectedCount) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('DAILY_WINDOWS no definido o inválido')
  }
  const parts = raw
    .split('|')
    .map(s => s.trim())
    .filter(Boolean)
  if (parts.length !== expectedCount) {
    throw new Error(`DAILY_WINDOWS debe tener ${expectedCount} segmentos (tiene ${parts.length})`)
  }
  const timeRe = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/
  return parts.map((p, i) => {
    const m = p.match(timeRe)
    if (!m) {
      throw new Error(`DAILY_WINDOWS segmento ${i + 1} inválido: "${p}"`)
    }
    return { start: `${m[1]}:${m[2]}`, end: `${m[3]}:${m[4]}` }
  })
}

export function loadConfig() {
  const nodeEnv = (process.env.NODE_ENV || 'production').toLowerCase()
  const tz = process.env.TZ || 'America/Santiago'
  const scheduleRaw = (process.env.CAMPAIGN_SCHEDULE || '').trim()
  const chicureoScheduleRaw = (process.env.CHICUREO_SCHEDULE || '').trim()
  const bellavistaScheduleRaw = (process.env.BELLAVISTA_SCHEDULE || '').trim()
  const ruleta4ScheduleRaw = (process.env.RULETA4_SCHEDULE || '').trim()
  const araucoScheduleRaw = (process.env.ARAUCO_SCHEDULE || '').trim()
  const niuScheduleRaw = (process.env.NIU_SCHEDULE || '').trim()
  const niu25ScheduleRaw = (process.env.NIU25_SCHEDULE || '').trim()

  const defaultLimits = {
    pelota_corazon: envInt('PRIZE_PELOTA_CORAZON', 30),
    tote: envInt('PRIZE_TOTE', 1),
    llavero: envInt('PRIZE_LLAVERO', 30),
    botella: envInt('PRIZE_BOTELLA', 2),
    stickers: envInt('PRIZE_STICKERS', 30),
    morral: envInt('PRIZE_MORRAL', 10),
    lonchera: envInt('PRIZE_LONCHERA', 2)
  }

  const chicureoDefaultLimits = {
    libreta: envInt('CHICUREO_PRIZE_LIBRETA', 3),
    parasol: envInt('CHICUREO_PRIZE_PARASOL', 20),
    lanyard: envInt('CHICUREO_PRIZE_LANYARD', 99)
  }
  const chicureo = chicureoScheduleRaw
    ? {
        schedule: parseChicureoSchedule(chicureoScheduleRaw),
        defaultLimits: chicureoDefaultLimits
      }
    : null

  const bellavistaDefaultLimits = {
    libreta: envInt('BELLAVISTA_PRIZE_LIBRETA', 3),
    parasol: envInt('BELLAVISTA_PRIZE_PARASOL', 20),
    lanyard: envInt('BELLAVISTA_PRIZE_LANYARD', 99)
  }
  const bellavista = bellavistaScheduleRaw
    ? {
        schedule: parseChicureoSchedule(bellavistaScheduleRaw),
        defaultLimits: bellavistaDefaultLimits
      }
    : null

  const ruleta4DefaultLimits = {
    stickers: envInt('RULETA4_PRIZE_STICKERS', 24),
    botella: envInt('RULETA4_PRIZE_BOTELLA', 2),
    pelota_corazon: envInt('RULETA4_PRIZE_PELOTA', 40),
    llavero: envInt('RULETA4_PRIZE_LLAVERO', 23),
    morral: envInt('RULETA4_PRIZE_MORRAL', 10),
    lonchera: envInt('RULETA4_PRIZE_LONCHERA', 2)
  }
  const ruleta4 = ruleta4ScheduleRaw
    ? {
        schedule: parseChicureoSchedule(ruleta4ScheduleRaw),
        defaultLimits: ruleta4DefaultLimits
      }
    : null

  const araucoDefaultLimits = {
    pelota: envInt('ARAUCO_PRIZE_PELOTA', 100),
    llavero: envInt('ARAUCO_PRIZE_LLAVERO', 100),
    morral: envInt('ARAUCO_PRIZE_MORRAL', 50),
    lonchera: envInt('ARAUCO_PRIZE_LONCHERA', 20),
    totebag: envInt('ARAUCO_PRIZE_TOTEBAG', 4)
  }
  const arauco = araucoScheduleRaw
    ? {
        schedule: parseChicureoSchedule(araucoScheduleRaw),
        defaultLimits: araucoDefaultLimits
      }
    : null

  const niuDefaultLimits = {
    pelota: envInt('NIU_PRIZE_PELOTA', 26),
    lonchera: envInt('NIU_PRIZE_LONCHERA', 5),
    botella: envInt('NIU_PRIZE_BOTELLA', 3),
    stickers: envInt('NIU_PRIZE_STICKERS', 26),
    morral: envInt('NIU_PRIZE_MORRAL', 14)
  }
  const niu = niuScheduleRaw
    ? {
        schedule: parseChicureoSchedule(niuScheduleRaw),
        defaultLimits: niuDefaultLimits
      }
    : null

  const niu25DefaultLimits = {
    botella: envInt('NIU25_PRIZE_BOTELLA', 5),
    bolsa: envInt('NIU25_PRIZE_BOLSA', 17),
    salsa_soya: envInt('NIU25_PRIZE_SALSA_SOYA', 9),
    salsa_unagui: envInt('NIU25_PRIZE_SALSA_UNAGUI', 9),
    chapita: envInt('NIU25_PRIZE_CHAPITA', 30)
  }
  const niu25 = niu25ScheduleRaw
    ? {
        schedule: parseChicureoSchedule(niu25ScheduleRaw),
        defaultLimits: niu25DefaultLimits
      }
    : null

  if (chicureo) {
    const n = chicureo.schedule.length
    if (n !== 6) {
      console.info(
        `Chicureo: ${n} día(s) en CHICUREO_SCHEDULE. ` + 'Si la campaña suma más fechas, añádelas separadas por |.'
      )
    }
  }

  if (scheduleRaw) {
    const campaignSchedule = parseCampaignSchedule(scheduleRaw)
    const campaignStart = campaignSchedule[0].dayKey
    const daysTotal = campaignSchedule.length
    return {
      nodeEnv,
      tz,
      campaignMode: 'schedule',
      campaignSchedule,
      campaignStart,
      daysTotal,
      dailyWindows: null,
      defaultLimits,
      toteFirstDayIndex: null,
      toteIntervalDays: null,
      port: envInt('PORT', 3000),
      dataDir: process.env.DATA_DIR || (nodeEnv === 'development' ? './data-dev' : './data'),
      wheelSvgPath: process.env.WHEEL_SVG_PATH || '',
      prizeKeys: PRIZE_KEYS,
      chicureo,
      bellavista,
      ruleta4,
      arauco,
      niu,
      niu25
    }
  }

  const campaignStart = process.env.CAMPAIGN_START
  if (!campaignStart || !DATE_RE.test(campaignStart)) {
    throw new Error('CAMPAIGN_START debe ser YYYY-MM-DD (o define CAMPAIGN_SCHEDULE)')
  }
  const daysTotal = envInt('DAYS_TOTAL', 11)
  if (daysTotal < 1) throw new Error('DAYS_TOTAL debe ser >= 1')

  const dailyWindows = parseDailyWindows(process.env.DAILY_WINDOWS, daysTotal)

  const toteFirstDayIndex = envInt('TOTE_FIRST_DAY_INDEX', 3)
  const toteIntervalDays = envInt('TOTE_INTERVAL_DAYS', 2)

  return {
    nodeEnv,
    tz,
    campaignMode: 'legacy',
    campaignSchedule: null,
    campaignStart,
    daysTotal,
    dailyWindows,
    defaultLimits,
    toteFirstDayIndex,
    toteIntervalDays,
    port: envInt('PORT', 3000),
    dataDir: process.env.DATA_DIR || (nodeEnv === 'development' ? './data-dev' : './data'),
    wheelSvgPath: process.env.WHEEL_SVG_PATH || '',
    prizeKeys: PRIZE_KEYS,
    chicureo,
    bellavista,
    ruleta4,
    arauco,
    niu,
    niu25
  }
}
