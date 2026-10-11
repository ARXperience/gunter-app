# Cruces y alternativas de agenda local

La creación y reprogramación conversacional reutilizan `GunterAssistantTools`, `GunterEventsService`, el Permission Gate y la BD `gunter_daily`. No hay modelos, almacenes ni sincronización nuevos.

- Antes de confirmar, Gunter comprueba eventos activos de la cuenta actual, informa cruces y muestra hasta tres alternativas posteriores de la misma duración en el mismo día local.
- `Opción 1`, `opcion 2` o `la segunda opción` sustituyen el horario propuesto, pero no guardan nada: siempre generan otra confirmación. Un número aislado conserva su significado de selección de registros, no de horarios.
- Puedes confirmar el horario original aceptando expresamente sus cruces. No se mueven otros registros automáticamente. Una confirmación de voz no autoriza la escritura.
- Consulta, aceptación y guardado revalidan cuenta y horarios. Una huella de los cruces/cobertura observados se comprueba dentro de la misma transacción IndexedDB que escribe. Si cambia, se aborta sin escritura parcial ni sincronización y se solicita otra confirmación.
- Intervalos adyacentes no son cruces. Se consideran eventos que comenzaron antes del día consultado y siguen activos; se excluye el evento que estás moviendo. Los vencimientos de tareas no son intervalos ocupados.

## Límites explícitos

Solo se comprueban registros locales, incluidos los intervalos externos ya almacenados. No se asegura disponibilidad en calendarios que no estén sincronizados. No se promete disponibilidad personal universal, se detectan cruces registrados.

Sin expansión fiable de recurrencias, cobertura de eventos de día completo o fechas válidas, Gunter informa cobertura incompleta y no sugiere huecos como libres. Crear una serie advierte que se comprueba únicamente su primera ocurrencia. Crear una reunión sin hora concreta pide precisarla; un horario pasado no se agenda como futuro.

Los planes multipaso no aceptan un paso de agenda con cruces o cobertura incompleta sin mostrarlo: piden gestionar ese evento como acción individual. Los pasos sin cruces siguen usando el guard atómico; si un paso anterior cambia la disponibilidad, se bloquea el siguiente, sin deshacer pasos ya confirmados y terminados.

Las alternativas incorporan las preferencias de jornada y margen configuradas por cuenta (ver `calendar-planning.md`). Todavía no incorporan tiempos de traslado ni pausas múltiples por día. Los consumidores manuales anteriores conservan compatibilidad; el guard de agenda es opcional en el servicio y obligatorio en estas herramientas conversacionales.

## Pruebas específicas

`npm run test:calendar-schedule` comprueba confirmación, elección de alternativas, cambios simultáneos, aislamiento, fallos, límites y transacciones. También se comprueban las suites directamente afectadas de agenda y continuidad conversacional. Sin modelos, micrófono, benchmarks ni infraestructura nueva.
