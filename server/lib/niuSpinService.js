import { pickRandom } from './prizes.js'

export const NIU_PRIZE_KEYS = ['pelota', 'lonchera', 'botella', 'stickers', 'morral']

export const NIU_PRIZE_LABELS = {
  pelota: 'Pelota',
  lonchera: 'Lonchera',
  botella: 'Botella',
  stickers: 'Stickers',
  morral: 'Morral'
}

/**
 * Orden horario desde el puntero (Ruleta-NIU-locales-.svg).
 * Mantener alineado con SEGMENT_ORDER_CLOCKWISE en public/app6.js.
 */
export const NIU_SEGMENT_PRIZES = [
  'lonchera',
  'botella',
  'pelota',
  'stickers',
  'lonchera',
  'morral',
  'pelota',
  'stickers'
]

function initNiuDay(state, dayKey, defaultLimits) {
  if (!state.niu) state.niu = { days: {} }
  if (!state.niu.days[dayKey]) {
    state.niu.days[dayKey] = {
      inventory: { ...defaultLimits },
      spins: {},
      idempotency: {}
    }
  }
}

function availableNiuKeys(inventory) {
  return NIU_PRIZE_KEYS.filter(k => (inventory[k] ?? 0) > 0)
}

function pickSegmentIndex(prizeKey) {
  const indices = []
  for (let i = 0; i < NIU_SEGMENT_PRIZES.length; i += 1) {
    if (NIU_SEGMENT_PRIZES[i] === prizeKey) indices.push(i)
  }
  return indices[Math.floor(Math.random() * indices.length)]
}

/**
 * Mutación pura sobre state (in-place). Sin I/O.
 */
export function applyNiuSpinMutation(state, input) {
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

  initNiuDay(state, dayKey, defaultLimits)
  const d = state.niu.days[dayKey]

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
          label: NIU_PRIZE_LABELS[prevSpin.prize] || prevSpin.prize,
          message: 'Ya participaste hoy en esta ventana.',
          remaining: { ...d.inventory }
        }
      }
    }
  }

  const pool = availableNiuKeys(d.inventory)
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
    label: NIU_PRIZE_LABELS[prize] || prize,
    remaining: { ...d.inventory }
  }

  if (!d.idempotency[participantKey]) d.idempotency[participantKey] = {}
  d.idempotency[participantKey][idempotencyKey] = payload

  return { httpStatus: 200, payload }
}
