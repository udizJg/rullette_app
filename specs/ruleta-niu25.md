# Spec: Ruleta NIU25 (Merch + Sigue participando 30%)

Estado: PENDIENTE DE APROBACIÓN
Fecha: 2026-07-24

## 1. Resumen

Nueva ruleta independiente para la activación del **sábado 25 de julio de 2026, 21:00–23:30**
(`TZ=America/Santiago`). Usa el SVG `public/assets/niu25.svg`, maneja 5 premios físicos con
inventario diario y entrega «Sigue participando» en el **30%** de los giros como resultado virtual
sin stock.

La arquitectura replica el patrón de **Arauco** (`araucoSpinService.js` + `app_arauco.js`), que es el
único que combina inventario físico con probabilidad fija de un resultado virtual. De la Ruleta 6
(NIU) se reutiliza únicamente el procedimiento de alta de una ruleta nueva: archivos, variables de
entorno, namespace de estado y logs propios.

Incluye una secuencia de animación de cierre de giro nueva (rebote de asentamiento, golpe de puntero
y cañón de confeti radial), aplicada **solo a esta ruleta**.

## 2. Requisitos funcionales

1. Página pública `/ruleta7.html` que monta el SVG inline vía `fetch` + `DOMParser`.
2. Endpoints `GET /api/niu25/status` y `POST /api/niu25/spin`.
3. Stock diario inicial por premio:

   | Key | Label | Stock | Variable de entorno |
   |-----|-------|-------|---------------------|
   | `botella` | Te ganaste una botella | 5 | `NIU25_PRIZE_BOTELLA` |
   | `bolsa` | Te ganaste una bolsa | 17 | `NIU25_PRIZE_BOLSA` |
   | `salsa_soya` | Te ganaste una salsa de soya | 9 | `NIU25_PRIZE_SALSA_SOYA` |
   | `salsa_unagui` | Te ganaste una salsa unagui | 9 | `NIU25_PRIZE_SALSA_UNAGUI` |
   | `chapita` | Te ganaste una chapita | 30 | `NIU25_PRIZE_CHAPITA` |
   | `siga_participando` | Sigue participando | — | *(virtual, sin stock)* |

4. En cada giro elegible: con probabilidad **0.30** el resultado es `siga_participando`; con **0.70**
   se sortea uniformemente entre los premios físicos con stock mayor a cero.
5. Si toca premio físico y no hay stock en ningún premio, la respuesta es `sold_out`
   (HTTP 200, `code: 'sold_out'`). No se convierte en «sigue participando».
6. `siga_participando` no forma parte de `NIU25_PRIZE_KEYS`. En `index.js` se pasa
   `prizeForDelta = null` a `validateInventoryDelta` cuando el resultado es siga.
7. Orden horario de los 8 segmentos desde el puntero:

   | Índice | Outcome |
   |--------|---------|
   | 0 | `salsa_soya` |
   | 1 | `chapita` |
   | 2 | `bolsa` |
   | 3 | `siga_participando` |
   | 4 | `salsa_unagui` |
   | 5 | `chapita` |
   | 6 | `botella` |
   | 7 | `siga_participando` |

   Índices de siga: **3 y 7**. Debe estar idéntico en `NIU25_SEGMENT_OUTCOMES` (backend) y
   `SEGMENT_ORDER_CLOCKWISE` (frontend).
8. El backend elige `segmentIndex` y lo devuelve; el frontend usa `resolveSegment(prize, segmentIndex)`
   para detener la animación exactamente donde decidió el servidor.
9. Campaña vía `NIU25_SCHEDULE`, mismo formato y parseo que el resto (`parseChicureoSchedule`).
   Sin la variable definida, los endpoints responden `{ code: 'not_configured' }` sin ser fatal.
10. Sin tope de giros por tablet: `enforceOnePerParticipant = false`, igual que Arauco, R4 y R6.
11. Idempotencia por `participantKey + idempotencyKey`. `localStorage` key `ruleta7_niu25_anon_id`.
12. Estado aislado en `state.niu25.days[dayKey]`. Logs JSONL en `data/logs/niu25-spins-YYYY-MM-DD.log`.
13. Persiste también con `NODE_ENV=development` (criterio de R3/R4/R5/R6/Arauco).
14. No alterar el comportamiento de ninguna ruleta existente.

## 3. Animación de cierre de giro

Aplica **solo** a esta ruleta. Secuencia al detenerse la rueda:

1. **Rebote de asentamiento** — la rueda retrocede ~2,2° y oscila hasta cero, simulando el enganche
   en el tope. Se anima `.wheel-rim` (contenedor padre) porque `.wheel-spin` lleva un
   `transform: rotate()` inline que el JS usa como acumulador de rotación; los transforms de padre e
   hijo se componen sin pisarse.
2. **Golpe de puntero** — el puntero recibe un tirón seco y se estabiliza, reforzando en qué casilla
   cayó. Reemplaza el reset directo a `rotate(0deg)` del `finalize()` actual.
3. **Pausa de ~280 ms** antes de mostrar el premio, para que el impacto se lea antes del texto.
4. **Cañón de confeti radial** desde el centro de la rueda, sumado al confeti que cae desde arriba.
   Se dispara solo con premio físico, nunca con `siga_participando` (criterio de Arauco).

Detalles de implementación:

- Clases nuevas: `.wheel-rim--settle`, `.pointer--kick`, y `.confetti-piece--burst` con
  `@keyframes niu25WheelSettle`, `niu25PointerKick`, `niu25ConfettiBurst`.
- El vector de cada partícula del cañón se pasa por variables CSS (`--dx`, `--dy`, `--rot`)
  calculadas en polar desde el centro obtenido con `getBoundingClientRect()`.
- Las clases se limpian en `animationend` para permitir repetir el giro.
- El bloque `@media (prefers-reduced-motion: reduce)` de `styles.css` debe anular las tres
  animaciones nuevas.
- `lockResultMessageUntil` en `app7.js` debe sumar los ~280 ms extra para que el polling no
  sobrescriba el mensaje del premio.

## 4. Diseño técnico

**Archivos nuevos**

- `server/lib/niu25SpinService.js` — `applyNiu25SpinMutation()`, `NIU25_PRIZE_KEYS`,
  `NIU25_RESULT_LABELS`, `NIU25_SEGMENT_OUTCOMES`. Función pura, sin I/O.
- `public/ruleta7.html` — copia estructural de `ruleta5.html` / `ruleta6.html`, `body.ruleta7`.
- `public/app7.js` — frontend con polling, animación determinista, confeti y animaciones de cierre.
- `specs/ruleta-niu25.progress.md` — checklist de implementación (se crea al aprobar).

**Archivos a modificar**

- `server/lib/config.js` — `NIU25_SCHEDULE`, `niu25DefaultLimits`, exponer `niu25` en **ambos**
  returns de `loadConfig()` (modo `schedule` y modo `legacy`).
- `server/index.js` — `niu25NowContext()`, `getNiu25DaySnapshot()`, `niu25SoldOutAll()`,
  `buildNiu25DayStats()`, `writeNiu25SpinLog()`, `cleanupNiu25DevLogs()`, las dos rutas y el log de
  arranque.
- `public/styles.css` — tema `body.ruleta7` (rojo oscuro y puntero amarillo, como R3/R6) más las
  animaciones de cierre.
- `.env.example` y `.env.development`.

**Nota de config:** al agregar Ruleta 6 apareció un bug porque el objeto `niu` solo se incluyó en el
return del modo `legacy`. Hay que registrar `niu25` en los dos returns desde el inicio.

**Variables de entorno**

```env
# Producción
NIU25_SCHEDULE=2026-07-25,21:00-23:30
NIU25_PRIZE_BOTELLA=5
NIU25_PRIZE_BOLSA=17
NIU25_PRIZE_SALSA_SOYA=9
NIU25_PRIZE_SALSA_UNAGUI=9
NIU25_PRIZE_CHAPITA=30
```

```env
# Desarrollo (ventana amplia para probar a cualquier hora)
NIU25_SCHEDULE=2026-07-24,00:00-23:59|2026-07-25,00:00-23:59
```

## 5. Fuera de alcance

- Modificar otras ruletas, sus SVG o sus animaciones.
- Base de datos, ORM o framework frontend.
- Límite de un giro por participante.
- Extender la ventana ±1 hora (se puede agregar después si la operación lo pide).
- Tests automatizados: el proyecto no tiene suite. La verificación es manual (ver criterios).

## 6. Criterios de aceptación

- [ ] `/ruleta7.html` carga `niu25.svg` completo, centrado y nítido bajo el puntero.
- [ ] Un giro con premio físico descuenta exactamente 1 unidad de ese premio.
- [ ] Sobre ~100 giros, cerca del 30% devuelve `siga_participando` sin alterar el inventario.
- [ ] La animación se detiene en el `segmentIndex` que devolvió el servidor, y el segmento coincide
      con el premio anunciado.
- [ ] Fuera de la ventana horaria responde 403 `outside_window` (excepto en `NODE_ENV=development`).
- [ ] Sin `NIU25_SCHEDULE` los endpoints responden `not_configured` y el servidor arranca igual.
- [ ] Reintentar con el mismo `idempotencyKey` devuelve el payload original sin descontar de nuevo.
- [ ] Agotado todo el stock físico, un giro que no cae en siga responde `sold_out`.
- [ ] Al detenerse el giro se ve el rebote de la rueda y el golpe del puntero, y con premio físico
      el cañón de confeti radial.
- [ ] Con `prefers-reduced-motion: reduce` las animaciones nuevas quedan anuladas.
- [ ] Los logs `niu25-spins-*.log` registran `deltaValidation.valid = true` en todos los giros.
- [ ] Ruletas 1 a 6 y Arauco siguen funcionando igual (status y spin sin cambios).
- [ ] `.env.example` documenta las seis variables nuevas.

## 7. Casos borde

| Situación | Comportamiento esperado |
|-----------|-------------------------|
| Stock físico agotado y el azar pide premio | `sold_out`, no se fuerza siga |
| Resultado `siga_participando` | Inventario intacto, `prizeForDelta = null`, sin confeti |
| Mismo `idempotencyKey` repetido | Mismo payload, sin doble descuento |
| Fuera de ventana en producción | 403 `outside_window` |
| Día no incluido en el schedule | `inactive_campaign` con `reason` |
| SVG no disponible | Fallback a `<img>`, igual que las demás ruletas |
| Giro repetido rápido | Las clases de animación se limpian en `animationend` |

## 8. Plan de tareas

1. Crear `specs/ruleta-niu25.progress.md`.
2. `server/lib/niu25SpinService.js` con la mutación pura y el 30% de siga.
3. Config en `server/lib/config.js` (los dos returns).
4. Rutas, snapshot, stats, logs y log de arranque en `server/index.js`.
5. `public/ruleta7.html` y `public/app7.js`.
6. Tema `body.ruleta7` y animaciones de cierre en `public/styles.css`.
7. Variables en `.env.example` y `.env.development`.
8. Verificación manual: status, spin, distribución de siga, inventario, animaciones y regresión de
   las otras ruletas.

## 9. Decisiones pendientes de confirmar

- Nombres propuestos: ruta `/ruleta7.html`, API `/api/niu25/*`, estado `state.niu25`,
  env `NIU25_*`, frontend `app7.js`.
- Año de la activación: **2026-07-25** (sábado).
