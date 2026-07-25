# Progreso: ruleta-niu25
Ultima actualizacion: 2026-07-24 23:45
Estado general: COMPLETADO

## Checklist de implementacion
- [x] Spec aprobada — `specs/ruleta-niu25.md`
- [x] `server/lib/niu25SpinService.js` — mutación pura, 30% siga, sin I/O
- [x] Config `NIU25_*` en `server/lib/config.js` (registrada en los dos returns)
- [x] Rutas, snapshot, stats y logs en `server/index.js`
- [x] `public/ruleta7.html` y `public/app7.js`
- [x] Tema `body.ruleta7` y animaciones de cierre en `public/styles.css`
- [x] Variables en `.env.example` y `.env.development`
- [x] Verificación manual y regresión de las otras ruletas

## Criterios de aceptacion verificados
- [x] `/ruleta7.html` carga `niu25.svg` completo, centrado y nítido
- [x] Premio físico descuenta exactamente 1 unidad (2113/2113 giros con delta correcto)
- [x] Distribución de siga: 30,39% sobre 20.000 giros
- [x] La animación para en el `segmentIndex` del servidor: 6/6 giros en navegador con 0° de
      desviación entre segmento bajo el puntero y premio anunciado; 0 incoherencias en 8.000 giros
- [x] Fuera de ventana responde 403 `outside_window` (excepto en development)
- [x] Sin `NIU25_SCHEDULE` responde `not_configured` y el servidor arranca igual
- [x] Reintento con la misma `idempotencyKey` devuelve el payload original sin descontar
- [x] Stock agotado sin siga responde `sold_out` (683 sold_out + 317 siga = 1000)
- [x] Rebote de rueda, golpe de puntero y cañón radial de 54 partículas verificados en navegador
- [x] `prefers-reduced-motion: reduce` anula las tres animaciones y el confeti, conservando el texto
- [x] Logs `niu25-spins-*.log`: 22 entradas, 0 deltas inválidos
- [x] Ruletas 1 a 6 y Arauco siguen respondiendo `ok` en status y spin; todas las páginas HTTP 200
- [x] `.env.example` documenta las seis variables nuevas
- [x] Stock completo del día (70 unidades) entregable sin residuos

## Contexto para retomar
- **Ultima accion realizada**: verificación completa y limpieza de datos de prueba en `data-dev`
- **Siguiente paso inmediato**: nada pendiente; falta que el usuario decida si ajusta el `NIU25_SCHEDULE`
  de producción (hoy `2026-07-25,21:00-23:30` exacto, sin margen)
- **Decisiones tomadas**:
  - Patrón base Arauco, no Ruleta 6 → es el único que mezcla inventario físico con probabilidad
    fija de resultado virtual
  - Nombres: `/ruleta7.html`, `/api/niu25/*`, `state.niu25`, `NIU25_*`, `app7.js`
  - Siga participando en índices 3 y 7 (opuestos en la rueda, reparto visual parejo)
  - Animación de cierre en `.wheel-rim`, no en `.wheel-spin`, porque este último usa transform
    inline como acumulador de rotación
  - Registrar `niu25` en ambos returns de `loadConfig()` desde el inicio: al agregar Ruleta 6
    se omitió en el return del modo `schedule` y la ruleta salía como no configurada
  - `pointer-cover` propio para ruleta 7 con `#e31d1b`: el compartido usa `#d61016` y no calzaba
    con el rojo de `niu25.svg`
  - En el log de spin, `afterInventory` se lee del estado real y no de `payload.remaining`: en los
    reintentos idempotentes ese payload viene congelado del giro original y producía un
    `deltaValidation.valid = false` falso. Se agregó el campo `replayed` al log
  - `restartOneShotAnimation()` filtra por `animationName`: el `animationend` de `pointerBalance`
    (misma duración que el giro) borraba la clase `pointer--kick` recién agregada
- **Bloqueos/pendientes de respuesta**: ninguno
- **Hallazgo fuera de alcance (no corregido)**: el falso `deltaValidation.valid = false` en
  reintentos idempotentes también ocurre en ruletas 1, 3, 4, 5, 6 y Arauco. Reproducido en Arauco.
  Solo afecta la auditoría del log, no el inventario. La spec excluía modificar otras ruletas
- **Archivos modificados en esta sesion**:
  - Nuevos: `specs/ruleta-niu25.md`, `specs/ruleta-niu25.progress.md`,
    `server/lib/niu25SpinService.js`, `public/ruleta7.html`, `public/app7.js`
  - Modificados: `server/lib/config.js`, `server/index.js`, `public/styles.css`,
    `.env.example`, `.env.development`
- **Comandos utiles**:
  - `npm run dev` (NODE_ENV=development, usa `.env.development` con `override: true`,
    por lo que PORT y DATA_DIR de la línea de comandos son ignorados)
  - `curl -s localhost:3000/api/niu25/status | python3 -m json.tool`
