import crypto from 'node:crypto';
import { availablePrizeKeys, pickRandom, PRIZE_LABELS } from './prizes.js';

function initDayState(
  state,
  dayKey,
  dayIndex,
  defaultLimits,
  toteEligibleForDay,
) {
  if (!state.days) state.days = {};

  if (!state.days[dayKey]) {
    const inv = { ...defaultLimits };
    if (!toteEligibleForDay) inv.tote = 0;
    state.days[dayKey] = {
      inventory: inv,
      spins: {},
      idempotency: {},
    };
    return;
  }

  // Reconciliamos el tote con la regla del día para evitar que un estado
  // persistido con reglas anteriores vuelva a habilitar `tote`.
  if (!toteEligibleForDay) {
    state.days[dayKey].inventory.tote = 0;
  }
}

export function participantKeyFromBody(anonId, fpId) {
  const a = String(anonId || '').trim();
  const f = String(fpId || '').trim();
  const raw = `${a}|${f}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Ejecuta lógica de spin sobre el estado ya cargado (mutación in-place).
 * No escribe disco: eso lo hace el caller dentro de runMutation.
 */
export function applySpinMutation(state, input) {
  const {
    dayKey,
    dayIndex,
    participantKey,
    idempotencyKey,
    defaultLimits,
    toteEligibleForDay,
    enforceOnePerParticipant,
  } = input;

  if (!participantKey || participantKey.length !== 64) {
    return {
      httpStatus: 400,
      payload: { code: 'bad_request', message: 'participantKey inválido' },
    };
  }
  if (!idempotencyKey || String(idempotencyKey).length < 8) {
    return {
      httpStatus: 400,
      payload: {
        code: 'bad_request',
        message: 'idempotencyKey requerido (min 8 chars)',
      },
    };
  }

  initDayState(
    state,
    dayKey,
    dayIndex,
    defaultLimits,
    toteEligibleForDay,
  );
  const d = state.days[dayKey];

  const idemForP = d.idempotency[participantKey];
  if (idemForP && idemForP[idempotencyKey]) {
    return { httpStatus: 200, payload: idemForP[idempotencyKey] };
  }

  if (enforceOnePerParticipant) {
    const prevSpin = d.spins[participantKey];
    if (prevSpin) {
      return {
        httpStatus: 200,
        payload: {
          code: 'already_played',
          prize: prevSpin.prize,
          label: PRIZE_LABELS[prevSpin.prize] || prevSpin.prize,
          message: 'Ya participaste hoy en esta ventana.',
          remaining: { ...d.inventory },
        },
      };
    }
  }

  const pool = availablePrizeKeys(d.inventory);
  if (pool.length === 0) {
    const sold = {
      code: 'sold_out',
      message: 'Premios agotados por hoy',
      remaining: { ...d.inventory },
    };
    return { httpStatus: 200, payload: sold };
  }

  const prize = pickRandom(pool);
  d.inventory[prize] -= 1;
  const at = new Date().toISOString();
  if (enforceOnePerParticipant) {
    d.spins[participantKey] = {
      prize,
      idempotencyKey,
      at,
    };
  }

  const payload = {
    code: 'ok',
    prize,
    label: PRIZE_LABELS[prize] || prize,
    remaining: { ...d.inventory },
  };

  if (!d.idempotency[participantKey]) d.idempotency[participantKey] = {};
  d.idempotency[participantKey][idempotencyKey] = payload;

  return { httpStatus: 200, payload };
}
