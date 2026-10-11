# Continuidad de tareas y eventos

Extiende el registro `GunterAssistantTools` y reutiliza los servicios de tareas, eventos, recordatorios y el Permission Gate. No añade otro sistema de memoria, almacenamiento ni modelos.

## Uso

- Después de crear o cambiar un registro: `Muévela para mañana a las 10`, `Mejor para pasado mañana`, `Renómbrala como "Revisión final"` o `Cancélala`.
- Una propuesta de edición pendiente acepta correcciones como `Mejor a las tres`. La propuesta anterior no se ejecuta: se muestra otra confirmación, conservando el snapshot originalmente presentado.
- La agenda se muestra numerada: primero eventos, luego tareas. `La segunda` centra la conversación en ese registro. Si una orden implícita puede referirse a varios, pide elegir antes de proponer el cambio.
- `Recuérdame eso también` pide la fecha y reutiliza el servicio de recordatorios. Conserva el título exacto del registro; no vuelve a interpretar palabras del título como órdenes o fechas.

Una fecha sin hora conserva la hora del registro cuando existe. Una corrección que solo cambia la hora conserva la fecha de la propuesta o del registro. Los eventos conservan su duración. La fecha y hora resultantes siempre aparecen en la confirmación.

## Seguridad y límites

Las referencias contienen tipo e identificador, no solo título. Se reconsulta el registro de la cuenta autenticada antes de preparar la acción. No se interpreta una reunión como una tarea aunque coincidan título o identificador.

La continuidad sigue el interruptor existente `conversationContinuity`. Al desactivarlo se borran las referencias implícitas; activarlo no recupera las anteriores. Cambiar de cuenta, perder la confianza, limpiar el chat o agotar diez minutos de contexto invalida las referencias. La selección explícita de duplicados mantiene su límite de cinco minutos.

Una referencia nunca autoriza una escritura. Editar o cancelar exige confirmación escrita/en pantalla; una confirmación hablada no es suficiente. Las correcciones verifican el snapshot original, y los cambios de estado de tareas admiten el mismo guard transaccional sin perder timestamps ni reconciliación existentes.

El estado de referencia es temporal en la instancia actual de herramientas: recargar o navegar puede requerir volver a identificar el registro. Las nuevas referencias no crean registros a partir de una propuesta de creación pendiente. Se conservan los límites de eventos recurrentes/externos y la ausencia de herramienta de reactivación de eventos.

## Pruebas focalizadas

`npm run test:followups`; `node test/task-edit-tools.js`; `node test/task-status-tools.js`; `node test/event-tools.js`. Incluyen tipos/IDs, duplicados, correcciones, guardas obsoletas, voz, cuentas, preferencias, expiración, parser temporal real y recordatorios. No requieren servidor, modelos, micrófono ni red.
