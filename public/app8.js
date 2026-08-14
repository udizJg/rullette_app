/**
 * Ruleta 8 Irarrazaval — merch con inventario diario + siga adaptativa (~30%).
 * Mantener alineado con IRARRAZAVAL_SEGMENT_OUTCOMES en server/lib/irarrazavalSpinService.js.
 */
const WHEEL_SVG_URL = '/assets/irarrazaval.svg'

const SEGMENT_COUNT = 8
const POINTER_ANGLE_DEG = 270
const SEGMENT_STEP_DEG = 360 / SEGMENT_COUNT

const SEGMENT_ORDER_CLOCKWISE = [
  'lonchera',
  'siga_participando',
  'botella',
  'pelota',
  'tote',
  'siga_participando',
  'morral',
  'pelota'
]

const STORAGE_ANON = 'ruleta8_irarrazaval_anon_id'
const POLL_MS = 5000

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
const wheelRimEl = document.querySelector('.wheel-rim')
const pointerEl = document.querySelector('.pointer')
const impactHaloEl = document.getElementById('wheelImpactHalo')
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

/** Pausa breve entre aterrizaje y anuncio; el frenado ya es suave. */
const LANDING_BEAT_MS = 260

const CONFETTI_COLORS = ['#e31d1b', '#fab918', '#ffffff', '#ff6b9d', '#fde047', '#7dd3fc', '#fda4af']

let confettiCleanupTimer = null
let burstCleanupTimer = null

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function clearConfettiLayer() {
  if (confettiCleanupTimer) {
    window.clearTimeout(confettiCleanupTimer)
    confettiCleanupTimer = null
  }
  if (burstCleanupTimer) {
    window.clearTimeout(burstCleanupTimer)
    burstCleanupTimer = null
  }
  const root = document.getElementById('confettiRoot')
  if (root) root.replaceChildren()
}

function launchConfetti() {
  if (prefersReducedMotion()) return

  const root = document.getElementById('confettiRoot')
  if (!root) return

  clearConfettiLayer()

  const count = 240
  const maxDurSec = 5.8

  for (let i = 0; i < count; i += 1) {
    const el = document.createElement('span')
    el.className = 'confetti-piece'
    el.style.left = `${Math.random() * 100}%`
    el.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]

    const w = 5 + Math.random() * 12
    const h = 7 + Math.random() * 18
    el.style.width = `${w}px`
    el.style.height = `${h}px`
    el.style.borderRadius = Math.random() > 0.45 ? '2px' : `${3 + Math.random() * 5}px`

    const dur = 2.5 + Math.random() * (maxDurSec - 2.5)
    el.style.animationDuration = `${dur}s`
    el.style.animationDelay = `${Math.random() * 0.65}s`

    const drift = (Math.random() - 0.5) * 280
    const rot = Math.random() * 980 - 490
    el.style.setProperty('--drift', `${drift}px`)
    el.style.setProperty('--rot', `${rot}deg`)
    el.style.opacity = String(0.88 + Math.random() * 0.12)

    root.appendChild(el)
  }

  confettiCleanupTimer = window.setTimeout(() => clearConfettiLayer(), Math.ceil(maxDurSec * 1000) + 1100)
}

/**
 * Cañón radial desde el centro de la rueda. El vector de cada partícula se calcula
 * en polar y viaja por variables CSS para que la animación corra en el compositor.
 */
function launchConfettiBurst() {
  if (prefersReducedMotion()) return

  const root = document.getElementById('confettiRoot')
  if (!root || !wheelEl) return

  const rect = wheelEl.getBoundingClientRect()
  if (!rect.width) return

  const originX = rect.left + rect.width / 2
  const originY = rect.top + rect.height / 2
  const count = 150
  const maxDurMs = 1450

  for (let i = 0; i < count; i += 1) {
    const el = document.createElement('span')
    el.className = 'confetti-piece confetti-piece--burst'
    el.style.left = `${originX}px`
    el.style.top = `${originY}px`
    el.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]

    const size = 6 + Math.random() * 10
    el.style.width = `${size}px`
    el.style.height = `${size * (0.55 + Math.random() * 1)}px`
    el.style.borderRadius = Math.random() > 0.5 ? '2px' : '50%'

    // Reparto angular parejo con jitter para que no se vea como una estrella perfecta.
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
    const distance = rect.width * (0.38 + Math.random() * 0.55)
    el.style.setProperty('--dx', `${Math.cos(angle) * distance}px`)
    el.style.setProperty('--dy', `${Math.sin(angle) * distance}px`)
    el.style.setProperty('--rot', `${Math.random() * 760 - 380}deg`)
    el.style.animationDuration = `${650 + Math.random() * 700}ms`

    root.appendChild(el)
  }

  burstCleanupTimer = window.setTimeout(() => {
    root.querySelectorAll('.confetti-piece--burst').forEach(el => el.remove())
    burstCleanupTimer = null
  }, maxDurMs + 300)
}

/**
 * Reinicia una animación de un solo uso y la limpia al terminar.
 * Filtra por animationName: el puntero puede emitir animationend de
 * pointer--drag al mismo tiempo que se lanza pointer--kick.
 */
function restartOneShotAnimation(el, className, animationName) {
  if (!el) return
  el.classList.remove(className)
  void el.offsetHeight
  el.classList.add(className)

  const onEnd = e => {
    if (e.animationName !== animationName) return
    el.classList.remove(className)
    el.removeEventListener('animationend', onEnd)
  }
  el.addEventListener('animationend', onEnd)
}

/** Rebote + pop de la rueda, tirón del puntero y halo de impacto. */
function playLandingImpact() {
  if (prefersReducedMotion()) return

  restartOneShotAnimation(wheelRimEl, 'wheel-rim--settle', 'niu25WheelSettle')
  restartOneShotAnimation(pointerEl, 'pointer--kick', 'niu25PointerKick')
  restartOneShotAnimation(impactHaloEl, 'wheel-impact-halo--flash', 'niu25ImpactHalo')
}

function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
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
      svg.setAttribute('aria-label', 'Ruleta Irarrazaval')
      svg.setAttribute('focusable', 'false')
      svg.setAttribute('shape-rendering', 'geometricPrecision')
      svg.setAttribute('text-rendering', 'geometricPrecision')
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')

      wheelEl.replaceChildren(svg)
      wheelEl.setAttribute('aria-busy', 'false')
      wheelEl.classList.remove('wheel-spin--loading')
    })
    .catch(err => {
      console.error('No se pudo incrustar el SVG Irarrazaval:', err?.message || err)
      const img = document.createElement('img')
      img.className = 'wheel-img wheel-img--fallback'
      img.alt = 'Ruleta Irarrazaval'
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
  const extraTurns = 6 + Math.floor(Math.random() * 3)

  const currentNormalized = normalizeAngle(wheelRotation)
  const desiredNormalized = normalizeAngle(POINTER_ANGLE_DEG - segment.centerDeg)
  const deltaToTarget = normalizeAngle(desiredNormalized - currentNormalized)
  const target = wheelRotation + extraTurns * 360 + deltaToTarget
  wheelRotation = target

  if (!wheelEl) return Promise.resolve()

  wheelEl.classList.add('wheel-spin--animating')
  spinBtn?.classList.add('spin-btn--busy')

  let durMs = 8800
  if (pointerEl) {
    const durStr = getComputedStyle(wheelEl).transitionDuration
    const durSec = parseFloat(durStr)
    durMs = Number.isFinite(durSec) ? Math.round(durSec * 1000) : 8800
    pointerEl.style.setProperty('--wheel-spin-duration', `${durMs}ms`)
    // Arrastre sincronizado al giro (sustituye el balance genérico de otras ruletas).
    pointerEl.classList.remove('pointer--drag', 'pointer--kick', 'pointer--balance')
    void pointerEl.offsetHeight
    pointerEl.classList.add('pointer--drag')
  }

  let done = false
  const finalize = () => {
    if (done) return
    done = true
    wheelEl?.classList.remove('wheel-spin--animating')
    spinBtn?.classList.remove('spin-btn--busy')
    if (pointerEl) {
      pointerEl.classList.remove('pointer--drag', 'pointer--balance')
      pointerEl.style.transform = ''
    }
    playLandingImpact()
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
  resultMsg.classList.remove('result--prize', 'result--prize--enter', 'result--prize--exit', 'result--siga')
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

/** Añade cierre con exclamación si el texto aún no termina en ! ¡ ? */
function withClosingExclamation(phrase) {
  const t = String(phrase || '').trim()
  if (!t) return '¡Genial!'
  if (/[!¡?]$/.test(t)) return t
  return `${t}!`
}

function formatCelebrationWin(labelFromServer) {
  const core = withClosingExclamation(labelFromServer || 'Te ganaste')
  return `🎉 ${core} ✨`
}

function formatSigaCelebration(labelFromServer) {
  const core = withClosingExclamation(labelFromServer || 'Sigue participando')
  return `✨ ${core} ✨`
}

function scheduleAnnouncementExit() {
  prizeAnnouncementTimer = window.setTimeout(() => {
    resultMsg.classList.remove('result--prize--enter')
    resultMsg.classList.add('result--prize--exit')
    prizeExitTimer = window.setTimeout(() => {
      clearPrizeAnnouncement()
      spinBtn.disabled = false
    }, PRIZE_EXIT_MS)
  }, PRIZE_ANNOUNCE_MS)
}

function clearAnnouncementTimers() {
  if (prizeAnnouncementTimer) {
    window.clearTimeout(prizeAnnouncementTimer)
    prizeAnnouncementTimer = null
  }
  if (prizeExitTimer) {
    window.clearTimeout(prizeExitTimer)
    prizeExitTimer = null
  }
}

function showPhysicalPrizeAnnouncement(labelFromServer) {
  if (!resultMsg) return
  clearAnnouncementTimers()

  const line = document.createElement('span')
  line.className = 'prize-announce__message prize-announce__message--win'
  line.textContent = formatCelebrationWin(labelFromServer)

  resultMsg.replaceChildren(line)
  lastPrizeAnnouncementAt = Date.now()
  resultMsg.classList.remove('result--siga', 'result--prize--enter')
  void resultMsg.offsetHeight
  resultMsg.classList.add('result--prize', 'result--prize--enter')

  launchConfetti()
  launchConfettiBurst()

  scheduleAnnouncementExit()
}

function showSigaAnnouncement(labelFromServer) {
  if (!resultMsg) return
  clearAnnouncementTimers()

  const line = document.createElement('span')
  line.className = 'prize-announce__message prize-announce__message--siga'
  line.textContent = formatSigaCelebration(labelFromServer)

  resultMsg.replaceChildren(line)
  lastPrizeAnnouncementAt = Date.now()
  resultMsg.classList.remove('result--prize', 'result--prize--enter')
  void resultMsg.offsetHeight
  resultMsg.classList.add('result--siga', 'result--prize--enter')

  scheduleAnnouncementExit()
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

  const res = await fetch(`/api/irarrazaval/status?${q.toString()}`)
  return res.json()
}

function applyStatusToUi(st) {
  if (!wheelReady) {
    spinBtn.disabled = true
    return
  }

  if (st.code === 'not_configured') {
    statusLine.textContent = 'Irarrazaval no está configurado en el servidor.'
    spinBtn.disabled = true
    resultMsg.textContent = ''
    clearPrizeAnnouncement()
    return
  }

  if (st.code === 'inactive_campaign') {
    statusLine.textContent =
      st.reason === 'before_campaign'
        ? 'La activación Irarrazaval aún no comienza.'
        : st.reason === 'after_campaign'
          ? 'La activación Irarrazaval finalizó.'
          : st.reason === 'not_activation_day'
            ? 'Hoy no hay activación Irarrazaval.'
            : 'Campaña Irarrazaval no disponible.'
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
  const res = await fetch('/api/irarrazaval/spin', {
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
  clearConfettiLayer()
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
    const isSiga = data.prize === 'siga_participando'
    pendingIdempotencyKey = null
    resultMsg.textContent = ''
    await animateToPrize(data.prize, data.segmentIndex)
    await wait(LANDING_BEAT_MS)

    if (isSiga) {
      showSigaAnnouncement(data.label)
    } else {
      showPhysicalPrizeAnnouncement(data.label)
    }

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
