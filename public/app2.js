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

const PRIZE_ANNOUNCE_MS = 2500
const PRIZE_EXIT_MS = 700

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
  if (!resultMsg) return
  if (prizeAnnouncementTimer) {
    window.clearTimeout(prizeAnnouncementTimer)
    prizeAnnouncementTimer = null
  }
  if (prizeExitTimer) {
    window.clearTimeout(prizeExitTimer)
    prizeExitTimer = null
  }

  resultMsg.innerHTML = `<span class="prize-announce__bottom">${prize}</span>`
  resultMsg.classList.remove('result--prize--enter')
  void resultMsg.offsetHeight
  resultMsg.classList.add('result--prize', 'result--prize--enter')

  prizeAnnouncementTimer = window.setTimeout(() => {
    resultMsg.classList.remove('result--prize--enter')
    resultMsg.classList.add('result--prize--exit')
    prizeExitTimer = window.setTimeout(() => {
      resultMsg.classList.remove('result--prize', 'result--prize--exit')
      resultMsg.textContent = ''
      spinBtn.disabled = false
    }, PRIZE_EXIT_MS)
  }, PRIZE_ANNOUNCE_MS)
}

if (spinBtn) {
  spinBtn.disabled = true
  spinBtn.addEventListener('click', async () => {
    if (spinBtn.disabled) return
    spinBtn.disabled = true
    resultMsg.classList.remove('result--prize', 'result--prize--enter', 'result--prize--exit')
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
