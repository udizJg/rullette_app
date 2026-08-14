/**
 * Simulación offline del motor Irarrazaval (siga adaptativa).
 *
 * Uso:
 *   node scripts/simulate-irarrazaval-day.mjs
 *   node scripts/simulate-irarrazaval-day.mjs --scenario=slow_start --runs=500
 *   node scripts/simulate-irarrazaval-day.mjs --day=saturday --seed=42
 *
 * Escenarios:
 *   uniform     — tiempo y giros avanzan parejo (referencia)
 *   slow_start  — poca gente al inicio, fila al final (presión de cierre)
 *   rush_early  — muchos giros temprano, ventana casi vacía al cierre
 */

import {
  applyIrarrazavalSpinMutation,
  computeAdaptiveSigaProbability,
  computeGirosObjetivo,
  sumPhysicalInventory,
  IRARRAZAVAL_PRIZE_KEYS
} from '../server/lib/irarrazavalSpinService.js'

const DAY_LIMITS = {
  saturday: { pelota: 75, morral: 25, tote: 2, botella: 2, lonchera: 2 },
  sunday: { pelota: 75, morral: 25, tote: 1, botella: 1, lonchera: 2 }
}

/** PRNG determinista para repetir la misma simulación. */
function mulberry32(seed) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function parseArgs(argv) {
  const out = { scenario: 'uniform', runs: 200, day: 'saturday', seed: 12345, maxExtraSpins: 80 }
  for (const arg of argv) {
    if (arg.startsWith('--scenario=')) out.scenario = arg.slice('--scenario='.length)
    if (arg.startsWith('--runs=')) out.runs = Number(arg.slice('--runs='.length))
    if (arg.startsWith('--day=')) out.day = arg.slice('--day='.length)
    if (arg.startsWith('--seed=')) out.seed = Number(arg.slice('--seed='.length))
    if (arg.startsWith('--maxExtraSpins=')) out.maxExtraSpins = Number(arg.slice('--maxExtraSpins='.length))
  }
  return out
}

/** Progreso de ventana (0–1) según escenario de tráfico en tienda. */
function timeProgressForSpin(scenario, spinIndex, girosObjetivo) {
  const n = Math.max(1, girosObjetivo)
  const u = spinIndex / n

  if (scenario === 'slow_start') {
    // Pocos giros al inicio pero el reloj avanza: simula atraso de entrega.
    return Math.min(1, Math.pow(u, 0.55))
  }
  if (scenario === 'rush_early') {
    return Math.min(1, 0.15 + u * 0.85)
  }
  return Math.min(1, u)
}

function fakeParticipantKey(i) {
  return `${String(i).padStart(64, '0')}`
}

function simulateOneDay({ dayLimits, scenario, seed, maxExtraSpins }) {
  const rng = mulberry32(seed)
  const originalRandom = Math.random
  Math.random = rng

  const initialPhysical = sumPhysicalInventory(dayLimits)
  const girosObjetivo = computeGirosObjetivo(initialPhysical)
  const state = { irarrazaval: { days: {} } }
  const dayKey = '2026-08-15'
  const pSigaTrace = []

  let spinIndex = 0
  let soldOutAt = null

  const runSpin = () => {
    const timeProgress = timeProgressForSpin(scenario, spinIndex, girosObjetivo)
    const pk = fakeParticipantKey(spinIndex)
    const result = applyIrarrazavalSpinMutation(state, {
      dayKey,
      participantKey: pk,
      idempotencyKey: `idem_${spinIndex}_${seed}`,
      dayLimits,
      timeProgress,
      enforceOnePerParticipant: false
    })
    if (result.meta?.pSiga != null) pSigaTrace.push(result.meta.pSiga)
    spinIndex += 1
    return result
  }

  // Fase 1: hasta agotar stock físico o alcanzar giros objetivo
  while (spinIndex < girosObjetivo + maxExtraSpins) {
    const d = state.irarrazaval.days[dayKey]
    const remaining = d ? sumPhysicalInventory(d.inventory) : initialPhysical
    if (remaining <= 0) {
      soldOutAt = spinIndex
      break
    }
    const r = runSpin()
    if (r.payload.code === 'sold_out') {
      soldOutAt = spinIndex
      break
    }
  }

  // Fase 2: giros extra tras sold_out (deben ser sold_out, no siga infinita con stock 0)
  let extraSoldOut = 0
  for (let i = 0; i < 5; i += 1) {
    const r = runSpin()
    if (r.payload.code === 'sold_out') extraSoldOut += 1
  }

  Math.random = originalRandom

  const d = state.irarrazaval.days[dayKey]
  const delivered = {}
  for (const k of IRARRAZAVAL_PRIZE_KEYS) {
    delivered[k] = (dayLimits[k] ?? 0) - (d.inventory[k] ?? 0)
  }
  const physicalDelivered = sumPhysicalInventory(dayLimits) - sumPhysicalInventory(d.inventory)
  const sigaRate = d.spinCount > 0 ? d.sigaCount / d.spinCount : 0
  const stockLeft = sumPhysicalInventory(d.inventory)

  return {
    girosObjetivo,
    initialPhysical,
    spinCount: d.spinCount,
    sigaCount: d.sigaCount,
    sigaRate,
    physicalDelivered,
    stockLeft,
    soldOutAt,
    extraSoldOut,
    delivered,
    pSigaMin: pSigaTrace.length ? Math.min(...pSigaTrace) : null,
    pSigaMax: pSigaTrace.length ? Math.max(...pSigaTrace) : null,
    pSigaAvg: pSigaTrace.length ? pSigaTrace.reduce((a, b) => a + b, 0) / pSigaTrace.length : null
  }
}

function assertAdaptivePressure() {
  const limits = DAY_LIMITS.saturday
  const initial = sumPhysicalInventory(limits)
  const giros = computeGirosObjetivo(initial)

  // Mediodía con cero entregado → siga debe bajar respecto al objetivo 30%
  const middayBehind = computeAdaptiveSigaProbability({
    initialPhysical: initial,
    physicalRemaining: initial,
    spinCount: Math.floor(giros * 0.2),
    girosObjetivo: giros,
    timeProgress: 0.5
  })

  // Mismo stock pero ventana casi cerrada → siga aún más baja
  const closingBehind = computeAdaptiveSigaProbability({
    initialPhysical: initial,
    physicalRemaining: initial,
    spinCount: Math.floor(giros * 0.5),
    girosObjetivo: giros,
    timeProgress: 0.9
  })

  if (!(closingBehind < middayBehind && middayBehind < 0.3)) {
    throw new Error(
      `Presión adaptativa falló: pSiga mediodía=${middayBehind.toFixed(3)} cierre=${closingBehind.toFixed(3)}`
    )
  }

  // Con poco stock y pocos giros restantes, techo de siga baja
  const tight = computeAdaptiveSigaProbability({
    initialPhysical: initial,
    physicalRemaining: 40,
    spinCount: giros - 45,
    girosObjetivo: giros,
    timeProgress: 0.85
  })
  if (tight > 0.2) {
    throw new Error(`Con stock apretado pSiga debería ser baja, obtuvo ${tight.toFixed(3)}`)
  }
}

function summarizeRuns(results) {
  const n = results.length
  const avg = key => results.reduce((s, r) => s + r[key], 0) / n
  const allStockOut = results.filter(r => r.stockLeft === 0).length
  const sigaInBand = results.filter(r => r.sigaRate >= 0.25 && r.sigaRate <= 0.35).length
  return {
    runs: n,
    avgSigaRate: avg('sigaRate'),
    avgPhysicalDelivered: avg('physicalDelivered'),
    avgStockLeft: avg('stockLeft'),
    pctFullDelivery: (allStockOut / n) * 100,
    pctSigaNear30: (sigaInBand / n) * 100,
    avgSoldOutAt: avg('soldOutAt')
  }
}

const args = parseArgs(process.argv.slice(2))
const dayLimits = DAY_LIMITS[args.day] ?? DAY_LIMITS.saturday

console.log('=== Checks unitarios (pSiga adaptativa) ===')
assertAdaptivePressure()
console.log('OK: presión temporal reduce pSiga cuando hay atraso\n')

console.log(`=== Simulación Monte Carlo (${args.runs} runs, escenario=${args.scenario}, día=${args.day}) ===`)
const results = []
for (let i = 0; i < args.runs; i += 1) {
  results.push(
    simulateOneDay({
      dayLimits,
      scenario: args.scenario,
      seed: args.seed + i,
      maxExtraSpins: args.maxExtraSpins
    })
  )
}

const summary = summarizeRuns(results)
const sample = results[0]

console.log(`Stock inicial físico: ${sample.initialPhysical} · girosObjetivo: ${sample.girosObjetivo}`)
console.log(`Entrega completa (stock=0): ${summary.pctFullDelivery.toFixed(1)}% de runs`)
console.log(`Siga rate promedio: ${(summary.avgSigaRate * 100).toFixed(1)}% (objetivo ~30%)`)
console.log(`Runs con siga 25–35%: ${summary.pctSigaNear30.toFixed(1)}%`)
console.log(`Stock residual promedio: ${summary.avgStockLeft.toFixed(2)} unidades`)
console.log(`Giro promedio de sold_out: ${summary.avgSoldOutAt.toFixed(0)}`)
console.log(
  `pSiga muestra (run 0): min=${sample.pSigaMin?.toFixed(3)} avg=${sample.pSigaAvg?.toFixed(3)} max=${sample.pSigaMax?.toFixed(3)}`
)
console.log('\nEntregas promedio por premio (run agregado):')
for (const k of IRARRAZAVAL_PRIZE_KEYS) {
  const avg = results.reduce((s, r) => s + r.delivered[k], 0) / results.length
  console.log(`  ${k}: ${avg.toFixed(1)} / ${dayLimits[k]}`)
}

if (sample.extraSoldOut === 5) {
  console.log('\nOK: tras sold_out los giros extra responden sold_out (no siga con stock 0)')
}

console.log('\nInterpretación:')
console.log('- pctFullDelivery alto + stockLeft ~0 → el motor agota merch en la simulación.')
console.log('- En slow_start pSiga debería bajar al final (revisar logs pSiga min/avg en ese escenario).')
console.log('- No es garantía matemática al 100%: es probabilístico; por eso se usa Monte Carlo.')
