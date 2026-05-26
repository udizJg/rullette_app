/**
 * Ruleta McDonald's — 8 casilleros en sentido horario desde el puntero (arriba).
 * Misma secuencia que SPIN2_SEGMENT_PRIZES en server/index.js.
 */
const WHEEL_SVG_URL = '/assets/mcdonald.svg'

const SEGMENT_COUNT = 8
const POINTER_ANGLE_DEG = 270
const SEGMENT_STEP_DEG = 360 / SEGMENT_COUNT

const SEGMENT_ORDER_CLOCKWISE = [
  'PREMIO SORPRESA',
  'TIRA 1 VEZ MÁS',
  'PREMIO SORPRESA',
  'PREMIO SORPRESA',
  'PREMIO SORPRESA',
  'TIRA 1 VEZ MÁS',
  'PREMIO SORPRESA',
  'SIGUE PARTICIPANDO'
]

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
const resultMsg = document.getElementById('resultMsg')

/**
 * SVG en el DOM (no <img>): el motor pinta vectores sin capa de mapa de bits.
 * fetch + DOMParser mantiene el HTML pequeño y permite cache HTTP/CDN del archivo.
 */
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
      svg.setAttribute('aria-label', "Ruleta McDonald's")
      svg.setAttribute('focusable', 'false')
      svg.setAttribute('shape-rendering', 'geometricPrecision')
      svg.setAttribute('text-rendering', 'geometricPrecision')

      wheelEl.replaceChildren(svg)
      wheelEl.setAttribute('aria-busy', 'false')
      wheelEl.classList.remove('wheel-spin--loading')
    })
    .catch(err => {
      console.error('No se pudo incrustar el SVG de la ruleta:', err?.message || err)
      const img = document.createElement('img')
      img.className = 'wheel-img wheel-img--fallback'
      img.alt = "Ruleta McDonald's"
      img.src = WHEEL_SVG_URL
      img.decoding = 'async'
      img.fetchPriority = 'high'
      img.draggable = false
      wheelEl.replaceChildren(img)
      wheelEl.setAttribute('aria-busy', 'false')
      wheelEl.classList.remove('wheel-spin--loading')
    })
}

let wheelRotation = 0
let prizeAnnouncementTimer = null
let prizeExitTimer = null
let confettiCleanupTimer = null

const PRIZE_ANNOUNCE_MS = 2500
const PRIZE_EXIT_MS = 700

const CONFETTI_COLORS = ['#fab918', '#ff4d50', '#ffffff', '#d61016', '#ff6b9d', '#fde047', '#fda4af', '#7dd3fc']

const PRIZE_WIN = 'PREMIO SORPRESA'

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

function withClosingExclamation(phrase) {
  const t = String(phrase || '').trim()
  if (!t) return '¡Genial!'
  if (/[!¡?]$/.test(t)) return t
  return `${t}!`
}

function formatCelebrationWin(label) {
  const core = withClosingExclamation(label)
  return `🎉 ${core} ✨`
}

function formatSigaCelebration(label) {
  const core = withClosingExclamation(label)
  return `✨ ${core} ✨`
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

function schedulePrizeDismiss() {
  prizeAnnouncementTimer = window.setTimeout(() => {
    resultMsg.classList.remove('result--prize--enter')
    resultMsg.classList.add('result--prize--exit')
    prizeExitTimer = window.setTimeout(() => {
      clearPrizeAnnouncement()
      spinBtn.disabled = false
    }, PRIZE_EXIT_MS)
  }, PRIZE_ANNOUNCE_MS)
}

function showWinAnnouncement(prizeLabel) {
  if (!resultMsg) return
  if (prizeAnnouncementTimer) {
    window.clearTimeout(prizeAnnouncementTimer)
    prizeAnnouncementTimer = null
  }
  if (prizeExitTimer) {
    window.clearTimeout(prizeExitTimer)
    prizeExitTimer = null
  }

  const line = document.createElement('span')
  line.className = 'prize-announce__message prize-announce__message--win'
  line.textContent = formatCelebrationWin(prizeLabel)

  resultMsg.replaceChildren(line)
  resultMsg.classList.remove('result--siga', 'result--prize--enter')
  void resultMsg.offsetHeight
  resultMsg.classList.add('result--prize', 'result--prize--enter')

  launchConfetti()
  schedulePrizeDismiss()
}

function showNeutralAnnouncement(prizeLabel) {
  if (!resultMsg) return
  if (prizeAnnouncementTimer) {
    window.clearTimeout(prizeAnnouncementTimer)
    prizeAnnouncementTimer = null
  }
  if (prizeExitTimer) {
    window.clearTimeout(prizeExitTimer)
    prizeExitTimer = null
  }

  const line = document.createElement('span')
  line.className = 'prize-announce__message prize-announce__message--siga'
  line.textContent = formatSigaCelebration(prizeLabel)

  resultMsg.replaceChildren(line)
  resultMsg.classList.remove('result--prize', 'result--prize--enter')
  void resultMsg.offsetHeight
  resultMsg.classList.add('result--siga', 'result--prize--enter')

  schedulePrizeDismiss()
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

function showPrizeAnnouncement(prize) {
  if (prize === PRIZE_WIN) {
    showWinAnnouncement(prize)
    return
  }
  showNeutralAnnouncement(prize)
}

if (spinBtn) {
  spinBtn.disabled = true
  spinBtn.addEventListener('click', async () => {
    if (spinBtn.disabled) return
    spinBtn.disabled = true
    clearPrizeAnnouncementClasses()
    clearConfettiLayer()
    resultMsg.textContent = 'Girando…'

    let prize
    let segmentIndex
    try {
      const res = await fetch('/api/spin2')
      const data = await res.json()
      prize = data.prize
      segmentIndex = data.segmentIndex
    } catch {
      resultMsg.textContent = 'Error de conexión. Intenta de nuevo.'
      spinBtn.disabled = false
      return
    }

    if (!prize) {
      resultMsg.textContent = 'Respuesta inesperada. Intenta de nuevo.'
      spinBtn.disabled = false
      return
    }

    resultMsg.textContent = ''
    await animateToPrize(prize, segmentIndex)
    showPrizeAnnouncement(prize)
  })
}

mountWheelSvg().finally(() => {
  if (spinBtn) spinBtn.disabled = false
})
