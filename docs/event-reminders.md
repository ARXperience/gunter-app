# Avisos vinculados a reuniones locales

Reutiliza `GunterEventsService`, `GunterNotificationsService`, `reminder.schedule` y los stores `events`/`reminders` de `gunter_daily`. No añade base de datos, modelo, sincronización ni permisos automáticos.

## Uso

- `Recuérdame la reunión "Revisión de producto" 15 minutos antes`.
- Después de crear o consultar una reunión: `Recuérdame esa reunión 1 hora antes`.
- `Recuérdame eso` → Gunter pregunta cuándo; también acepta una fecha y hora anteriores al inicio.
- `Mis recordatorios` incluye los avisos vinculados. Cancelación desde Recordatorios o `Cancela el recordatorio de Revisión de producto`, con confirmación en el chat.

Los nombres se resuelven entre reuniones propias activas, sin inferir otro registro por similitud. Ante duplicados pregunta el número; para cancelar avisos homónimos pide selección manual o identificador. Una respuesta hablada no autoriza una propuesta: confirmar por escrito o en pantalla.

## Comportamiento

El aviso conserva su antelación respecto al inicio. Cambiar nombre/horario actualiza sus datos; cancelar o eliminar la reunión cancela los avisos activos. Si al moverla el aviso queda en el pasado, se cancela en lugar de dispararlo fuera de contexto. Los avisos ya emitidos o cancelados no se reactivan. La vista previa queda invalidada si el evento cambia antes de confirmar.

Creación, actualización y cancelación usan transacciones IndexedDB compartidas. Un fallo no guarda media reprogramación. Al disparar, se reconsulta la reunión y se reclama `scheduled → fired` atómicamente; varias pestañas no muestran el mismo aviso. Los mensajes entre pestañas solo invalidan temporizadores, sin transmitir contenido. Los registros legacy sin propietario no se reasignan ni se notifican.

## Límites explícitos

Los avisos vinculados son **locales: requieren Gunter abierto, cuenta autorizada y el mismo navegador/dispositivo**. No se envían al servidor porque este no conoce el calendario IndexedDB; no se promete entrega con la aplicación cerrada ni puntualidad si el sistema suspende la pestaña. Un aviso pendiente puede mostrarse al reabrir mientras la reunión siga en curso; si ya terminó, se cancela. La reclamación evita duplicados pero no garantiza entrega si el navegador se cierra justo después de reclamar el aviso.

Solo reuniones locales con inicio/fin exactos: no series recurrentes, eventos de día completo ni calendarios externos. Los recordatorios independientes conservan el scheduler durable existente. No se solicita permiso de notificación automáticamente: sin permiso concedido se muestra el aviso dentro de Gunter.

## Pruebas

`npm run test:event-reminders`: lifecycle atómico, rollback, cuentas, snapshots, deduplicación, claim concurrente, temporizadores largos/obsoletos, invalidación entre pestañas y conversación con confirmación. Sin navegador automatizado, regresión general o benchmarks.
