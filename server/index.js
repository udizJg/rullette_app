import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import fs from 'node:fs'
import { loadConfig } from './lib/config.js'
import { campaignDayIndex, isWithinWindow, resolveScheduleDay } from './lib/schedule.js'
import { createStore } from './lib/store.js'
import { PRIZE_LABELS, availablePrizeKeys } from './lib/prizes.js'
import { applySpinMutation, participantKeyFromBody } from './lib/spinService.js'
import { applyChicureoSpinMutation, CHICUREO_PRIZE_LABELS } from './lib/chicureoSpinService.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

let config
try {
  config = loadConfig()
} catch (e) {
  console.error('Config inválida:', e.message)
  process.exit(1)
}

const store = createStore(path.resolve(rootDir, config.dataDir))
const isDevelopment = config.nodeEnv === 'development'
const logsDir = path.resolve(rootDir, config.dataDir, 'logs')
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true })
}
const app = express()
app.use(cors())
app.use(express.json({ limit: '32kb' }))

app.use(express.static(path.join(rootDir, 'public')))

// Servir el SVG del wheel (para que el diseño sea idéntico al original).
// En producción idealmente se alojaría dentro de /public y se serviría como estático.
let cachedWheelSvg = null
let cachedWheelSvgAt = 0
app.get('/assets/wheel.svg', (_req, res) => {
  if (!config.wheelSvgPath) {
    return res.status(404).send('WHEEL_SVG_PATH no configurado')
  }
  try {
    const stat = fs.statSync(config.wheelSvgPath)
    const mtimeMs = stat.mtimeMs || 0
    if (!cachedWheelSvg || cachedWheelSvgAt !== mtimeMs) {
      cachedWheelSvg = fs.readFileSync(config.wheelSvgPath, 'utf8')
      cachedWheelSvgAt = mtimeMs
    }
    res.type('image/svg+xml').send(cachedWheelSvg)
  } catch (e) {
    return res.status(500).send(`No se pudo leer el SVG: ${(e && e.message) || 'error'}`)
  }
})

function nowContext() {
  const nowUtc = new Date()
  if (config.campaignMode === 'schedule') {
    const sch = resolveScheduleDay(nowUtc, config.campaignSchedule, config.tz)
    if (!sch.ok) {
      return {
        ok: false,
        reason: sch.reason,
        nowInTz: null,
        dayIndex: null,
        dayKey: null,
        toteEligible: false
      }
    }
    return {
      ok: true,
      nowInTz: sch.now,
      dayIndex: sch.dayIndex,
      dayKey: sch.dayKey,
      win: sch.win,
      toteEligible: sch.toteEligible
    }
  }

  const camp = campaignDayIndex(nowUtc, config.campaignStart, config.tz, config.daysTotal)
  if (!camp.ok) {
    return {
      ok: false,
      reason: camp.reason,
      nowInTz: null,
      dayIndex: null,
      dayKey: null,
      toteEligible: false
    }
  }
  const nowInTz = camp.now
  const { dayIndex, dayKey } = camp
  const win = isWithinWindow(nowInTz, dayIndex, config.dailyWindows, config.tz, dayKey)
  return {
    ok: true,
    nowInTz,
    dayIndex,
    dayKey,
    win,
    toteEligible: isToteEligibleDay(dayIndex)
  }
}

function isToteEligibleDay(dayIndex) {
  const toteFirst = config.toteFirstDayIndex
  const interval = config.toteIntervalDays
  if (dayIndex < toteFirst) return false
  return (dayIndex - toteFirst) % interval === 0
}

function ensureDayInventory(state, dayKey, toteEligible) {
  if (!state.days) state.days = {}
  if (!state.days[dayKey]) {
    const inv = { ...config.defaultLimits }
    if (!toteEligible) inv.tote = 0
    state.days[dayKey] = {
      inventory: inv,
      spins: {},
      idempotency: {}
    }
  } else {
    if (!toteEligible) {
      state.days[dayKey].inventory.tote = 0
    }
  }
  return state.days[dayKey].inventory
}

function cleanupOldDevLogs(dayKey) {
  if (!isDevelopment) return
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    const files = fs.readdirSync(logsDir)
    for (const fileName of files) {
      if (!fileName.startsWith('spins-') || !fileName.endsWith('.log')) continue
      if (fileName !== `spins-${dayKey}.log`) {
        fs.unlinkSync(path.join(logsDir, fileName))
      }
    }
  } catch (err) {
    console.error('No se pudo limpiar logs antiguos de dev:', err?.message || err)
  }
}

function cleanupChicureoDevLogs(dayKey) {
  if (!isDevelopment) return
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    const files = fs.readdirSync(logsDir)
    for (const fileName of files) {
      if (!fileName.startsWith('chicureo-spins-') || !fileName.endsWith('.log')) continue
      if (fileName !== `chicureo-spins-${dayKey}.log`) {
        fs.unlinkSync(path.join(logsDir, fileName))
      }
    }
  } catch (err) {
    console.error('No se pudo limpiar logs Chicureo de dev:', err?.message || err)
  }
}

function writeChicureoSpinLog(dayKey, entry) {
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    if (isDevelopment) {
      cleanupChicureoDevLogs(dayKey)
    }
    const line = `${JSON.stringify(entry)}\n`
    const logFile = path.join(logsDir, `chicureo-spins-${dayKey}.log`)
    fs.appendFileSync(logFile, line, 'utf8')
    const code = entry?.code || 'unknown'
    const prize = entry?.prize || '-'
    const deltaOk = entry?.deltaValidation?.valid
    console.log(`[CHICUREO][${dayKey}] code=${code} premio=${prize} delta_ok=${deltaOk}`)
  } catch (err) {
    console.error('No se pudo escribir log Chicureo:', err?.message || err)
  }
}

function writeSpinLog(dayKey, entry) {
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    if (isDevelopment) {
      cleanupOldDevLogs(dayKey)
    }
    const line = `${JSON.stringify(entry)}\n`
    const logFile = path.join(logsDir, `spins-${dayKey}.log`)
    fs.appendFileSync(logFile, line, 'utf8')

    const summary = entry?.consistency?.consistencySummary || `Spin ${entry?.code || 'unknown'}`
    const prizeName = entry?.consistency?.franjaLabel || '-'
    const startStock =
      entry?.consistency?.stockInicialFranja === null || entry?.consistency?.stockInicialFranja === undefined
        ? '-'
        : entry.consistency.stockInicialFranja
    const endStock =
      entry?.consistency?.stockRestanteFranja === null || entry?.consistency?.stockRestanteFranja === undefined
        ? '-'
        : entry.consistency.stockRestanteFranja
    const deltaValid = entry?.deltaValidation?.valid
    console.log(
      `[SPIN][${dayKey}] code=${entry?.code || 'unknown'} franja="${prizeName}" inicial=${startStock} restante=${endStock} delta_ok=${deltaValid} | ${summary}`
    )
  } catch (err) {
    console.error('No se pudo escribir log de spin:', err?.message || err)
  }
}

function validateInventoryDelta(beforeInventory, afterInventory, prize) {
  const keys = new Set([...Object.keys(beforeInventory || {}), ...Object.keys(afterInventory || {})])

  const changedKeys = []
  for (const key of keys) {
    const before = Number(beforeInventory?.[key] ?? 0)
    const after = Number(afterInventory?.[key] ?? 0)
    if (before !== after) changedKeys.push(key)
  }

  if (!prize) {
    return {
      valid: changedKeys.length === 0,
      changedKeys,
      expectedPrize: null,
      delta: 0
    }
  }

  const beforePrize = Number(beforeInventory?.[prize] ?? 0)
  const afterPrize = Number(afterInventory?.[prize] ?? 0)
  const delta = beforePrize - afterPrize
  const valid = changedKeys.length === 1 && changedKeys[0] === prize && delta === 1

  return {
    valid,
    changedKeys,
    expectedPrize: prize,
    delta
  }
}

function buildSpinConsistencyFields(code, prize, beforeInventory, afterInventory) {
  const label = prize ? PRIZE_LABELS[prize] || prize : null
  const stockInicialFranja = prize ? Number(beforeInventory?.[prize] ?? 0) : null
  const stockRestanteFranja = prize ? Number(afterInventory?.[prize] ?? 0) : null
  const messageTeGanaste = prize ? `Te ganaste un ${label}` : null

  return {
    franja: prize,
    franjaLabel: label,
    stockInicialFranja,
    stockRestanteFranja,
    messageTeGanaste,
    consistencySummary:
      code === 'ok'
        ? `Franja ${label} | inicial=${stockInicialFranja} | restante=${stockRestanteFranja} | ${messageTeGanaste}`
        : `Spin sin premio (${code})`
  }
}

function getDaySnapshot(dayKey, toteEligibleForDay) {
  const state = store.readSync()
  const d = state.days?.[dayKey]
  if (!d) {
    const inv = { ...config.defaultLimits }
    if (!toteEligibleForDay) inv.tote = 0
    return { inventory: inv, spins: {} }
  }
  const inv = { ...d.inventory }
  if (!toteEligibleForDay) inv.tote = 0
  return { inventory: inv, spins: { ...d.spins } }
}

function chicureoNowContext() {
  if (!config.chicureo) {
    return {
      ok: false,
      reason: 'not_configured',
      nowInTz: null,
      dayIndex: null,
      dayKey: null,
      win: null
    }
  }
  const sch = resolveScheduleDay(new Date(), config.chicureo.schedule, config.tz)
  if (!sch.ok) {
    return {
      ok: false,
      reason: sch.reason,
      nowInTz: sch.now,
      dayIndex: sch.dayIndex,
      dayKey: sch.dayKey,
      win: null
    }
  }
  return {
    ok: true,
    nowInTz: sch.now,
    dayIndex: sch.dayIndex,
    dayKey: sch.dayKey,
    win: sch.win
  }
}

function getChicureoDaySnapshot(dayKey) {
  const state = store.readSync()
  const d = state.chicureo?.days?.[dayKey]
  if (!d) {
    return { inventory: { ...config.chicureo.defaultLimits }, spins: {} }
  }
  return { inventory: { ...d.inventory }, spins: { ...d.spins } }
}

app.get('/api/status', (req, res) => {
  const ctx = nowContext()
  if (!ctx.ok) {
    return res.json({
      code: 'inactive_campaign',
      reason: ctx.reason,
      campaignStart: config.campaignStart,
      daysTotal: config.daysTotal,
      tz: config.tz
    })
  }

  const { dayIndex, dayKey, win } = ctx
  const effectiveWin = isDevelopment ? { ...win, active: true, reason: null } : win
  const snap = getDaySnapshot(dayKey, ctx.toteEligible)
  const pool = availablePrizeKeys(snap.inventory)
  const soldOutAll = pool.length === 0

  // Solo controlamos stock diario: no limitamos “una vez por participante”.
  const enforceOnePerParticipant = false

  let participantStatus = null
  const anonId = req.query.anonId
  const fpId = req.query.fpId
  if (anonId || fpId) {
    const pk = participantKeyFromBody(anonId, fpId)
    const played = enforceOnePerParticipant ? Boolean(snap.spins[pk]) : false
    participantStatus = {
      canSpin: effectiveWin.active && !soldOutAll && !played,
      alreadyPlayed: played
    }
  }

  return res.json({
    code: 'ok',
    tz: config.tz,
    campaignStart: config.campaignStart,
    daysTotal: config.daysTotal,
    dayIndex,
    dayKey,
    window: {
      active: effectiveWin.active,
      reason: effectiveWin.reason,
      label: effectiveWin.label,
      start: effectiveWin.startDt?.toISO() ?? null,
      end: effectiveWin.endExclusive?.toISO() ?? null
    },
    remaining: snap.inventory,
    labels: PRIZE_LABELS,
    soldOutAll,
    participantStatus
  })
})

app.post('/api/spin', (req, res) => {
  const ctx = nowContext()
  if (!ctx.ok) {
    return res.status(403).json({
      code: 'inactive_campaign',
      reason: ctx.reason
    })
  }

  const { dayIndex, dayKey, win } = ctx
  if (!win.active && !isDevelopment) {
    return res.status(403).json({
      code: 'outside_window',
      message: 'La ruleta no está disponible en este horario.',
      window: win.label
    })
  }

  const { anonId, fpId, idempotencyKey } = req.body || {}
  const hasAnon = String(anonId || '').trim().length > 0
  const hasFp = String(fpId || '').trim().length > 0
  if (!hasAnon && !hasFp) {
    return res.status(400).json({
      code: 'bad_request',
      message: 'anonId o fpId requerido'
    })
  }

  const participantKey = participantKeyFromBody(anonId, fpId)
  // Solo controlamos stock diario: no limitamos “una vez por participante”.
  const enforceOnePerParticipant = false

  if (isDevelopment) {
    try {
      const state = store.readSync()
      const shadowState = JSON.parse(JSON.stringify(state))
      const beforeInventory = {
        ...ensureDayInventory(shadowState, dayKey, ctx.toteEligible)
      }
      const result = applySpinMutation(shadowState, {
        dayKey,
        dayIndex,
        participantKey,
        idempotencyKey,
        defaultLimits: config.defaultLimits,
        toteEligibleForDay: ctx.toteEligible,
        enforceOnePerParticipant
      })
      const afterInventory = result.payload?.remaining ? { ...result.payload.remaining } : { ...beforeInventory }
      const prize = result.payload?.prize || null
      const deltaCheck = validateInventoryDelta(beforeInventory, afterInventory, prize)
      const consistency = buildSpinConsistencyFields(
        result.payload?.code || 'unknown',
        prize,
        beforeInventory,
        afterInventory
      )
      writeSpinLog(dayKey, {
        at: new Date().toISOString(),
        mode: config.nodeEnv,
        endpoint: '/api/spin',
        code: result.payload?.code || 'unknown',
        prize,
        prizeLabel: prize ? PRIZE_LABELS[prize] || prize : null,
        inventoryBefore: beforeInventory,
        inventoryAfter: afterInventory,
        prizeBefore: prize ? beforeInventory[prize] : null,
        prizeAfter: prize ? afterInventory[prize] : null,
        deltaValidation: deltaCheck,
        consistency
      })
      return res.status(result.httpStatus).json(result.payload)
    } catch (err) {
      console.error(err)
      return res.status(500).json({ code: 'server_error', message: 'Error interno' })
    }
  }

  store
    .runMutation(state => {
      const beforeInventory = { ...ensureDayInventory(state, dayKey, ctx.toteEligible) }
      const result = applySpinMutation(state, {
        dayKey,
        dayIndex,
        participantKey,
        idempotencyKey,
        defaultLimits: config.defaultLimits,
        toteEligibleForDay: ctx.toteEligible,
        enforceOnePerParticipant
      })
      const afterInventory = result.payload?.remaining ? { ...result.payload.remaining } : { ...beforeInventory }
      const prize = result.payload?.prize || null
      const deltaCheck = validateInventoryDelta(beforeInventory, afterInventory, prize)
      const consistency = buildSpinConsistencyFields(
        result.payload?.code || 'unknown',
        prize,
        beforeInventory,
        afterInventory
      )
      writeSpinLog(dayKey, {
        at: new Date().toISOString(),
        mode: config.nodeEnv,
        endpoint: '/api/spin',
        code: result.payload?.code || 'unknown',
        prize,
        prizeLabel: prize ? PRIZE_LABELS[prize] || prize : null,
        inventoryBefore: beforeInventory,
        inventoryAfter: afterInventory,
        prizeBefore: prize ? beforeInventory[prize] : null,
        prizeAfter: prize ? afterInventory[prize] : null,
        deltaValidation: deltaCheck,
        consistency
      })
      return result
    })
    .then(result => {
      res.status(result.httpStatus).json(result.payload)
    })
    .catch(err => {
      console.error(err)
      res.status(500).json({ code: 'server_error', message: 'Error interno' })
    })
})

function chicureoSoldOutAll(inventory) {
  return !['libreta', 'parasol', 'lanyard'].some(k => (inventory?.[k] ?? 0) > 0)
}

app.get('/api/chicureo/status', (req, res) => {
  if (!config.chicureo) {
    return res.json({
      code: 'not_configured',
      message: 'Chicureo no está configurado (CHICUREO_SCHEDULE).'
    })
  }

  const ctx = chicureoNowContext()
  if (!ctx.ok) {
    return res.json({
      code: 'inactive_campaign',
      reason: ctx.reason,
      tz: config.tz,
      activationDays: config.chicureo.schedule.map(e => e.dayKey)
    })
  }

  const { dayIndex, dayKey, win } = ctx
  const effectiveWin = isDevelopment ? { ...win, active: true, reason: null } : win
  const snap = getChicureoDaySnapshot(dayKey)
  const soldOutAll = chicureoSoldOutAll(snap.inventory)
  const enforceOnePerParticipant = false

  let participantStatus = null
  const anonId = req.query.anonId
  const fpId = req.query.fpId
  if (anonId || fpId) {
    const pk = participantKeyFromBody(anonId, fpId)
    const played = enforceOnePerParticipant ? Boolean(snap.spins[pk]) : false
    participantStatus = {
      canSpin: effectiveWin.active && !soldOutAll && !played,
      alreadyPlayed: played
    }
  }

  return res.json({
    code: 'ok',
    tz: config.tz,
    dayIndex,
    dayKey,
    activationDaysTotal: config.chicureo.schedule.length,
    window: {
      active: effectiveWin.active,
      reason: effectiveWin.reason,
      label: effectiveWin.label,
      start: effectiveWin.startDt?.toISO() ?? null,
      end: effectiveWin.endExclusive?.toISO() ?? null
    },
    remaining: snap.inventory,
    labels: CHICUREO_PRIZE_LABELS,
    soldOutAll,
    participantStatus
  })
})

app.post('/api/chicureo/spin', (req, res) => {
  if (!config.chicureo) {
    return res.status(503).json({
      code: 'not_configured',
      message: 'Chicureo no está configurado.'
    })
  }

  const ctx = chicureoNowContext()
  if (!ctx.ok) {
    return res.status(403).json({
      code: 'inactive_campaign',
      reason: ctx.reason
    })
  }

  const { dayKey, win } = ctx
  if (!win.active && !isDevelopment) {
    return res.status(403).json({
      code: 'outside_window',
      message: 'La ruleta no está disponible en este horario.',
      window: win.label
    })
  }

  const { anonId, fpId, idempotencyKey } = req.body || {}
  const hasAnon = String(anonId || '').trim().length > 0
  const hasFp = String(fpId || '').trim().length > 0
  if (!hasAnon && !hasFp) {
    return res.status(400).json({
      code: 'bad_request',
      message: 'anonId o fpId requerido'
    })
  }

  const participantKey = participantKeyFromBody(anonId, fpId)
  const enforceOnePerParticipant = false

  if (isDevelopment) {
    try {
      const state = store.readSync()
      const shadowState = JSON.parse(JSON.stringify(state))
      const prevDay = shadowState.chicureo?.days?.[dayKey]
      const beforeInventory = prevDay ? { ...prevDay.inventory } : { ...config.chicureo.defaultLimits }
      const result = applyChicureoSpinMutation(shadowState, {
        dayKey,
        participantKey,
        idempotencyKey,
        defaultLimits: config.chicureo.defaultLimits,
        enforceOnePerParticipant
      })
      const afterInventory = result.payload?.remaining ? { ...result.payload.remaining } : { ...beforeInventory }
      const prize = result.payload?.prize ?? null
      const deltaCheck = validateInventoryDelta(beforeInventory, afterInventory, prize)
      writeChicureoSpinLog(dayKey, {
        at: new Date().toISOString(),
        mode: config.nodeEnv,
        endpoint: '/api/chicureo/spin',
        code: result.payload?.code || 'unknown',
        prize,
        segmentIndex: result.payload?.segmentIndex,
        inventoryBefore: beforeInventory,
        inventoryAfter: afterInventory,
        deltaValidation: deltaCheck
      })
      return res.status(result.httpStatus).json(result.payload)
    } catch (err) {
      console.error(err)
      return res.status(500).json({ code: 'server_error', message: 'Error interno' })
    }
  }

  store
    .runMutation(state => {
      const prevDay = state.chicureo?.days?.[dayKey]
      const beforeInventory = prevDay ? { ...prevDay.inventory } : { ...config.chicureo.defaultLimits }
      const result = applyChicureoSpinMutation(state, {
        dayKey,
        participantKey,
        idempotencyKey,
        defaultLimits: config.chicureo.defaultLimits,
        enforceOnePerParticipant
      })
      const afterInventory = result.payload?.remaining ? { ...result.payload.remaining } : { ...beforeInventory }
      const prize = result.payload?.prize ?? null
      const deltaCheck = validateInventoryDelta(beforeInventory, afterInventory, prize)
      writeChicureoSpinLog(dayKey, {
        at: new Date().toISOString(),
        mode: config.nodeEnv,
        endpoint: '/api/chicureo/spin',
        code: result.payload?.code || 'unknown',
        prize,
        segmentIndex: result.payload?.segmentIndex,
        inventoryBefore: beforeInventory,
        inventoryAfter: afterInventory,
        deltaValidation: deltaCheck
      })
      return result
    })
    .then(result => {
      res.status(result.httpStatus).json(result.payload)
    })
    .catch(err => {
      console.error(err)
      res.status(500).json({ code: 'server_error', message: 'Error interno' })
    })
})

// Orden CW desde el puntero (ruleta2 + mcdonald.svg). Alinear con app2.js.
const SPIN2_SEGMENT_PRIZES = [
  'PREMIO SORPRESA',
  'TIRA 1 VEZ MÁS',
  'PREMIO SORPRESA',
  'PREMIO SORPRESA',
  'PREMIO SORPRESA',
  'TIRA 1 VEZ MÁS',
  'PREMIO SORPRESA',
  'SIGUE PARTICIPANDO'
]

function spin2PickResult() {
  const roll = Math.random()
  let prize
  if (roll < 0.5) prize = 'SIGUE PARTICIPANDO'
  else if (roll < 0.75) prize = 'PREMIO SORPRESA'
  else prize = 'TIRA 1 VEZ MÁS'

  const indices = []
  for (let i = 0; i < SPIN2_SEGMENT_PRIZES.length; i += 1) {
    if (SPIN2_SEGMENT_PRIZES[i] === prize) indices.push(i)
  }
  const segmentIndex = indices[Math.floor(Math.random() * indices.length)]
  return { prize, segmentIndex }
}

app.get('/api/spin2', (_req, res) => {
  res.json(spin2PickResult())
})

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.listen(config.port, () => {
  console.log(`Ruleta escuchando en http://localhost:${config.port}`)
  if (config.campaignMode === 'schedule') {
    console.log(`TZ=${config.tz} modo=schedule activaciones=${config.daysTotal} ` + `(primera=${config.campaignStart})`)
  } else {
    console.log(`TZ=${config.tz} inicio=${config.campaignStart} días=${config.daysTotal}`)
  }
  if (config.chicureo) {
    const first = config.chicureo.schedule[0]?.dayKey
    const last = config.chicureo.schedule[config.chicureo.schedule.length - 1]?.dayKey
    const lim = config.chicureo.defaultLimits
    console.log(
      `Chicureo: ${config.chicureo.schedule.length} día(s) (${first} → ${last}) · ` +
        `por día: libreta=${lim.libreta} parasol=${lim.parasol} lanyard=${lim.lanyard}`
    )
  }
})
