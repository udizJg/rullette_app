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
import { applyChicureoSpinMutation, CHICUREO_PRIZE_LABELS, CHICUREO_PRIZE_KEYS } from './lib/chicureoSpinService.js'
import {
  applyBellavistaSpinMutation,
  BELLAVISTA_PRIZE_LABELS,
  BELLAVISTA_PRIZE_KEYS
} from './lib/bellavistaSpinService.js'
import { applyRuleta4SpinMutation, RULETA4_PRIZE_KEYS, RULETA4_RESULT_LABELS } from './lib/ruleta4SpinService.js'
import { applyAraucoSpinMutation, ARAUCO_PRIZE_KEYS, ARAUCO_RESULT_LABELS } from './lib/araucoSpinService.js'
import { applyNiuSpinMutation, NIU_PRIZE_LABELS, NIU_PRIZE_KEYS } from './lib/niuSpinService.js'
import { applyNiu25SpinMutation, NIU25_PRIZE_KEYS, NIU25_RESULT_LABELS } from './lib/niu25SpinService.js'

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

function cleanupBellavistaDevLogs(dayKey) {
  if (!isDevelopment) return
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    const files = fs.readdirSync(logsDir)
    for (const fileName of files) {
      if (!fileName.startsWith('bellavista-spins-') || !fileName.endsWith('.log')) continue
      if (fileName !== `bellavista-spins-${dayKey}.log`) {
        fs.unlinkSync(path.join(logsDir, fileName))
      }
    }
  } catch (err) {
    console.error('No se pudo limpiar logs Bellavista de dev:', err?.message || err)
  }
}

function cleanupNiuDevLogs(dayKey) {
  if (!isDevelopment) return
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    const files = fs.readdirSync(logsDir)
    for (const fileName of files) {
      if (!fileName.startsWith('niu-spins-') || !fileName.endsWith('.log')) continue
      if (fileName !== `niu-spins-${dayKey}.log`) {
        fs.unlinkSync(path.join(logsDir, fileName))
      }
    }
  } catch (err) {
    console.error('No se pudo limpiar logs NIU de dev:', err?.message || err)
  }
}

function cleanupNiu25DevLogs(dayKey) {
  if (!isDevelopment) return
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    const files = fs.readdirSync(logsDir)
    for (const fileName of files) {
      if (!fileName.startsWith('niu25-spins-') || !fileName.endsWith('.log')) continue
      if (fileName !== `niu25-spins-${dayKey}.log`) {
        fs.unlinkSync(path.join(logsDir, fileName))
      }
    }
  } catch (err) {
    console.error('No se pudo limpiar logs NIU25 de dev:', err?.message || err)
  }
}

function cleanupRuleta4DevLogs(dayKey) {
  if (!isDevelopment) return
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    const files = fs.readdirSync(logsDir)
    for (const fileName of files) {
      if (!fileName.startsWith('ruleta4-spins-') || !fileName.endsWith('.log')) continue
      if (fileName !== `ruleta4-spins-${dayKey}.log`) {
        fs.unlinkSync(path.join(logsDir, fileName))
      }
    }
  } catch (err) {
    console.error('No se pudo limpiar logs ruleta 4 de dev:', err?.message || err)
  }
}

function cleanupAraucoDevLogs(dayKey) {
  if (!isDevelopment) return
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    const files = fs.readdirSync(logsDir)
    for (const fileName of files) {
      if (!fileName.startsWith('arauco-spins-') || !fileName.endsWith('.log')) continue
      if (fileName !== `arauco-spins-${dayKey}.log`) {
        fs.unlinkSync(path.join(logsDir, fileName))
      }
    }
  } catch (err) {
    console.error('No se pudo limpiar logs Arauco de dev:', err?.message || err)
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

function writeBellavistaSpinLog(dayKey, entry) {
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    if (isDevelopment) {
      cleanupBellavistaDevLogs(dayKey)
    }
    const line = `${JSON.stringify(entry)}\n`
    const logFile = path.join(logsDir, `bellavista-spins-${dayKey}.log`)
    fs.appendFileSync(logFile, line, 'utf8')
    const code = entry?.code || 'unknown'
    const prize = entry?.prize || '-'
    const deltaOk = entry?.deltaValidation?.valid
    console.log(`[BELLAVISTA][${dayKey}] code=${code} premio=${prize} delta_ok=${deltaOk}`)
  } catch (err) {
    console.error('No se pudo escribir log Bellavista:', err?.message || err)
  }
}

function writeNiuSpinLog(dayKey, entry) {
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    if (isDevelopment) {
      cleanupNiuDevLogs(dayKey)
    }
    const line = `${JSON.stringify(entry)}\n`
    const logFile = path.join(logsDir, `niu-spins-${dayKey}.log`)
    fs.appendFileSync(logFile, line, 'utf8')
    const code = entry?.code || 'unknown'
    const prize = entry?.prize || '-'
    const deltaOk = entry?.deltaValidation?.valid
    console.log(`[NIU][${dayKey}] code=${code} premio=${prize} delta_ok=${deltaOk}`)
  } catch (err) {
    console.error('No se pudo escribir log NIU:', err?.message || err)
  }
}

function writeNiu25SpinLog(dayKey, entry) {
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    if (isDevelopment) {
      cleanupNiu25DevLogs(dayKey)
    }
    const line = `${JSON.stringify(entry)}\n`
    const logFile = path.join(logsDir, `niu25-spins-${dayKey}.log`)
    fs.appendFileSync(logFile, line, 'utf8')
    const code = entry?.code || 'unknown'
    const prize = entry?.prize || '-'
    const deltaOk = entry?.deltaValidation?.valid
    console.log(`[NIU25][${dayKey}] code=${code} premio=${prize} delta_ok=${deltaOk}`)
  } catch (err) {
    console.error('No se pudo escribir log NIU25:', err?.message || err)
  }
}

function writeRuleta4SpinLog(dayKey, entry) {
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    if (isDevelopment) {
      cleanupRuleta4DevLogs(dayKey)
    }
    const line = `${JSON.stringify(entry)}\n`
    const logFile = path.join(logsDir, `ruleta4-spins-${dayKey}.log`)
    fs.appendFileSync(logFile, line, 'utf8')
    const code = entry?.code || 'unknown'
    const prize = entry?.prize || '-'
    const deltaOk = entry?.deltaValidation?.valid
    console.log(`[RULETA4][${dayKey}] code=${code} premio=${prize} delta_ok=${deltaOk}`)
  } catch (err) {
    console.error('No se pudo escribir log ruleta 4:', err?.message || err)
  }
}

function writeAraucoSpinLog(dayKey, entry) {
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    if (isDevelopment) {
      cleanupAraucoDevLogs(dayKey)
    }
    const line = `${JSON.stringify(entry)}\n`
    const logFile = path.join(logsDir, `arauco-spins-${dayKey}.log`)
    fs.appendFileSync(logFile, line, 'utf8')
    const code = entry?.code || 'unknown'
    const prize = entry?.prize || '-'
    const deltaOk = entry?.deltaValidation?.valid
    console.log(`[ARAUCO][${dayKey}] code=${code} premio=${prize} delta_ok=${deltaOk}`)
  } catch (err) {
    console.error('No se pudo escribir log Arauco:', err?.message || err)
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

function bellavistaNowContext() {
  if (!config.bellavista) {
    return {
      ok: false,
      reason: 'not_configured',
      nowInTz: null,
      dayIndex: null,
      dayKey: null,
      win: null
    }
  }
  const sch = resolveScheduleDay(new Date(), config.bellavista.schedule, config.tz)
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

function getBellavistaDaySnapshot(dayKey) {
  const state = store.readSync()
  const d = state.bellavista?.days?.[dayKey]
  if (!d) {
    return { inventory: { ...config.bellavista.defaultLimits }, spins: {} }
  }
  return { inventory: { ...d.inventory }, spins: { ...d.spins } }
}

function niuNowContext() {
  if (!config.niu) {
    return {
      ok: false,
      reason: 'not_configured',
      nowInTz: null,
      dayIndex: null,
      dayKey: null,
      win: null
    }
  }
  const sch = resolveScheduleDay(new Date(), config.niu.schedule, config.tz)
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

function getNiuDaySnapshot(dayKey) {
  const state = store.readSync()
  const d = state.niu?.days?.[dayKey]
  if (!d) {
    return { inventory: { ...config.niu.defaultLimits }, spins: {} }
  }
  return { inventory: { ...d.inventory }, spins: { ...d.spins } }
}

function niu25NowContext() {
  if (!config.niu25) {
    return {
      ok: false,
      reason: 'not_configured',
      nowInTz: null,
      dayIndex: null,
      dayKey: null,
      win: null
    }
  }
  const sch = resolveScheduleDay(new Date(), config.niu25.schedule, config.tz)
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

function getNiu25DaySnapshot(dayKey) {
  const state = store.readSync()
  const d = state.niu25?.days?.[dayKey]
  if (!d) {
    return { inventory: { ...config.niu25.defaultLimits }, spins: {} }
  }
  return { inventory: { ...d.inventory }, spins: { ...d.spins } }
}

function ruleta4NowContext() {
  if (!config.ruleta4) {
    return {
      ok: false,
      reason: 'not_configured',
      nowInTz: null,
      dayIndex: null,
      dayKey: null,
      win: null
    }
  }
  const sch = resolveScheduleDay(new Date(), config.ruleta4.schedule, config.tz)
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

function getRuleta4DaySnapshot(dayKey) {
  const state = store.readSync()
  const d = state.ruleta4?.days?.[dayKey]
  if (!d) {
    return { inventory: { ...config.ruleta4.defaultLimits }, spins: {} }
  }
  return { inventory: { ...d.inventory }, spins: { ...d.spins } }
}

function ruleta4SoldOutAll(inventory) {
  return !RULETA4_PRIZE_KEYS.some(k => (inventory?.[k] ?? 0) > 0)
}

function araucoNowContext() {
  if (!config.arauco) {
    return {
      ok: false,
      reason: 'not_configured',
      nowInTz: null,
      dayIndex: null,
      dayKey: null,
      win: null
    }
  }
  const sch = resolveScheduleDay(new Date(), config.arauco.schedule, config.tz)
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

function getAraucoDaySnapshot(dayKey) {
  const state = store.readSync()
  const d = state.arauco?.days?.[dayKey]
  if (!d) {
    return { inventory: { ...config.arauco.defaultLimits }, spins: {} }
  }
  return { inventory: { ...d.inventory }, spins: { ...d.spins } }
}

function araucoSoldOutAll(inventory) {
  return !ARAUCO_PRIZE_KEYS.some(k => (inventory?.[k] ?? 0) > 0)
}

function buildAraucoDayStats(inventory, defaultLimits) {
  const delivered = {}
  const perPrize = {}
  let totalPhysicalSpins = 0
  for (const k of ARAUCO_PRIZE_KEYS) {
    const initial = defaultLimits[k] ?? 0
    const remaining = inventory[k] ?? 0
    const n = Math.max(0, initial - remaining)
    delivered[k] = n
    totalPhysicalSpins += n
    perPrize[k] = { initial, delivered: n, remaining }
  }
  return {
    dailyInitial: { ...defaultLimits },
    delivered,
    perPrize,
    totalPhysicalSpins
  }
}

/** Estadísticas del día solo para premios físicos (sin «Siga participando»). */
function buildRuleta4DayStats(inventory, defaultLimits) {
  const delivered = {}
  const perPrize = {}
  let totalPhysicalSpins = 0
  for (const k of RULETA4_PRIZE_KEYS) {
    const initial = defaultLimits[k] ?? 0
    const remaining = inventory[k] ?? 0
    const n = Math.max(0, initial - remaining)
    delivered[k] = n
    totalPhysicalSpins += n
    perPrize[k] = { initial, delivered: n, remaining }
  }
  return {
    dailyInitial: { ...defaultLimits },
    delivered,
    perPrize,
    totalPhysicalSpins
  }
}

/** Premios entregados hoy = cupo diario − remaining (cada ok baja 1 unidad). */
function buildScheduleDayStats(inventory, defaultLimits, prizeKeys) {
  const delivered = {}
  let totalSpins = 0
  for (const k of prizeKeys) {
    const cap = defaultLimits[k] ?? 0
    const left = inventory[k] ?? 0
    const n = Math.max(0, cap - left)
    delivered[k] = n
    totalSpins += n
  }
  return {
    dailyInitial: { ...defaultLimits },
    delivered,
    totalSpins
  }
}

function buildChicureoDayStats(inventory, defaultLimits) {
  return buildScheduleDayStats(inventory, defaultLimits, CHICUREO_PRIZE_KEYS)
}

function buildBellavistaDayStats(inventory, defaultLimits) {
  return buildScheduleDayStats(inventory, defaultLimits, BELLAVISTA_PRIZE_KEYS)
}

function buildNiuDayStats(inventory, defaultLimits) {
  return buildScheduleDayStats(inventory, defaultLimits, NIU_PRIZE_KEYS)
}

/** Estadísticas del día solo para premios físicos (sin «Sigue participando»). */
function buildNiu25DayStats(inventory, defaultLimits) {
  const delivered = {}
  const perPrize = {}
  let totalPhysicalSpins = 0
  for (const k of NIU25_PRIZE_KEYS) {
    const initial = defaultLimits[k] ?? 0
    const remaining = inventory[k] ?? 0
    const n = Math.max(0, initial - remaining)
    delivered[k] = n
    totalPhysicalSpins += n
    perPrize[k] = { initial, delivered: n, remaining }
  }
  return {
    dailyInitial: { ...defaultLimits },
    delivered,
    perPrize,
    totalPhysicalSpins
  }
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
  return !CHICUREO_PRIZE_KEYS.some(k => (inventory?.[k] ?? 0) > 0)
}

function bellavistaSoldOutAll(inventory) {
  return !BELLAVISTA_PRIZE_KEYS.some(k => (inventory?.[k] ?? 0) > 0)
}

function niuSoldOutAll(inventory) {
  return !NIU_PRIZE_KEYS.some(k => (inventory?.[k] ?? 0) > 0)
}

function niu25SoldOutAll(inventory) {
  return !NIU25_PRIZE_KEYS.some(k => (inventory?.[k] ?? 0) > 0)
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
  const defaultChicureo = config.chicureo.defaultLimits
  const stats = buildChicureoDayStats(snap.inventory, defaultChicureo)
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
    stats,
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

  // Chicureo siempre persiste (también en NODE_ENV=development) para que inventario,
  // stats y logs coincidan al probar con DATA_DIR=./data-dev.
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

app.get('/api/bellavista/status', (req, res) => {
  if (!config.bellavista) {
    return res.json({
      code: 'not_configured',
      message: 'Bellavista no está configurado (BELLAVISTA_SCHEDULE).'
    })
  }

  const ctx = bellavistaNowContext()
  if (!ctx.ok) {
    return res.json({
      code: 'inactive_campaign',
      reason: ctx.reason,
      tz: config.tz,
      activationDays: config.bellavista.schedule.map(e => e.dayKey)
    })
  }

  const { dayIndex, dayKey, win } = ctx
  const effectiveWin = isDevelopment ? { ...win, active: true, reason: null } : win
  const snap = getBellavistaDaySnapshot(dayKey)
  const soldOutAll = bellavistaSoldOutAll(snap.inventory)
  const defaultBv = config.bellavista.defaultLimits
  const stats = buildBellavistaDayStats(snap.inventory, defaultBv)
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
    activationDaysTotal: config.bellavista.schedule.length,
    window: {
      active: effectiveWin.active,
      reason: effectiveWin.reason,
      label: effectiveWin.label,
      start: effectiveWin.startDt?.toISO() ?? null,
      end: effectiveWin.endExclusive?.toISO() ?? null
    },
    remaining: snap.inventory,
    stats,
    labels: BELLAVISTA_PRIZE_LABELS,
    soldOutAll,
    participantStatus
  })
})

app.post('/api/bellavista/spin', (req, res) => {
  if (!config.bellavista) {
    return res.status(503).json({
      code: 'not_configured',
      message: 'Bellavista no está configurado.'
    })
  }

  const ctx = bellavistaNowContext()
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

  store
    .runMutation(state => {
      const prevDay = state.bellavista?.days?.[dayKey]
      const beforeInventory = prevDay ? { ...prevDay.inventory } : { ...config.bellavista.defaultLimits }
      const result = applyBellavistaSpinMutation(state, {
        dayKey,
        participantKey,
        idempotencyKey,
        defaultLimits: config.bellavista.defaultLimits,
        enforceOnePerParticipant
      })
      const afterInventory = result.payload?.remaining ? { ...result.payload.remaining } : { ...beforeInventory }
      const prize = result.payload?.prize ?? null
      const deltaCheck = validateInventoryDelta(beforeInventory, afterInventory, prize)
      writeBellavistaSpinLog(dayKey, {
        at: new Date().toISOString(),
        mode: config.nodeEnv,
        endpoint: '/api/bellavista/spin',
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

app.get('/api/niu/status', (req, res) => {
  if (!config.niu) {
    return res.json({
      code: 'not_configured',
      message: 'NIU locales no está configurado (NIU_SCHEDULE).'
    })
  }

  const ctx = niuNowContext()
  if (!ctx.ok) {
    return res.json({
      code: 'inactive_campaign',
      reason: ctx.reason,
      tz: config.tz,
      activationDays: config.niu.schedule.map(e => e.dayKey)
    })
  }

  const { dayIndex, dayKey, win } = ctx
  const effectiveWin = isDevelopment ? { ...win, active: true, reason: null } : win
  const snap = getNiuDaySnapshot(dayKey)
  const soldOutAll = niuSoldOutAll(snap.inventory)
  const defaultNiu = config.niu.defaultLimits
  const stats = buildNiuDayStats(snap.inventory, defaultNiu)
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
    activationDaysTotal: config.niu.schedule.length,
    window: {
      active: effectiveWin.active,
      reason: effectiveWin.reason,
      label: effectiveWin.label,
      start: effectiveWin.startDt?.toISO() ?? null,
      end: effectiveWin.endExclusive?.toISO() ?? null
    },
    remaining: snap.inventory,
    stats,
    labels: NIU_PRIZE_LABELS,
    soldOutAll,
    participantStatus
  })
})

app.post('/api/niu/spin', (req, res) => {
  if (!config.niu) {
    return res.status(503).json({
      code: 'not_configured',
      message: 'NIU locales no está configurado.'
    })
  }

  const ctx = niuNowContext()
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

  store
    .runMutation(state => {
      const prevDay = state.niu?.days?.[dayKey]
      const beforeInventory = prevDay ? { ...prevDay.inventory } : { ...config.niu.defaultLimits }
      const result = applyNiuSpinMutation(state, {
        dayKey,
        participantKey,
        idempotencyKey,
        defaultLimits: config.niu.defaultLimits,
        enforceOnePerParticipant
      })
      const afterInventory = result.payload?.remaining ? { ...result.payload.remaining } : { ...beforeInventory }
      const prize = result.payload?.prize ?? null
      const deltaCheck = validateInventoryDelta(beforeInventory, afterInventory, prize)
      writeNiuSpinLog(dayKey, {
        at: new Date().toISOString(),
        mode: config.nodeEnv,
        endpoint: '/api/niu/spin',
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

app.get('/api/niu25/status', (req, res) => {
  if (!config.niu25) {
    return res.json({
      code: 'not_configured',
      message: 'NIU25 no está configurado (NIU25_SCHEDULE).'
    })
  }

  const ctx = niu25NowContext()
  if (!ctx.ok) {
    return res.json({
      code: 'inactive_campaign',
      reason: ctx.reason,
      tz: config.tz,
      activationDays: config.niu25.schedule.map(e => e.dayKey)
    })
  }

  const { dayIndex, dayKey, win } = ctx
  const effectiveWin = isDevelopment ? { ...win, active: true, reason: null } : win
  const snap = getNiu25DaySnapshot(dayKey)
  const soldOutAll = niu25SoldOutAll(snap.inventory)
  const stats = buildNiu25DayStats(snap.inventory, config.niu25.defaultLimits)
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
    activationDaysTotal: config.niu25.schedule.length,
    window: {
      active: effectiveWin.active,
      reason: effectiveWin.reason,
      label: effectiveWin.label,
      start: effectiveWin.startDt?.toISO() ?? null,
      end: effectiveWin.endExclusive?.toISO() ?? null
    },
    remaining: snap.inventory,
    stats,
    labels: NIU25_RESULT_LABELS,
    soldOutAll,
    participantStatus
  })
})

app.post('/api/niu25/spin', (req, res) => {
  if (!config.niu25) {
    return res.status(503).json({
      code: 'not_configured',
      message: 'NIU25 no está configurado.'
    })
  }

  const ctx = niu25NowContext()
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

  store
    .runMutation(state => {
      const prevDay = state.niu25?.days?.[dayKey]
      const beforeInventory = prevDay ? { ...prevDay.inventory } : { ...config.niu25.defaultLimits }
      // Un reintento con la misma idempotencyKey devuelve el payload cacheado y no vuelve a descontar.
      const isReplay = Boolean(prevDay?.idempotency?.[participantKey]?.[idempotencyKey])
      const result = applyNiu25SpinMutation(state, {
        dayKey,
        participantKey,
        idempotencyKey,
        defaultLimits: config.niu25.defaultLimits,
        enforceOnePerParticipant
      })
      // El inventario del estado es la fuente de verdad: en los reintentos payload.remaining
      // viene congelado del giro original y haría ver un delta que nunca ocurrió.
      const afterInventory = { ...(state.niu25?.days?.[dayKey]?.inventory ?? beforeInventory) }
      const rawPrize = result.payload?.prize
      // Ni «Sigue participando» ni los reintentos consumen stock: el validador espera null.
      const prizeForDelta = isReplay || rawPrize === 'siga_participando' ? null : (rawPrize ?? null)
      const deltaCheck = validateInventoryDelta(beforeInventory, afterInventory, prizeForDelta)
      writeNiu25SpinLog(dayKey, {
        at: new Date().toISOString(),
        mode: config.nodeEnv,
        endpoint: '/api/niu25/spin',
        code: result.payload?.code || 'unknown',
        prize: rawPrize ?? null,
        segmentIndex: result.payload?.segmentIndex,
        replayed: isReplay,
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

app.get('/api/ruleta4/status', (req, res) => {
  if (!config.ruleta4) {
    return res.json({
      code: 'not_configured',
      message: 'Ruleta Guacamole no está configurada (RULETA4_SCHEDULE).'
    })
  }

  const ctx = ruleta4NowContext()
  if (!ctx.ok) {
    return res.json({
      code: 'inactive_campaign',
      reason: ctx.reason,
      tz: config.tz,
      activationDays: config.ruleta4.schedule.map(e => e.dayKey)
    })
  }

  const { dayIndex, dayKey, win } = ctx
  const effectiveWin = isDevelopment ? { ...win, active: true, reason: null } : win
  const snap = getRuleta4DaySnapshot(dayKey)
  const soldOutPhysical = ruleta4SoldOutAll(snap.inventory)
  const defaultR4 = config.ruleta4.defaultLimits
  const stats = buildRuleta4DayStats(snap.inventory, defaultR4)

  let participantStatus = null
  const anonId = req.query.anonId
  const fpId = req.query.fpId
  if (anonId || fpId) {
    participantStatus = {
      // La tienda controla cuántos giros hace cada persona; el servidor solo exige ventana horaria.
      canSpin: effectiveWin.active,
      alreadyPlayed: false,
      soldOutPhysical
    }
  }

  const physicalPrizes = RULETA4_PRIZE_KEYS.map(key => ({
    key,
    label: RULETA4_RESULT_LABELS[key] || key,
    initialForDay: stats.perPrize[key].initial,
    delivered: stats.perPrize[key].delivered,
    remaining: stats.perPrize[key].remaining
  }))

  return res.json({
    code: 'ok',
    tz: config.tz,
    dayIndex,
    dayKey,
    activationDaysTotal: config.ruleta4.schedule.length,
    window: {
      active: effectiveWin.active,
      reason: effectiveWin.reason,
      label: effectiveWin.label,
      start: effectiveWin.startDt?.toISO() ?? null,
      end: effectiveWin.endExclusive?.toISO() ?? null
    },
    remaining: snap.inventory,
    stats,
    physicalPrizes,
    labels: RULETA4_RESULT_LABELS,
    soldOutPhysical,
    participantStatus
  })
})

app.post('/api/ruleta4/spin', (req, res) => {
  if (!config.ruleta4) {
    return res.status(503).json({
      code: 'not_configured',
      message: 'Ruleta Guacamole no está configurada.'
    })
  }

  const ctx = ruleta4NowContext()
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

  store
    .runMutation(state => {
      const prevDay = state.ruleta4?.days?.[dayKey]
      const beforeInventory = prevDay ? { ...prevDay.inventory } : { ...config.ruleta4.defaultLimits }
      const result = applyRuleta4SpinMutation(state, {
        dayKey,
        participantKey,
        idempotencyKey,
        defaultLimits: config.ruleta4.defaultLimits,
        enforceOnePerParticipant
      })
      const afterInventory = result.payload?.remaining ? { ...result.payload.remaining } : { ...beforeInventory }
      const rawPrize = result.payload?.prize
      const prizeForDelta = rawPrize === 'siga_participando' ? null : (rawPrize ?? null)
      const deltaCheck = validateInventoryDelta(beforeInventory, afterInventory, prizeForDelta)
      writeRuleta4SpinLog(dayKey, {
        at: new Date().toISOString(),
        mode: config.nodeEnv,
        endpoint: '/api/ruleta4/spin',
        code: result.payload?.code || 'unknown',
        prize: rawPrize ?? null,
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

app.get('/api/arauco/status', (req, res) => {
  if (!config.arauco) {
    return res.json({
      code: 'not_configured',
      message: 'Ruleta Arauco no está configurada (ARAUCO_SCHEDULE).'
    })
  }

  const ctx = araucoNowContext()
  if (!ctx.ok) {
    return res.json({
      code: 'inactive_campaign',
      reason: ctx.reason,
      tz: config.tz,
      activationDays: config.arauco.schedule.map(e => e.dayKey)
    })
  }

  const { dayIndex, dayKey, win } = ctx
  const effectiveWin = isDevelopment ? { ...win, active: true, reason: null } : win
  const snap = getAraucoDaySnapshot(dayKey)
  const soldOutPhysical = araucoSoldOutAll(snap.inventory)
  const defaultAr = config.arauco.defaultLimits
  const stats = buildAraucoDayStats(snap.inventory, defaultAr)

  let participantStatus = null
  const anonId = req.query.anonId
  const fpId = req.query.fpId
  if (anonId || fpId) {
    participantStatus = {
      canSpin: effectiveWin.active,
      alreadyPlayed: false,
      soldOutPhysical
    }
  }

  const physicalPrizes = ARAUCO_PRIZE_KEYS.map(key => ({
    key,
    label: ARAUCO_RESULT_LABELS[key] || key,
    initialForDay: stats.perPrize[key].initial,
    delivered: stats.perPrize[key].delivered,
    remaining: stats.perPrize[key].remaining
  }))

  return res.json({
    code: 'ok',
    tz: config.tz,
    dayIndex,
    dayKey,
    activationDaysTotal: config.arauco.schedule.length,
    window: {
      active: effectiveWin.active,
      reason: effectiveWin.reason,
      label: effectiveWin.label,
      start: effectiveWin.startDt?.toISO() ?? null,
      end: effectiveWin.endExclusive?.toISO() ?? null
    },
    remaining: snap.inventory,
    stats,
    physicalPrizes,
    labels: ARAUCO_RESULT_LABELS,
    soldOutPhysical,
    participantStatus
  })
})

app.post('/api/arauco/spin', (req, res) => {
  if (!config.arauco) {
    return res.status(503).json({
      code: 'not_configured',
      message: 'Ruleta Arauco no está configurada.'
    })
  }

  const ctx = araucoNowContext()
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

  store
    .runMutation(state => {
      const prevDay = state.arauco?.days?.[dayKey]
      const beforeInventory = prevDay ? { ...prevDay.inventory } : { ...config.arauco.defaultLimits }
      const result = applyAraucoSpinMutation(state, {
        dayKey,
        participantKey,
        idempotencyKey,
        defaultLimits: config.arauco.defaultLimits,
        enforceOnePerParticipant
      })
      const afterInventory = result.payload?.remaining ? { ...result.payload.remaining } : { ...beforeInventory }
      const rawPrize = result.payload?.prize
      const prizeForDelta = rawPrize === 'siga_participando' ? null : (rawPrize ?? null)
      const deltaCheck = validateInventoryDelta(beforeInventory, afterInventory, prizeForDelta)
      writeAraucoSpinLog(dayKey, {
        at: new Date().toISOString(),
        mode: config.nodeEnv,
        endpoint: '/api/arauco/spin',
        code: result.payload?.code || 'unknown',
        prize: rawPrize ?? null,
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
  if (config.bellavista) {
    const first = config.bellavista.schedule[0]?.dayKey
    const last = config.bellavista.schedule[config.bellavista.schedule.length - 1]?.dayKey
    const lim = config.bellavista.defaultLimits
    console.log(
      `Bellavista: ${config.bellavista.schedule.length} día(s) (${first} → ${last}) · ` +
        `por día: libreta=${lim.libreta} parasol=${lim.parasol} lanyard=${lim.lanyard}`
    )
  }
  if (config.ruleta4) {
    const first = config.ruleta4.schedule[0]?.dayKey
    const last = config.ruleta4.schedule[config.ruleta4.schedule.length - 1]?.dayKey
    const lim = config.ruleta4.defaultLimits
    console.log(
      `Ruleta 4 (Guacamole): ${config.ruleta4.schedule.length} día(s) (${first} → ${last}) · ` +
        `stock/día: stickers=${lim.stickers} botella=${lim.botella} pelota=${lim.pelota_corazon} ` +
        `llavero=${lim.llavero} morral=${lim.morral} lonchera=${lim.lonchera}`
    )
  }
  if (config.arauco) {
    const first = config.arauco.schedule[0]?.dayKey
    const last = config.arauco.schedule[config.arauco.schedule.length - 1]?.dayKey
    const lim = config.arauco.defaultLimits
    console.log(
      `Arauco: ${config.arauco.schedule.length} día(s) (${first} → ${last}) · ` +
        `stock/día: pelota=${lim.pelota} llavero=${lim.llavero} morral=${lim.morral} ` +
        `lonchera=${lim.lonchera} totebag=${lim.totebag} · 30% siga participando`
    )
  }
  if (config.niu) {
    const first = config.niu.schedule[0]?.dayKey
    const last = config.niu.schedule[config.niu.schedule.length - 1]?.dayKey
    const lim = config.niu.defaultLimits
    console.log(
      `NIU locales: ${config.niu.schedule.length} día(s) (${first} → ${last}) · ` +
        `por día: pelota=${lim.pelota} lonchera=${lim.lonchera} botella=${lim.botella} ` +
        `stickers=${lim.stickers} morral=${lim.morral}`
    )
  }
  if (config.niu25) {
    const first = config.niu25.schedule[0]?.dayKey
    const last = config.niu25.schedule[config.niu25.schedule.length - 1]?.dayKey
    const lim = config.niu25.defaultLimits
    console.log(
      `NIU25: ${config.niu25.schedule.length} día(s) (${first} → ${last}) · ` +
        `stock/día: botella=${lim.botella} bolsa=${lim.bolsa} salsa_soya=${lim.salsa_soya} ` +
        `salsa_unagui=${lim.salsa_unagui} chapita=${lim.chapita} · 30% sigue participando`
    )
  }
})
