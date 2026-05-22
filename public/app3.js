/**
 * Ruleta Chicureo — 8 casilleros CW desde el puntero (misma geometría que
 * mcdonald.svg / chicureo.svg). Mantener alineado con CHICUREO_SEGMENT_PRIZES
 * en server/lib/chicureoSpinService.js.
 */
const WHEEL_SVG_URL = '/assets/chicureo.svg'

const SEGMENT_COUNT = 8
const POINTER_ANGLE_DEG = 270
const SEGMENT_STEP_DEG = 360 / SEGMENT_COUNT

const SEGMENT_ORDER_CLOCKWISE = ['lanyard', 'parasol', 'libreta', 'lanyard', 'parasol', 'libreta', 'lanyard', 'parasol']

const STORAGE_ANON = 'ruleta3_chicureo_anon_id'
const POLL_MS = 5000

const PRIZE_ANNOUNCE_BOTTOM = {
  libreta: 'UNA LIBRETA',
  parasol: 'UN PARASOL',
  lanyard: 'UN LANYARD'
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

function pickSegmentForPrize(prize) {
  const matches = SEGMENTS.filter(s => s.prize === prize)
  if (!matches.length) return SEGMENTS[0]
  return matches[Math.floor(Math.random() * matches.length)]
}

function resolveSegment(prize, segmentIndex) {
  if (
    Number.isInteger(segmentIndex) &&
    segmentIndex >= 0 &&
    segmentIndex < SEGMENTS.length &&
    SEGMENTS[segmentIndex].prize === prize
  ) {
    return SEGMENTS[segmentIndex]
  }
  return pickSegmentForPrize(prize)
}

const wheelEl = document.getElementById('wheelSpin')
const pointerEl = document.querySelector('.pointer')
const spinBtn = document.getElementById('spinBtn')
const statusLine = document.getElementById('statusLine')
const resultMsg = document.getElementById('resultMsg')

let wheelRotation = 0
let pendingIdempotencyKey = null
let lastPrizeAnnouncementAt = 0
let prizeAnnouncementTimer = null
let prizeExitTimer = null
let lockResultMessageUntil = 0
let wheelReady = false

const PRIZE_ANNOUNCE_MS = 2500
const PRIZE_EXIT_MS = 700

const CONFETTI_COLORS = ['#fab918', '#ff4d50', '#ffffff', '#d61016', '#ff6b9d', '#fde047', '#fda4af', '#7dd3fc']

let confettiCleanupTimer = null

function clearConfettiLayer() {
  if (confettiCleanupTimer) {
    window.clearTimeout(confettiCleanupTimer)
    confettiCleanupTimer = null
  }
  const root = document.getElementById('confettiRoot')
  if (root) root.replaceChildren()
}

function launchConfetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const root = document.getElementById('confettiRoot')
  if (!root) return

  clearConfettiLayer()

  const count = 78
  const maxDurSec = 4.6

  for (let i = 0; i < count; i += 1) {
    const el = document.createElement('span')
    el.className = 'confetti-piece'
    el.style.left = `${Math.random() * 100}%`
    el.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]

    const w = 5 + Math.random() * 10
    const h = 7 + Math.random() * 16
    el.style.width = `${w}px`
    el.style.height = `${h}px`
    el.style.borderRadius = Math.random() > 0.45 ? '2px' : `${3 + Math.random() * 5}px`

    const dur = 2.2 + Math.random() * (maxDurSec - 2.2)
    el.style.animationDuration = `${dur}s`
    el.style.animationDelay = `${Math.random() * 0.4}s`

    const drift = (Math.random() - 0.5) * 220
    const rot = Math.random() * 900 - 450
    el.style.setProperty('--drift', `${drift}px`)
    el.style.setProperty('--rot', `${rot}deg`)
    el.style.opacity = String(0.88 + Math.random() * 0.12)

    root.appendChild(el)
  }

  confettiCleanupTimer = window.setTimeout(() => clearConfettiLayer(), Math.ceil(maxDurSec * 1000) + 800)
}

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

function mountWheelSvg() {
  if (!wheelEl) return Promise.resolve()

  wheelEl.setAttribute('aria-busy', 'true')
  wheelEl.classList.add('wheel-spin--loading')

  return fetch(WHEEL_SVG_URL, { cache: 'default' })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    })
    .then(markup => {
      const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
      const svg = doc.querySelector('svg')
      if (!svg || doc.querySelector('parsererror')) {
        throw new Error('SVG inválido')
      }

      svg.setAttribute('class', 'wheel-img wheel-svg-inline')
      svg.setAttribute('role', 'img')
      svg.setAttribute('aria-label', 'Ruleta Chicureo')
      svg.setAttribute('focusable', 'false')
      svg.setAttribute('shape-rendering', 'geometricPrecision')
      svg.setAttribute('text-rendering', 'geometricPrecision')

      wheelEl.replaceChildren(svg)
      wheelEl.setAttribute('aria-busy', 'false')
      wheelEl.classList.remove('wheel-spin--loading')
    })
    .catch(err => {
      console.error('No se pudo incrustar el SVG Chicureo:', err?.message || err)
      const img = document.createElement('img')
      img.className = 'wheel-img wheel-img--fallback'
      img.alt = 'Ruleta Chicureo'
      img.src = WHEEL_SVG_URL
      img.decoding = 'async'
      img.fetchPriority = 'high'
      img.draggable = false
      wheelEl.replaceChildren(img)
      wheelEl.setAttribute('aria-busy', 'false')
      wheelEl.classList.remove('wheel-spin--loading')
    })
}

function animateToPrize(prize, segmentIndex) {
  const segment = resolveSegment(prize, segmentIndex)
  const extraTurns = 5 + Math.floor(Math.random() * 3)

  const currentNormalized = normalizeAngle(wheelRotation)
  const desiredNormalized = normalizeAngle(POINTER_ANGLE_DEG - segment.centerDeg)
  const deltaToTarget = normalizeAngle(desiredNormalized - currentNormalized)
  const target = wheelRotation + extraTurns * 360 + deltaToTarget
  wheelRotation = target

  if (!wheelEl) return Promise.resolve()

  wheelEl.classList.add('wheel-spin--animating')

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
    wheelEl?.classList.remove('wheel-spin--animating')
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

function isResultMessageLocked() {
  return Date.now() < lockResultMessageUntil
}

function clearPrizeAnnouncementClasses() {
  if (!resultMsg) return
  resultMsg.classList.remove('result--prize', 'result--prize--enter', 'result--prize--exit')
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

function showPrizeAnnouncement(prizeKey, labelFromServer) {
  if (!resultMsg) return
  if (prizeAnnouncementTimer) {
    window.clearTimeout(prizeAnnouncementTimer)
    prizeAnnouncementTimer = null
  }
  if (prizeExitTimer) {
    window.clearTimeout(prizeExitTimer)
    prizeExitTimer = null
  }

  const bottom =
    PRIZE_ANNOUNCE_BOTTOM[prizeKey] ||
    (labelFromServer ? String(labelFromServer).toUpperCase() : String(prizeKey).toUpperCase())

  resultMsg.innerHTML = `
    <span class="prize-announce__top">¡TE GANASTE!</span><br/>
    <span class="prize-announce__bottom">${bottom}</span>
  `
  lastPrizeAnnouncementAt = Date.now()
  resultMsg.classList.remove('result--prize--enter')
  void resultMsg.offsetHeight
  resultMsg.classList.add('result--prize', 'result--prize--enter')

  launchConfetti()

  prizeAnnouncementTimer = window.setTimeout(() => {
    resultMsg.classList.remove('result--prize--enter')
    resultMsg.classList.add('result--prize--exit')
    prizeExitTimer = window.setTimeout(() => {
      clearPrizeAnnouncement()
      spinBtn.disabled = false
    }, PRIZE_EXIT_MS)
  }, PRIZE_ANNOUNCE_MS)
}

function formatRemaining(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function outsideWindowMessage(st) {
  const label = st?.window?.label
  if (label) {
    return `La ruleta solo está disponible en el horario de hoy (${label}).`
  }
  return 'La ruleta solo está disponible en el horario de hoy.'
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

async function fetchStatus() {
  const anonId = getOrCreateAnonId()
  const fpId = anonId ? '' : softFingerprint()
  const q = new URLSearchParams()
  if (anonId) q.set('anonId', anonId)
  if (fpId) q.set('fpId', fpId)

  const res = await fetch(`/api/chicureo/status?${q.toString()}`)
  return res.json()
}

function applyStatusToUi(st) {
  if (!wheelReady) {
    spinBtn.disabled = true
    return
  }

  if (st.code === 'not_configured') {
    statusLine.textContent = 'Chicureo no está configurado en el servidor.'
    spinBtn.disabled = true
    resultMsg.textContent = ''
    clearPrizeAnnouncement()
    return
  }

  if (st.code === 'inactive_campaign') {
    statusLine.textContent =
      st.reason === 'before_campaign'
        ? 'Las activaciones Chicureo aún no comienzan.'
        : st.reason === 'after_campaign'
          ? 'Las activaciones Chicureo finalizaron.'
          : st.reason === 'not_activation_day'
            ? 'Hoy no hay activación Chicureo.'
            : 'Campaña Chicureo no disponible.'
    spinBtn.disabled = true
    resultMsg.textContent = ''
    clearPrizeAnnouncement()
    return
  }

  if (st.code !== 'ok') {
    statusLine.textContent = 'Estado no disponible.'
    spinBtn.disabled = true
    return
  }

  statusLine.textContent = formatTodayCountdown(st)

  const soldOut = st.soldOutAll
  const outside = !st.window.active
  const played = st.participantStatus?.alreadyPlayed

  // Mientras el candado está activo no tocamos el botón: el click y el timer del
  // premio son la fuente de verdad; un poll intermedio re-deshabilitaba tras el exit.
  if (isResultMessageLocked()) {
    return
  }

  if (soldOut) {
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
    resultMsg.textContent = outsideWindowMessage(st)
    spinBtn.disabled = true
    clearPrizeAnnouncementClasses()
    return
  }

  if (played) {
    spinBtn.disabled = true
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
  const res = await fetch('/api/chicureo/spin', {
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
    if (data.prize) await animateToPrize(data.prize, data.segmentIndex)
    await poll()
    return
  }

  if (data.code === 'ok' && data.prize) {
    pendingIdempotencyKey = null
    resultMsg.textContent = ''
    await animateToPrize(data.prize, data.segmentIndex)
    showPrizeAnnouncement(data.prize, data.label)
    lockResultMessageUntil = Date.now() + PRIZE_ANNOUNCE_MS + PRIZE_EXIT_MS + 800
    window.setTimeout(() => poll(), PRIZE_ANNOUNCE_MS + PRIZE_EXIT_MS + 120)
    return
  }

  pendingIdempotencyKey = null
  lockResultMessageUntil = 0
  resultMsg.textContent = 'Respuesta inesperada. Reintentá.'
  spinBtn.disabled = false
})

mountWheelSvg().finally(() => {
  wheelReady = true
  poll()
})

setInterval(poll, POLL_MS)
