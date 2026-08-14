import { pickRandom } from './prizes.js'

/** Premios con inventario diario (sin «Sigue participando»). */
export const IRARRAZAVAL_PRIZE_KEYS = ['pelota', 'morral', 'tote', 'botella', 'lonchera']

/** Orden fijo al parsear IRARRAZAVAL_INVENTORY (pelota,morral,tote,botella,lonchera). */
export const IRARRAZAVAL_INVENTORY_KEYS = IRARRAZAVAL_PRIZE_KEYS

/**
 * Orden horario desde el puntero (irarrazaval.svg, 8 casilleros).
 * Alinear con SEGMENT_ORDER_CLOCKWISE en public/app8.js.
 */
export const IRARRAZAVAL_SEGMENT_OUTCOMES = [
  'lonchera',
  'siga_participando',
  'botella',
  'pelota',
  'tote',
  'siga_participando',
  'morral',
  'pelota'
]

export const IRARRAZAVAL_RESULT_LABELS = {
  pelota: 'Te ganaste una pelota',
  morral: 'Te ganaste un morral',
  tote: 'Te ganaste un tote',
  botella: 'Te ganaste una botella',
  lonchera: 'Te ganaste una lonchera',
  siga_participando: 'Sigue participando'
}

export const TARGET_SIGA = 0.3
export const MIN_SIGA = 0.1
export const MAX_SIGA = 0.45
export const PHYSICAL_RATE = 0.7

const SIGA_SEGMENT_INDICES = [1, 5]

export function sumPhysicalInventory(inventory, prizeKeys = IRARRAZAVAL_PRIZE_KEYS) {
  return prizeKeys.reduce((sum, key) => sum + (inventory?.[key] ?? 0), 0)
}

/** Giros planificados del día a partir del stock físico inicial (~30% siga). */
export function computeGirosObjetivo(initialPhysical) {
  if (initialPhysical <= 0) return 0
  return Math.ceil(initialPhysical / PHYSICAL_RATE)
}

/**
 * Probabilidad dinámica de siga según tiempo de ventana, giros hechos y stock restante.
 * Función pura: sin I/O ni Date.now().
 */
export function computeAdaptiveSigaProbability({
  initialPhysical,
  physicalRemaining,
  spinCount,
  girosObjetivo,
  timeProgress
}) {
  if (physicalRemaining <= 0) return 1

  const physicalDelivered = initialPhysical - physicalRemaining
  const tp = Math.min(1, Math.max(0, Number(timeProgress) || 0))
  const spinsLeftEst = Math.max(1, girosObjetivo - spinCount)
  const minPhysicalProb = physicalRemaining / spinsLeftEst
  const maxSigaFromStock = 1 - minPhysicalProb

  const expectedPhysicalByNow = initialPhysical * tp
  const pacingDeficit = expectedPhysicalByNow - physicalDelivered

  let pSiga = TARGET_SIGA
  if (initialPhysical > 0 && pacingDeficit > 0) {
    pSiga -= (pacingDeficit / initialPhysical) * 0.6
  } else if (initialPhysical > 0 && pacingDeficit < -2) {
    pSiga += (Math.abs(pacingDeficit) / initialPhysical) * 0.3
  }

  pSiga = Math.min(pSiga, maxSigaFromStock)

  if (maxSigaFromStock < MIN_SIGA) {
    pSiga = Math.min(MAX_SIGA, Math.max(0, maxSigaFromStock))
  } else {
    pSiga = Math.max(MIN_SIGA, Math.min(MAX_SIGA, pSiga))
  }

  return Math.min(1, Math.max(0, pSiga))
}

function initIrarrazavalDay(state, dayKey, dayLimits) {
  if (!state.irarrazaval) state.irarrazaval = { days: {} }
  if (!state.irarrazaval.days[dayKey]) {
    const initialPhysical = sumPhysicalInventory(dayLimits)
    state.irarrazaval.days[dayKey] = {
      inventory: { ...dayLimits },
      initialInventory: { ...dayLimits },
      initialPhysical,
      girosObjetivo: computeGirosObjetivo(initialPhysical),
      spinCount: 0,
      sigaCount: 0,
      spins: {},
      idempotency: {}
    }
  }
}

function availableIrarrazavalPrizeKeys(inventory) {
  return IRARRAZAVAL_PRIZE_KEYS.filter(k => (inventory[k] ?? 0) > 0)
}

function pickSegmentIndexForPhysicalPrize(prizeKey) {
  const indices = []
  for (let i = 0; i < IRARRAZAVAL_SEGMENT_OUTCOMES.length; i += 1) {
    if (IRARRAZAVAL_SEGMENT_OUTCOMES[i] === prizeKey) indices.push(i)
  }
  return indices[Math.floor(Math.random() * indices.length)]
}

function pickSigaSegmentIndex() {
  return SIGA_SEGMENT_INDICES[Math.floor(Math.random() * SIGA_SEGMENT_INDICES.length)]
}

/**
 * Mutación pura sobre state (in-place). Sin I/O.
 * Siga adaptativa (~30% objetivo); premio físico si hay stock.
 */
export function applyIrarrazavalSpinMutation(state, input) {
  const {
    dayKey,
    participantKey,
    idempotencyKey,
    dayLimits,
    timeProgress,
    enforceOnePerParticipant
  } = input

  if (!participantKey || participantKey.length !== 64) {
    return {
      httpStatus: 400,
      payload: { code: 'bad_request', message: 'participantKey inválido' }
    }
  }
  if (!idempotencyKey || String(idempotencyKey).length < 8) {
    return {
      httpStatus: 400,
      payload: {
        code: 'bad_request',
        message: 'idempotencyKey requerido (min 8 chars)'
      }
    }
  }

  initIrarrazavalDay(state, dayKey, dayLimits)
  const d = state.irarrazaval.days[dayKey]

  const idemForP = d.idempotency[participantKey]
  if (idemForP && idemForP[idempotencyKey]) {
    return { httpStatus: 200, payload: idemForP[idempotencyKey], meta: { replayed: true } }
  }

  if (enforceOnePerParticipant) {
    const prevSpin = d.spins[participantKey]
    if (prevSpin) {
      const prevPrize = prevSpin.prize
      return {
        httpStatus: 200,
        payload: {
          code: 'already_played',
          prize: prevPrize,
          segmentIndex: prevSpin.segmentIndex,
          label: IRARRAZAVAL_RESULT_LABELS[prevPrize] || prevPrize,
          message: 'Ya participaste hoy en esta ventana.',
          remaining: { ...d.inventory }
        },
        meta: { replayed: false }
      }
    }
  }

  const physicalRemaining = sumPhysicalInventory(d.inventory)
  if (physicalRemaining <= 0) {
    return {
      httpStatus: 200,
      payload: {
        code: 'sold_out',
        message: 'Premios agotados por hoy',
        remaining: { ...d.inventory }
      },
      meta: { replayed: false }
    }
  }

  const pSiga = computeAdaptiveSigaProbability({
    initialPhysical: d.initialPhysical,
    physicalRemaining,
    spinCount: d.spinCount,
    girosObjetivo: d.girosObjetivo,
    timeProgress
  })

  const wantsSiga = Math.random() < pSiga

  if (wantsSiga) {
    const prize = 'siga_participando'
    const segmentIndex = pickSigaSegmentIndex()
    const at = new Date().toISOString()

    d.spinCount += 1
    d.sigaCount += 1

    if (enforceOnePerParticipant) {
      d.spins[participantKey] = {
        prize,
        segmentIndex,
        idempotencyKey,
        at
      }
    }

    const payload = {
      code: 'ok',
      prize,
      segmentIndex,
      label: IRARRAZAVAL_RESULT_LABELS.siga_participando,
      remaining: { ...d.inventory }
    }

    if (!d.idempotency[participantKey]) d.idempotency[participantKey] = {}
    d.idempotency[participantKey][idempotencyKey] = payload

    return {
      httpStatus: 200,
      payload,
      meta: { replayed: false, pSiga, spinCount: d.spinCount, girosObjetivo: d.girosObjetivo, timeProgress }
    }
  }

  const pool = availableIrarrazavalPrizeKeys(d.inventory)
  if (pool.length === 0) {
    return {
      httpStatus: 200,
      payload: {
        code: 'sold_out',
        message: 'Premios agotados por hoy',
        remaining: { ...d.inventory }
      },
      meta: { replayed: false, pSiga, spinCount: d.spinCount }
    }
  }

  const prize = pickRandom(pool)
  d.inventory[prize] -= 1
  d.spinCount += 1
  const segmentIndex = pickSegmentIndexForPhysicalPrize(prize)
  const at = new Date().toISOString()

  if (enforceOnePerParticipant) {
    d.spins[participantKey] = {
      prize,
      segmentIndex,
      idempotencyKey,
      at
    }
  }

  const payload = {
    code: 'ok',
    prize,
    segmentIndex,
    label: IRARRAZAVAL_RESULT_LABELS[prize] || prize,
    remaining: { ...d.inventory }
  }

  if (!d.idempotency[participantKey]) d.idempotency[participantKey] = {}
  d.idempotency[participantKey][idempotencyKey] = payload

  return {
    httpStatus: 200,
    payload,
    meta: {
      replayed: false,
      pSiga,
      spinCount: d.spinCount,
      girosObjetivo: d.girosObjetivo,
      timeProgress
    }
  }
}
