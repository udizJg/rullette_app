# Spec: Ruleta Irarrazaval (Merch + Sigue participando 30%)

Estado: PENDIENTE DE APROBACIÓN
Fecha: 2026-08-14

## 1. Resumen

Nueva ruleta independiente para la activación **Irarrazaval** los días **15 y 16 de agosto de 2026**,
ventana operativa **11:30–15:30** (`TZ=America/Santiago`), con margen sobre el horario de activación
real (12:00–15:00).

Usa el SVG `public/assets/irarrazaval.svg` (origen: `Ruleta-Irarrazaval.svg`), maneja 5 premios
físicos con **inventario distinto por día** y entrega «Sigue participando» en el **30%** de los giros
como resultado virtual sin stock.

La arquitectura replica el patrón **Arauco / NIU25** (`*SpinService.js` con mutación pura + inventario
físico + 30% siga). La novedad respecto a ruletas existentes es el **stock inicial por fecha** (sábado
y domingo tienen cupos distintos en tote y botella).

Capacidad de diseño: ~**150 giros/día** (106 premios físicos sábado → ~151 giros al 30% siga; 104
domingo → ~149 giros). **Sin tope duro de giros en servidor** (control en tienda, igual que Arauco,
NIU25 y Ruleta 4).

Patrón de diseño: **Strategy** en el spin service (misma lógica que Arauco/NIU25); capa de
**configuración** resuelve límites por `dayKey`. No aplica patrón adicional.

## 2. Requisitos funcionales

1. Página pública `/ruleta8.html` que monta el SVG inline vía `fetch` + `DOMParser`.
2. Endpoints `GET /api/irarrazaval/status` y `POST /api/irarrazaval/spin`.
3. Calendario:

   | Día | Fecha | Ventana |
   |-----|-------|---------|
   | Sábado | 2026-08-15 | 11:30–15:30 |
   | Domingo | 2026-08-16 | 11:30–15:30 |

4. Stock inicial **por día**:

   | Key | Label | Sáb 15 | Dom 16 |
   |-----|-------|--------|--------|
   | `pelota` | Te ganaste una pelota | 75 | 75 |
   | `morral` | Te ganaste un morral | 25 | 25 |
   | `tote` | Te ganaste un tote | 2 | 1 |
   | `botella` | Te ganaste una botella | 2 | 1 |
   | `lonchera` | Te ganaste una lonchera | 2 | 2 |
   | `siga_participando` | Sigue participando | — | — |

5. En cada giro elegible: probabilidad **0.30** → `siga_participando`; **0.70** → sorteo uniforme
   entre premios físicos con stock > 0.
6. Si toca premio físico y no hay stock en ningún premio → `sold_out` (HTTP 200). No se convierte en
   siga.
7. Orden horario de los 8 segmentos desde el puntero (alinear backend y `public/app8.js`):

   | Índice | Outcome |
   |--------|---------|
   | 0 | `lonchera` |
   | 1 | `siga_participando` |
   | 2 | `botella` |
   | 3 | `pelota` |
   | 4 | `tote` |
   | 5 | `siga_participando` |
   | 6 | `morral` |
   | 7 | `pelota` |

8. `siga_participando` en índices **1 y 5** (opuestos en la rueda).
9. Sin tope de giros por tablet: `enforceOnePerParticipant = false`.
10. Idempotencia por `participantKey` + `idempotencyKey` (mín. 8 chars), igual que NIU25.
11. Fuera de ventana → 403 `outside_window` (excepto `NODE_ENV=development`).
12. Sin `IRARRAZAVAL_SCHEDULE` → `not_configured`; el servidor arranca igual.
13. Logs propios: `irarrazaval-spins-YYYY-MM-DD.log` con validación de delta de inventario.
14. Reutilizar animaciones de cierre de Ruleta 7 (rebote, puntero, confeti) bajo tema `body.ruleta8`,
    ajustando color de puntero si el SVG lo requiere tras copiar el asset.

## 3. Fuera de alcance

- Modificar ruletas 1–7, Arauco u otras APIs existentes.
- Corregir el bug de `deltaValidation.valid = false` en reintentos idempotentes de otras ruletas.
- Tope duro de 150 giros/día en servidor (salvo que el usuario lo pida explícitamente).
- Panel admin / dashboard de stock.
- Tests automatizados en esta entrega (verificación manual + script de simulación opcional).

## 4. Diseño técnico

### 4.1 Nombres y rutas

| Concepto | Valor |
|----------|-------|
| HTML | `/ruleta8.html` |
| JS front | `public/app8.js` |
| SVG | `public/assets/irarrazaval.svg` |
| API | `/api/irarrazaval/status`, `/api/irarrazaval/spin` |
| Estado persistido | `state.irarrazaval.days[dayKey]` |
| Spin service | `server/lib/irarrazavalSpinService.js` |
| Prefijo env | `IRARRAZAVAL_*` |

### 4.2 Configuración (`server/lib/config.js`)

- `IRARRAZAVAL_SCHEDULE`: formato `fecha,HH:mm-HH:mm|...` (reutiliza `parseChicureoSchedule`).
- Inventario por día vía **`IRARRAZAVAL_INVENTORY`**:

  ```
  IRARRAZAVAL_INVENTORY=2026-08-15,75,25,2,2,2|2026-08-16,75,25,1,1,2
  ```

  Orden fijo por segmento: `pelota,morral,tote,botella,lonchera`.

- Nueva función `parseIrarrazavalInventory(raw, scheduleDayKeys)` valida que cada fecha del schedule
  tenga una fila de inventario y devuelve `limitsByDay: Record<dayKey, limits>`.
- Registrar `irarrazaval` en **ambos** `return` de `loadConfig()` (modo `schedule` y `legacy`).

### 4.3 Spin service

- Copia estructural de `niu25SpinService.js` / `araucoSpinService.js`.
- Exportar: `IRARRAZAVAL_PRIZE_KEYS`, `IRARRAZAVAL_SEGMENT_OUTCOMES`, `IRARRAZAVAL_RESULT_LABELS`,
  `applyIrarrazavalSpinMutation`.
- `SIGA_PROBABILITY = 0.3`; `SIGA_SEGMENT_INDICES = [1, 5]`.

### 4.4 Servidor (`server/index.js`)

- `irarrazavalNowContext()`, `getIrarrazavalDaySnapshot(dayKey)`, `buildIrarrazavalDayStats()`.
- Resolver `defaultLimits` del día con `config.irarrazaval.limitsByDay[dayKey]` (no un único
  `defaultLimits` global).
- Rutas status/spin, snapshot en startup log, limpieza de logs dev al reiniciar en development.

### 4.5 Frontend

- Basado en `ruleta7.html` + `app7.js`: misma geometría (8 segmentos, puntero 270°).
- `SEGMENT_ORDER_CLOCKWISE` alineado con la tabla de §2.7.
- Tema CSS `body.ruleta8` en `public/styles.css` (colores del SVG Irarrazaval tras revisión visual).

### 4.6 Variables de entorno (`.env.example` y `.env.development`)

```env
IRARRAZAVAL_SCHEDULE=2026-08-15,11:30-15:30|2026-08-16,11:30-15:30
IRARRAZAVAL_INVENTORY=2026-08-15,75,25,2,2,2|2026-08-16,75,25,1,1,2
```

## 5. Criterios de aceptación

- [ ] `/ruleta8.html` carga `irarrazaval.svg` completo, centrado y nítido.
- [ ] Sábado 15 inicia con inventario 75/25/2/2/2; domingo 16 con 75/25/1/1/2.
- [ ] Premio físico descuenta exactamente 1 unidad del premio correspondiente.
- [ ] Distribución de siga ~30% sobre muestra grande (±2% tolerancia).
- [ ] Animación para en el `segmentIndex` del servidor (0° desviación puntero vs premio).
- [ ] Fuera de ventana responde 403 `outside_window` (excepto development).
- [ ] Sin schedule responde `not_configured`.
- [ ] Reintento con misma `idempotencyKey` devuelve payload original sin descontar de nuevo.
- [ ] Stock agotado sin siga responde `sold_out`.
- [ ] Logs `irarrazaval-spins-*.log` con `deltaValidation.valid = true` en giros nuevos.
- [ ] Ruletas 1–7 y Arauco siguen respondiendo OK (regresión manual).
- [ ] `.env.example` documenta `IRARRAZAVAL_SCHEDULE` e `IRARRAZAVAL_INVENTORY`.

## 6. Casos borde

| Caso | Comportamiento esperado |
|------|-------------------------|
| Giro con 30% siga pero sin stock físico restante | OK siga; inventario no cambia |
| Giro 70% físico con stock parcial agotado | Sortea solo entre premios con stock > 0 |
| Giro 70% físico sin ningún stock | `sold_out` |
| Fecha en schedule sin fila en `IRARRAZAVAL_INVENTORY` | Error al arrancar (`loadConfig`) |
| `IRARRAZAVAL_INVENTORY` con fecha extra no en schedule | Error al arrancar |
| Reintento idempotente | Mismo payload; log marca `replayed: true` si aplica |

## 7. Plan de tareas

1. Copiar SVG a `public/assets/irarrazaval.svg`.
2. Crear `server/lib/irarrazavalSpinService.js`.
3. Agregar `parseIrarrazavalInventory` + bloque `IRARRAZAVAL_*` en `config.js` (ambos returns).
4. Cablear rutas, snapshot, stats y logs en `server/index.js`.
5. Crear `public/ruleta8.html` y `public/app8.js`.
6. Tema `body.ruleta8` en `public/styles.css`.
7. Actualizar `.env.example` y `.env.development`.
8. Verificación manual: status, spin, alineación puntero, regresión otras ruletas.
