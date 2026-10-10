# Agenda conversacional local

Reutiliza `GunterAssistantTools`, `GunterEventsService`, `gunter_daily/events` y el Permission Gate actual. No añade almacenamiento ni sincronización.

## Órdenes disponibles

- `Agenda una reunión "Equipo" mañana a las 10`.
- `Renombra la reunión "Equipo" a "Equipo de producto"`.
- `Reprograma la reunión "Equipo de producto" para mañana a las 15`.
- `Cancela la reunión "Equipo de producto"`.
- `Mi agenda` / `Qué tengo mañana`.

También acepta cita/evento y el identificador del registro. Al mover un evento conserva su duración; un intervalo explícito válido puede reemplazarla. Si varios eventos comparten nombre, muestra fecha y número y pide elegir antes de confirmar. La elección no autoriza la escritura.

Crear, editar y cancelar requieren confirmación; una confirmación hablada no autoriza cambios. Antes de escribir se comprueban de nuevo cuenta, propietario, estado y snapshot en una transacción IndexedDB. Solo se comunica éxito después de reconsultar el registro.

## Privacidad y compatibilidad

El perfil autenticado determina el propietario, también en la creación desde ActionEngine. Con autenticación presente y no verificada no se leen ni crean eventos. Listados de eventos filtran la cuenta actual y ocultan cancelados. No se migran ni reasignan registros legacy de `local-user`.

Cancelar guarda `status: cancelled` y `cancelledAt`; no elimina el registro. Eventos propios anteriores sin estado se consideran activos sin migrarlos. Los cambios emitidos actualizan las vistas existentes.

Los cambios conversacionales de esta fase son locales: no modifican series recurrentes ni eventos vinculados a calendarios externos. Gunter explica el límite. La integración explícita de creación con Google que ya existía permanece disponible; no se habilita automáticamente.

La edición de esta fase cubre nombre y horario. No incluye edición de invitados, ubicación, recurrencias, reactivación de cancelados ni coordinación multipaso.

## Comprobación focalizada

`npm run test:agenda`: propiedad, confirmaciones, aislamiento, snapshots obsoletos, transacciones atómicas, fechas, duración, selección de duplicados, cancelación y compatibilidad de consumidores existentes. `node test/assistant-core.js` comprueba el catálogo y despacho directamente modificados. Sin modelos, micrófono, benchmarks ni smoke general.
