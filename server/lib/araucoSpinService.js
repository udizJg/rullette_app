import { pickRandom } from './prizes.js'

/** Premios con inventario diario (sin «Siga participando»). */
export const ARAUCO_PRIZE_KEYS = ['pelota', 'llavero', 'morral', 'lonchera', 'totebag']

/**
 * Orden horario desde el puntero (arauco.svg, 8 casilleros).
 * Alinear con SEGMENT_ORDER_CLOCKWISE en public/app_arauco.js.
 */
export const ARAUCO_SEGMENT_OUTCOMES = [
  'totebag',
  'siga_participando',
  'llavero',
  'pelota',
  'llavero',
  'siga_participando',
  'morral',
  'lonchera'
]

export const ARAUCO_RESULT_LABELS = {
  pelota: 'Te ganaste una pelota',
  siga_participando: 'Siga participando',
  llavero: 'Te ganaste un llavero',
  morral: 'Te ganaste un morral',
  lonchera: 'Te ganaste una lonchera',
  totebag: 'Te ganaste un totebag'
}

const SIGA_SEGMENT_INDICES = [1, 5]

function initAraucoDay(state, dayKey, defaultLimits) {
  if (!state.arauco) state.arauco = { days: {} }
  if (!state.arauco.days[dayKey]) {
    state.arauco.days[dayKey] = {
      inventory: { ...defaultLimits },
      spins: {},
      idempotency: {}
    }
  }
}

function availableAraucoPrizeKeys(inventory) {
  return ARAUCO_PRIZE_KEYS.filter(k => (inventory[k] ?? 0) > 0)
}

function pickSegmentIndexForPhysicalPrize(prizeKey) {
  const indices = []
  for (let i = 0; i < ARAUCO_SEGMENT_OUTCOMES.length; i += 1) {
    if (ARAUCO_SEGMENT_OUTCOMES[i] === prizeKey) indices.push(i)
  }
  return indices[Math.floor(Math.random() * indices.length)]
}

function pickSigaSegmentIndex() {
  return SIGA_SEGMENT_INDICES[Math.floor(Math.random() * SIGA_SEGMENT_INDICES.length)]
}

/**
 * Mutación pura sobre state (in-place). Sin I/O.
 * 30% «Siga participando» (sin stock); 70% premio físico si hay stock.
 */
export function applyAraucoSpinMutation(state, input) {
  const { dayKey, participantKey, idempotencyKey, defaultLimits, enforceOnePerParticipant } = input

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

  initAraucoDay(state, dayKey, defaultLimits)
  const d = state.arauco.days[dayKey]

  const idemForP = d.idempotency[participantKey]
  if (idemForP && idempotencyKey && idemForP[idempotencyKey]) {
    return { httpStatus: 200, payload: idemForP[idempotencyKey] }
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
          label: ARAUCO_RESULT_LABELS[prevPrize] || prevPrize,
          message: 'Ya participaste hoy en esta ventana.',
          remaining: { ...d.inventory }
        }
      }
    }
  }

  const wantsSiga = Math.random() < 0.3

  if (wantsSiga) {
    const segmentIndex = pickSigaSegmentIndex()
    const prize = 'siga_participando'
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
      label: ARAUCO_RESULT_LABELS.siga_participando,
      remaining: { ...d.inventory }
    }
    if (!d.idempotency[participantKey]) d.idempotency[participantKey] = {}
    d.idempotency[participantKey][idempotencyKey] = payload

    return { httpStatus: 200, payload }
  }

  const pool = availableAraucoPrizeKeys(d.inventory)
  if (pool.length === 0) {
    return {
      httpStatus: 200,
      payload: {
        code: 'sold_out',
        message: 'Premios agotados por hoy',
        remaining: { ...d.inventory }
      }
    }
  }

  const prize = pickRandom(pool)
  d.inventory[prize] -= 1
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
    label: ARAUCO_RESULT_LABELS[prize] || prize,
    remaining: { ...d.inventory }
  }

  if (!d.idempotency[participantKey]) d.idempotency[participantKey] = {}
  d.idempotency[participantKey][idempotencyKey] = payload

  return { httpStatus: 200, payload }
}
