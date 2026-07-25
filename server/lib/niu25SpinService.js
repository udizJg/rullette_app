import { pickRandom } from './prizes.js'

/** Premios con inventario diario (sin «Sigue participando»). */
export const NIU25_PRIZE_KEYS = ['botella', 'bolsa', 'salsa_soya', 'salsa_unagui', 'chapita']

/**
 * Orden horario desde el puntero (niu25.svg, 8 casilleros).
 * Alinear con SEGMENT_ORDER_CLOCKWISE en public/app7.js.
 */
export const NIU25_SEGMENT_OUTCOMES = [
  'salsa_soya',
  'chapita',
  'bolsa',
  'siga_participando',
  'salsa_unagui',
  'chapita',
  'botella',
  'siga_participando'
]

export const NIU25_RESULT_LABELS = {
  botella: 'Te ganaste una botella',
  bolsa: 'Te ganaste una bolsa',
  salsa_soya: 'Te ganaste una salsa de soya',
  salsa_unagui: 'Te ganaste una salsa unagui',
  chapita: 'Te ganaste una chapita',
  siga_participando: 'Sigue participando'
}

/** Probabilidad de «Sigue participando», independiente del stock. */
const SIGA_PROBABILITY = 0.3

const SIGA_SEGMENT_INDICES = [3, 7]

function initNiu25Day(state, dayKey, defaultLimits) {
  if (!state.niu25) state.niu25 = { days: {} }
  if (!state.niu25.days[dayKey]) {
    state.niu25.days[dayKey] = {
      inventory: { ...defaultLimits },
      spins: {},
      idempotency: {}
    }
  }
}

function availableNiu25PrizeKeys(inventory) {
  return NIU25_PRIZE_KEYS.filter(k => (inventory[k] ?? 0) > 0)
}

function pickSegmentIndexForPhysicalPrize(prizeKey) {
  const indices = []
  for (let i = 0; i < NIU25_SEGMENT_OUTCOMES.length; i += 1) {
    if (NIU25_SEGMENT_OUTCOMES[i] === prizeKey) indices.push(i)
  }
  return indices[Math.floor(Math.random() * indices.length)]
}

function pickSigaSegmentIndex() {
  return SIGA_SEGMENT_INDICES[Math.floor(Math.random() * SIGA_SEGMENT_INDICES.length)]
}

/**
 * Mutación pura sobre state (in-place). Sin I/O.
 * 30% «Sigue participando» (sin stock); 70% premio físico si hay stock.
 */
export function applyNiu25SpinMutation(state, input) {
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

  initNiu25Day(state, dayKey, defaultLimits)
  const d = state.niu25.days[dayKey]

  const idemForP = d.idempotency[participantKey]
  if (idemForP && idemForP[idempotencyKey]) {
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
          label: NIU25_RESULT_LABELS[prevPrize] || prevPrize,
          message: 'Ya participaste hoy en esta ventana.',
          remaining: { ...d.inventory }
        }
      }
    }
  }

  const wantsSiga = Math.random() < SIGA_PROBABILITY

  if (wantsSiga) {
    const prize = 'siga_participando'
    const segmentIndex = pickSigaSegmentIndex()
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
      label: NIU25_RESULT_LABELS.siga_participando,
      remaining: { ...d.inventory }
    }

    if (!d.idempotency[participantKey]) d.idempotency[participantKey] = {}
    d.idempotency[participantKey][idempotencyKey] = payload

    return { httpStatus: 200, payload }
  }

  const pool = availableNiu25PrizeKeys(d.inventory)
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
    label: NIU25_RESULT_LABELS[prize] || prize,
    remaining: { ...d.inventory }
  }

  if (!d.idempotency[participantKey]) d.idempotency[participantKey] = {}
  d.idempotency[participantKey][idempotencyKey] = payload

  return { httpStatus: 200, payload }
}
