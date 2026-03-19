export const PRIZE_LABELS = {
  pelota_corazon: 'Pelota corazón',
  tote: 'Tote',
  llavero: 'Llavero',
  botella: 'Botella',
  stickers: 'Stickers',
  morral: 'Morral',
  lonchera: 'Lonchera',
};

export function availablePrizeKeys(inventory) {
  // Solo consideramos premios con stock > 0.
  // La elegibilidad temporal (ej. tote día por medio) se refleja ajustando el inventario por día.
  return Object.keys(inventory).filter((k) => inventory[k] > 0);
}

export function pickRandom(arr) {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}
