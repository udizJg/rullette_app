/**
 * 8 segmentos visuales.
 * El backend sigue con 7 premios únicos; "pelota" aparece dos veces en la ruleta.
 */
const SEGMENT_COUNT = 8
const POINTER_ANGLE_DEG = 270 // Puntero visual arriba del círculo.
const SEGMENT_STEP_DEG = 360 / SEGMENT_COUNT
const SEGMENT_ORDER_CLOCKWISE = [
  'botella',
  'pelota_corazon',
  'llavero',
  'tote',
  'morral',
  'pelota_corazon',
  'stickers',
  'lonchera'
]

function pickSegmentForPrize(prize) {
  const matches = SEGMENTS.filter(segment => segment.prize === prize)
  if (!matches.length) return SEGMENTS[0]
  return matches[Math.floor(Math.random() * matches.length)]
}

function normalizeAngle(angle) {
  const a = angle % 360
  return a < 0 ? a + 360 : a
}

const SEGMENTS = SEGMENT_ORDER_CLOCKWISE.map((prize, index) => ({
  id: `seg_${index + 1}`,
  prize,

  centerDeg: normalizeAngle(POINTER_ANGLE_DEG + SEGMENT_STEP_DEG / 2 + index * SEGMENT_STEP_DEG)
}))

const STORAGE_ANON = 'ruleta_anon_id'
const POLL_MS = 5000

const wheelEl = document.getElementById('wheelSpin')
const pointerEl = document.querySelector('.pointer')
const spinBtn = document.getElementById('spinBtn')
const statusLine = document.getElementById('statusLine')
const resultMsg = document.getElementById('resultMsg')

let lastStatus = null
let wheelRotation = 0
let pendingIdempotencyKey = null
let lastPrizeAnnouncementAt = 0
let prizeAnnouncementTimer = null
let prizeExitTimer = null
let lockResultMessageUntil = 0
const PRIZE_ANNOUNCE_MS = 2000
const PRIZE_EXIT_MS = 700

function getOrCreateAnonId() {
  try {
    let id = localStorage.getItem(STORAGE_ANON)
    if (!id && crypto.randomUUID) {
      id = crypto.randomUUID()
      localStorage.setItem(STORAGE_ANON, id)
    }
    return id || ''
  } catch {
    return ''
  }
}

function softFingerprint() {
  try {
    const parts = [
      navigator.userAgent || '',
      String(screen?.width || ''),
      String(screen?.height || ''),
      String(screen?.colorDepth || ''),
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      navigator.language || ''
    ]
    return djb2Hex(parts.join('|'))
  } catch {
    return ''
  }
}

function djb2Hex(str) {
  let h = 5381
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 33) ^ str.charCodeAt(i)
  }
  return `fp_${(h >>> 0).toString(16)}`
}

/**
 * Gira la ruleta hasta centrar el segmento ganador bajo el puntero superior.
 * Devuelve una promesa que resuelve cuando la animación de frenado termina.
 */
function animateToPrize(prize) {
  const segment = pickSegmentForPrize(prize)
  const segmentCenterLocalDeg = segment.centerDeg
  const extraTurns = 5 + Math.floor(Math.random() * 3)

  //  compensa siempre el ángulo acumulado actual.
  const currentNormalized = normalizeAngle(wheelRotation)
  const desiredNormalized = normalizeAngle(POINTER_ANGLE_DEG - segmentCenterLocalDeg)
  const deltaToTarget = normalizeAngle(desiredNormalized - currentNormalized)
  const target = wheelRotation + extraTurns * 360 + deltaToTarget
  wheelRotation = target
  console.info(
    `[SPIN_UI] prize=${prize} segment=${segment.id} center=${segment.centerDeg} current=${currentNormalized} target=${normalizeAngle(target)}`
  )

  if (!wheelEl) return Promise.resolve()

  // Prepara el balanceo del puntero.
  let durMs = 4250
  if (pointerEl) {
    const durStr = getComputedStyle(wheelEl).transitionDuration
    const durSec = parseFloat(durStr)
    durMs = Number.isFinite(durSec) ? Math.round(durSec * 1000) : 4250
    pointerEl.style.setProperty('--wheel-spin-duration', `${durMs}ms`)
    pointerEl.classList.remove('pointer--balance')
    requestAnimationFrame(() => pointerEl.classList.add('pointer--balance'))
  }

  let done = false
  const finalize = () => {
    if (done) return
    done = true
    if (pointerEl) {
      pointerEl.classList.remove('pointer--balance')
      pointerEl.style.transform = 'translateX(-50%) rotate(0deg)'
    }
  }

  return new Promise(resolve => {
    const timer = window.setTimeout(() => {
      finalize()
      resolve()
    }, durMs + 120)

    wheelEl.addEventListener(
      'transitionend',
      e => {
        if (e.propertyName !== 'transform') return
        window.clearTimeout(timer)
        finalize()
        resolve()
      },
      { once: true }
    )

    wheelEl.style.transform = `rotate(${wheelRotation}deg)`
  })
}

const PRIZE_SEGMENT_TEXT = {
  pelota_corazon: 'UNA PELOTA',
  tote: 'UNA TOTE',
  llavero: 'UN LLAVERO',
  botella: 'UNA BOTELLA',
  stickers: 'STICKERS',
  morral: 'UN MORRAL',
  lonchera: 'UNA LONCHERA'
}

function showPrizeAnnouncement(prize) {
  if (!resultMsg) return
  const bottom = PRIZE_SEGMENT_TEXT[prize] || String(prize).toUpperCase()
  if (prizeAnnouncementTimer) {
    window.clearTimeout(prizeAnnouncementTimer)
    prizeAnnouncementTimer = null
  }
  if (prizeExitTimer) {
    window.clearTimeout(prizeExitTimer)
    prizeExitTimer = null
  }
  resultMsg.innerHTML = `
    <span class="prize-announce__top">¡TE GANASTE!</span><br/>
    <span class="prize-announce__bottom">${bottom}</span>
  `
  lastPrizeAnnouncementAt = Date.now()
  resultMsg.classList.remove('result--prize--enter')
  // Forzar reflow para reiniciar animación
  void resultMsg.offsetHeight
  resultMsg.classList.add('result--prize', 'result--prize--enter')

  prizeAnnouncementTimer = window.setTimeout(() => {
    startPrizeExitAnnouncement()
    if (lastStatus?.participantStatus?.alreadyPlayed) {
      window.setTimeout(() => {
        resultMsg.textContent = 'Ya participaste hoy.'
      }, PRIZE_EXIT_MS + 50)
    }
  }, PRIZE_ANNOUNCE_MS)
}

function clearPrizeAnnouncement() {
  if (!resultMsg) return
  clearPrizeAnnouncementClasses()
  resultMsg.textContent = ''
  if (prizeExitTimer) {
    window.clearTimeout(prizeExitTimer)
    prizeExitTimer = null
  }
}

function clearPrizeAnnouncementClasses() {
  if (!resultMsg) return
  resultMsg.classList.remove('result--prize', 'result--prize--enter', 'result--prize--exit')
}

function startPrizeExitAnnouncement() {
  if (!resultMsg) return
  if (prizeExitTimer) {
    window.clearTimeout(prizeExitTimer)
    prizeExitTimer = null
  }
  resultMsg.classList.remove('result--prize--enter')
  resultMsg.classList.add('result--prize--exit')
  prizeExitTimer = window.setTimeout(() => {
    clearPrizeAnnouncement()
  }, PRIZE_EXIT_MS)
}

function isResultMessageLocked() {
  return Date.now() < lockResultMessageUntil
}

async function fetchStatus() {
  const anonId = getOrCreateAnonId()
  const fpId = anonId ? '' : softFingerprint()
  const q = new URLSearchParams()
  if (anonId) q.set('anonId', anonId)
  if (fpId) q.set('fpId', fpId)

  const res = await fetch(`/api/status?${q.toString()}`)
  return res.json()
}

function formatWindow(st) {
  if (!st.window?.label) return ''
  return `Ventana hoy: ${st.window.label}`
}

function formatRemaining(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatTodayCountdown(st) {
  const dayKey = st.dayKey || ''
  const startMs = Date.parse(st.window?.start || '')
  const endMs = Date.parse(st.window?.end || '')
  const nowMs = Date.now()

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return `${dayKey} · hoy: --:--:--`
  }

  if (nowMs < startMs) {
    return `${dayKey} · hoy: inicia en ${formatRemaining(startMs - nowMs)}`
  }
  if (nowMs >= endMs) {
    return `${dayKey} · hoy: 00:00:00`
  }
  return `${dayKey} · Finaliza en: ${formatRemaining(endMs - nowMs)}`
}

function applyStatusToUi(st) {
  lastStatus = st

  if (st.code === 'inactive_campaign') {
    statusLine.textContent =
      st.reason === 'before_campaign'
        ? 'La campaña aún no comienza.'
        : st.reason === 'after_campaign'
          ? 'La campaña finalizó.'
          : st.reason === 'not_activation_day'
            ? 'Hoy no hay activación de la campaña.'
            : 'Campaña no disponible.'
    spinBtn.disabled = true
    resultMsg.textContent = ''
    clearPrizeAnnouncement()
    return
  }

  const win = st.window
  statusLine.textContent = formatTodayCountdown(st)

  const soldOut = st.soldOutAll
  const outside = !win.active
  const played = st.participantStatus?.alreadyPlayed

  // Durante la secuencia de giro/mensaje evitamos que el poll pise el texto visible.
  if (isResultMessageLocked()) {
    spinBtn.disabled = true
    return
  }

  if (soldOut) {
    // el mensaje hasta que termine su animación.
    if (Date.now() - lastPrizeAnnouncementAt <= PRIZE_ANNOUNCE_MS + PRIZE_EXIT_MS + 200) {
      spinBtn.disabled = true
      return
    }
    resultMsg.textContent = 'Premios agotados por hoy'
    spinBtn.disabled = true
    clearPrizeAnnouncementClasses()
    return
  }

  if (outside) {
    resultMsg.textContent = 'La ruleta solo está disponible en el horario configurado para hoy.'
    spinBtn.disabled = true
    clearPrizeAnnouncementClasses()
    return
  }

  if (played) {
    spinBtn.disabled = true
    // Si acabamos de mostrar el premio, evitamos que el poll inmediato lo pise.
    if (Date.now() - lastPrizeAnnouncementAt > PRIZE_ANNOUNCE_MS + PRIZE_EXIT_MS + 250) {
      resultMsg.textContent = 'Ya participaste hoy.'
      clearPrizeAnnouncementClasses()
    }
    return
  }

  resultMsg.textContent = ''
  spinBtn.disabled = false
}

async function poll() {
  try {
    const st = await fetchStatus()
    applyStatusToUi(st)
  } catch {
    statusLine.textContent = 'Sin conexión con el servidor.'
    spinBtn.disabled = true
  }
}

async function postSpin(idempotencyKey) {
  const anonId = getOrCreateAnonId()
  const fpId = anonId ? '' : softFingerprint()
  const res = await fetch('/api/spin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anonId, fpId, idempotencyKey })
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

spinBtn.addEventListener('click', async () => {
  if (spinBtn.disabled) return

  if (!pendingIdempotencyKey && crypto.randomUUID) {
    pendingIdempotencyKey = crypto.randomUUID()
  } else if (!pendingIdempotencyKey) {
    pendingIdempotencyKey = `idem_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }

  const idem = pendingIdempotencyKey
  spinBtn.disabled = true
  lockResultMessageUntil = Date.now() + 15000
  clearPrizeAnnouncement()
  resultMsg.textContent = 'Girando…'

  const { ok, status, data } = await postSpin(idem)

  if (status === 403 && data.code === 'outside_window') {
    pendingIdempotencyKey = null
    lockResultMessageUntil = 0
    resultMsg.textContent = data.message || 'Fuera de horario.'
    await poll()
    return
  }

  if (!ok && data.code !== 'sold_out' && data.code !== 'already_played') {
    lockResultMessageUntil = 0
    resultMsg.textContent = data.message || 'Error de red. Reintentá con el mismo intento.'
    spinBtn.disabled = false
    return
  }

  if (data.code === 'sold_out') {
    pendingIdempotencyKey = null
    lockResultMessageUntil = 0
    resultMsg.textContent = data.message || 'Premios agotados por hoy'
    await poll()
    return
  }

  if (data.code === 'already_played') {
    pendingIdempotencyKey = null
    lockResultMessageUntil = 0
    resultMsg.textContent = data.message || 'Ya participaste hoy.'
    if (data.prize) animateToPrize(data.prize)
    await poll()
    return
  }

  if (data.code === 'ok' && data.prize) {
    pendingIdempotencyKey = null
    await animateToPrize(data.prize)
    showPrizeAnnouncement(data.prize)
    lockResultMessageUntil = Date.now() + PRIZE_ANNOUNCE_MS + PRIZE_EXIT_MS + 220
    window.setTimeout(() => poll(), PRIZE_ANNOUNCE_MS + PRIZE_EXIT_MS + 120)
    return
  }

  pendingIdempotencyKey = null
  lockResultMessageUntil = 0
  resultMsg.textContent = 'Respuesta inesperada. Reintentá.'
  spinBtn.disabled = false
})

poll()
setInterval(poll, POLL_MS)
