import dotenv from 'dotenv';

dotenv.config();

const PRIZE_KEYS = [
  'pelota_corazon',
  'tote',
  'llavero',
  'botella',
  'stickers',
  'morral',
  'lonchera',
];

function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}


export function parseDailyWindows(raw, expectedCount) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('DAILY_WINDOWS no definido o inválido');
  }
  const parts = raw.split('|').map((s) => s.trim()).filter(Boolean);
  if (parts.length !== expectedCount) {
    throw new Error(
      `DAILY_WINDOWS debe tener ${expectedCount} segmentos (tiene ${parts.length})`,
    );
  }
  const timeRe = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;
  return parts.map((p, i) => {
    const m = p.match(timeRe);
    if (!m) {
      throw new Error(`DAILY_WINDOWS segmento ${i + 1} inválido: "${p}"`);
    }
    return { start: `${m[1]}:${m[2]}`, end: `${m[3]}:${m[4]}` };
  });
}

export function loadConfig() {
  const nodeEnv = (process.env.NODE_ENV || 'production').toLowerCase();
  const tz = process.env.TZ || 'America/Santiago';
  const campaignStart = process.env.CAMPAIGN_START;
  if (!campaignStart || !/^\d{4}-\d{2}-\d{2}$/.test(campaignStart)) {
    throw new Error('CAMPAIGN_START debe ser YYYY-MM-DD');
  }
  const daysTotal = envInt('DAYS_TOTAL', 11);
  if (daysTotal < 1) throw new Error('DAYS_TOTAL debe ser >= 1');

  const dailyWindows = parseDailyWindows(process.env.DAILY_WINDOWS, daysTotal);

  const defaultLimits = {
    pelota_corazon: envInt('PRIZE_PELOTA_CORAZON', 30),
    tote: envInt('PRIZE_TOTE', 1),
    llavero: envInt('PRIZE_LLAVERO', 30),
    botella: envInt('PRIZE_BOTELLA', 2),
    stickers: envInt('PRIZE_STICKERS', 30),
    morral: envInt('PRIZE_MORRAL', 10),
    lonchera: envInt('PRIZE_LONCHERA', 2),
  };

  // Tote: “día de por medio”.
  // Para 11 días: first day = 3 e intervalo = 2 => días 3,5,7,9,11 (5 totes).
  const toteFirstDayIndex = envInt('TOTE_FIRST_DAY_INDEX', 3);
  const toteIntervalDays = envInt('TOTE_INTERVAL_DAYS', 2);

  return {
    nodeEnv,
    tz,
    campaignStart,
    daysTotal,
    dailyWindows,
    defaultLimits,
    toteFirstDayIndex,
    toteIntervalDays,
    port: envInt('PORT', 3000),
    dataDir: process.env.DATA_DIR || (nodeEnv === 'development' ? './data-dev' : './data'),
    // Ruta local (en dev) o a un archivo dentro del repo (en prod) para servir el SVG del wheel.
    wheelSvgPath: process.env.WHEEL_SVG_PATH || '',
    prizeKeys: PRIZE_KEYS,
  };
}
