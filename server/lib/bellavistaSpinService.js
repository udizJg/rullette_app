import { pickRandom } from './prizes.js'

export const BELLAVISTA_PRIZE_KEYS = ['libreta', 'parasol', 'lanyard']

export const BELLAVISTA_PRIZE_LABELS = {
  libreta: 'Libreta',
  parasol: 'Parasol',
  lanyard: 'Lanyard'
}

/**
 * Orden horario desde el puntero (chicureo.svg compartido con Chicureo).
 * Mantener alineado con SEGMENT_ORDER_CLOCKWISE en public/app5.js.
 */
export const BELLAVISTA_SEGMENT_PRIZES = [
  'lanyard',
  'parasol',
  'libreta',
  'lanyard',
  'parasol',
  'libreta',
  'lanyard',
  'parasol'
]

function initBellavistaDay(state, dayKey, defaultLimits) {
  if (!state.bellavista) state.bellavista = { days: {} }
  if (!state.bellavista.days[dayKey]) {
    state.bellavista.days[dayKey] = {
      inventory: { ...defaultLimits },
      spins: {},
      idempotency: {}
    }
  }
}

function availableBellavistaKeys(inventory) {
  return BELLAVISTA_PRIZE_KEYS.filter(k => (inventory[k] ?? 0) > 0)
}

function pickSegmentIndex(prizeKey) {
  const indices = []
  for (let i = 0; i < BELLAVISTA_SEGMENT_PRIZES.length; i += 1) {
    if (BELLAVISTA_SEGMENT_PRIZES[i] === prizeKey) indices.push(i)
  }
  return indices[Math.floor(Math.random() * indices.length)]
}

/**
 * Mutación pura sobre state (in-place). Sin I/O.
 */
export function applyBellavistaSpinMutation(state, input) {
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

  initBellavistaDay(state, dayKey, defaultLimits)
  const d = state.bellavista.days[dayKey]

  const idemForP = d.idempotency[participantKey]
  if (idemForP && idemForP[idempotencyKey]) {
    return { httpStatus: 200, payload: idemForP[idempotencyKey] }
  }

  if (enforceOnePerParticipant) {
    const prevSpin = d.spins[participantKey]
    if (prevSpin) {
      return {
        httpStatus: 200,
        payload: {
          code: 'already_played',
          prize: prevSpin.prize,
          segmentIndex: prevSpin.segmentIndex,
          label: BELLAVISTA_PRIZE_LABELS[prevSpin.prize] || prevSpin.prize,
          message: 'Ya participaste hoy en esta ventana.',
          remaining: { ...d.inventory }
        }
      }
    }
  }

  const pool = availableBellavistaKeys(d.inventory)
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
  const segmentIndex = pickSegmentIndex(prize)
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
    label: BELLAVISTA_PRIZE_LABELS[prize] || prize,
    remaining: { ...d.inventory }
  }

  if (!d.idempotency[participantKey]) d.idempotency[participantKey] = {}
  d.idempotency[participantKey][idempotencyKey] = payload

  return { httpStatus: 200, payload }
}
