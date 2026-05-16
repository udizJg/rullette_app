import { pickRandom } from './prizes.js'

/** Premios con inventario diario (sin «Siga participando»). */
export const RULETA4_PRIZE_KEYS = ['stickers', 'botella', 'pelota_corazon', 'llavero', 'morral', 'lonchera']

/**
 * Orden horario desde el puntero (guacamole.svg, 8 casilleros).
 * Alinear con SEGMENT_ORDER_CLOCKWISE en public/app4.js.
 */
export const RULETA4_SEGMENT_OUTCOMES = [
  'stickers',
  'siga_participando',
  'botella',
  'pelota_corazon',
  'llavero',
  'siga_participando',
  'morral',
  'lonchera'
]

/** Textos que deben coincidir con el diseño de la ruleta. */
export const RULETA4_RESULT_LABELS = {
  stickers: 'Te ganaste stickers',
  siga_participando: 'Siga participando',
  botella: 'Te ganaste una botella',
  pelota_corazon: 'Te ganaste una pelota',
  llavero: 'Te ganaste un llavero',
  morral: 'Te ganaste un morral',
  lonchera: 'Te ganaste una lonchera'
}

const SIGA_SEGMENT_INDICES = [1, 5]

function initRuleta4Day(state, dayKey, defaultLimits) {
  if (!state.ruleta4) state.ruleta4 = { days: {} }
  if (!state.ruleta4.days[dayKey]) {
    state.ruleta4.days[dayKey] = {
      inventory: { ...defaultLimits },
      spins: {},
      idempotency: {}
    }
  }
}

function availableRuleta4PrizeKeys(inventory) {
  return RULETA4_PRIZE_KEYS.filter(k => (inventory[k] ?? 0) > 0)
}

function pickSegmentIndexForPhysicalPrize(prizeKey) {
  const indices = []
  for (let i = 0; i < RULETA4_SEGMENT_OUTCOMES.length; i += 1) {
    if (RULETA4_SEGMENT_OUTCOMES[i] === prizeKey) indices.push(i)
  }
  return indices[Math.floor(Math.random() * indices.length)]
}

function pickSigaSegmentIndex() {
  return SIGA_SEGMENT_INDICES[Math.floor(Math.random() * SIGA_SEGMENT_INDICES.length)]
}

/**
 * Mutación pura sobre state (in-place). Sin I/O.
 * 50% «Siga participando» (sin stock); 50% premio físico si hay stock.
 * enforceOnePerParticipant: en producción suele ser false (control de giros en tienda).
 */
export function applyRuleta4SpinMutation(state, input) {
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

  initRuleta4Day(state, dayKey, defaultLimits)
  const d = state.ruleta4.days[dayKey]

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
          label: RULETA4_RESULT_LABELS[prevPrize] || prevPrize,
          message: 'Ya participaste hoy en esta ventana.',
          remaining: { ...d.inventory }
        }
      }
    }
  }

  const wantsSiga = Math.random() < 0.5

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
      label: RULETA4_RESULT_LABELS.siga_participando,
      remaining: { ...d.inventory }
    }
    if (!d.idempotency[participantKey]) d.idempotency[participantKey] = {}
    d.idempotency[participantKey][idempotencyKey] = payload

    return { httpStatus: 200, payload }
  }

  const pool = availableRuleta4PrizeKeys(d.inventory)
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
    label: RULETA4_RESULT_LABELS[prize] || prize,
    remaining: { ...d.inventory }
  }

  if (!d.idempotency[participantKey]) d.idempotency[participantKey] = {}
  d.idempotency[participantKey][idempotencyKey] = payload

  return { httpStatus: 200, payload }
}
